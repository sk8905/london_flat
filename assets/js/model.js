// =============================================================================
// model.js  —  Composite sell-timing signal across candidate windows
// -----------------------------------------------------------------------------
// Each factor produces a score in [-100, +100] where positive = "favourable to
// sell in this window". The weighted blend (FACTOR_WEIGHTS) gives the signal.
// Everything is transparent: the UI shows each factor's score, weight and reason.
// =============================================================================

import {
  economicsForWindow, holdingCostDelta, monthsBetween,
  currentValueFromIndex, valueMultiplier, ymIndex, ymToISO, yearOfISO,
} from "./finance.js?v=42";

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Map value v within [min,max] onto [-100,+100]; if all equal, return 0.
function spread(v, min, max) {
  if (max - min < 1e-9) return 0;
  return ((v - min) / (max - min)) * 200 - 100;
}

// Annual growth (%) for the calendar year of a window's date, from a scenario.
function growthAtDate(dateISO, growthByYear) {
  const yr = yearOfISO(dateISO);
  const keys = Object.keys(growthByYear);
  return growthByYear[yr] ?? growthByYear[keys[keys.length - 1]] ?? 0;
}

export function runModel(data, overrides = {}) {
  const {
    PROPERTY, MORTGAGE, SELLING_COSTS, PRICE_HISTORY, RATES,
    FORECAST, POLICY_FACTORS, SEASONALITY, WINDOWS, FACTOR_WEIGHTS, META, COMPARABLES,
  } = data;

  // ---- merge editable overrides (from UI controls) -------------------------
  const scenarioName = overrides.scenario || FORECAST.defaultScenario;
  const growthByYear = overrides.growthByYear || FORECAST.scenarios[scenarioName];
  const mortgage = {
    ...MORTGAGE,
    principal: MORTGAGE.principal, // getter resolved
    remortgageRatePctAssumed:
      overrides.remortgageRate ?? MORTGAGE.remortgageRatePctAssumed,
    _purchaseDate: PROPERTY.purchaseDate,
  };
  const sellingCfg = { ...SELLING_COSTS, ...(overrides.sellingCosts || {}) };
  const presentISO = META.asOf;

  // ---- current value: anchor to ACTUAL SOLD prices, not forecasts ----------
  // (a) the flat's own purchase price trended by the Islington sold-price index,
  // (b) a £/m² comparable from N1 Land Registry sales × the flat's floor area.
  // Default present value blends the two; the forecast is used ONLY to project
  // FORWARD from here.
  const indexVal = currentValueFromIndex(PROPERTY.purchasePrice, PRICE_HISTORY.series, "islington");
  const area = PROPERTY.floorAreaSqm || 0;
  const perSqm = COMPARABLES && COMPARABLES.perSqm ? COMPARABLES.perSqm : null;
  const compVal = area && perSqm ? area * perSqm.median : null;
  const blendedVal = compVal ? Math.round((indexVal + compVal) / 2) : Math.round(indexVal);
  const presentValue = overrides.presentValue ?? blendedVal;
  const valuation = {
    indexVal: Math.round(indexVal),
    compVal: compVal ? Math.round(compVal) : null,
    compLow: area && perSqm ? Math.round(area * perSqm.low) : null,
    compHigh: area && perSqm ? Math.round(area * perSqm.high) : null,
    blendedVal,
    area,
    perSqm,
    purchasePerSqm: area ? Math.round(PROPERTY.purchasePrice / area) : null,
    impliedPerSqm: area ? Math.round(presentValue / area) : null,
  };

  const hcd = holdingCostDelta(mortgage);

  // ---- per-window economics ------------------------------------------------
  const econ = WINDOWS.map((w) => {
    const e = economicsForWindow({
      property: PROPERTY, mortgage, sellingCfg,
      presentValue, presentISO, growthByYear, windowDate: w.date,
    });
    // Financing friction (£) = ERC + extra interest from holding past the fix.
    const monthsPastFix = Math.max(0, monthsBetween(mortgage.fixEndDate, w.date));
    const extraInterest = monthsPastFix * Math.max(0, hcd.deltaMonthly);
    const friction = e.erc + extraInterest;
    const momentum = growthAtDate(w.date, growthByYear); // % annual at the window
    const season = SEASONALITY.monthIndex[w.peakMonth - 1];
    return { window: w, ...e, friction, extraInterest, monthsPastFix, momentum, season };
  });

  // ---- normalisation bounds across windows ---------------------------------
  const values = econ.map((e) => e.saleValue);
  const nets = econ.map((e) => e.net);
  const frics = econ.map((e) => e.friction);
  const seasons = econ.map((e) => e.season);
  const vMin = Math.min(...values), vMax = Math.max(...values);
  const nMin = Math.min(...nets), nMax = Math.max(...nets);
  const fMin = Math.min(...frics), fMax = Math.max(...frics);
  const sMin = Math.min(...seasons), sMax = Math.max(...seasons);

  // ---- policy/macro score (time-aware) -------------------------------------
  const wHint = { high: 3, medium: 2, low: 1 };
  function policyScore(windowDate) {
    const wIdx = ymIndex(windowDate);
    const yearsOut = monthsBetween(presentISO, windowDate) / 12;
    let sum = 0, maxAbs = 0;
    for (const f of POLICY_FACTORS) {
      const w = wHint[f.weightHint] || 1;
      maxAbs += w;
      if (ymIndex(f.effective) > wIdx) continue; // not yet in force
      let contrib = f.direction * w;
      // Macro/uncertainty risk resolves over time -> decays for later windows.
      if (f.id === "macroRisk") contrib *= clamp(1 - yearsOut * 0.4, 0.2, 1);
      sum += contrib;
    }
    return (sum / Math.max(1, maxAbs)) * 100;
  }

  // ---- score each window ---------------------------------------------------
  const W = { ...FACTOR_WEIGHTS, ...(overrides.weights || {}) };
  const scored = econ.map((e) => {
    const valueScore = spread(e.saleValue, vMin, vMax);
    const momentumScore = clamp(e.momentum * 15, -100, 100);
    const priceTrajectory = 0.6 * valueScore + 0.4 * momentumScore;

    // Lower friction is better -> invert the spread.
    const financingCost = -spread(e.friction, fMin, fMax);

    const netProceeds = spread(e.net, nMin, nMax);
    const seasonality = spread(e.season, sMin, sMax);
    const policyMacro = policyScore(e.window.date);

    const factors = { priceTrajectory, financingCost, netProceeds, seasonality, policyMacro };
    const contributions = {};
    let composite = 0;
    for (const k of Object.keys(W)) {
      contributions[k] = (factors[k] || 0) * W[k];
      composite += contributions[k];
    }
    return { ...e, factors, contributions, composite };
  });

  // ---- rank ----------------------------------------------------------------
  const ranked = [...scored].sort((a, b) => b.composite - a.composite);
  const best = ranked[0];

  // ---- forecast value path (monthly) for charts ----------------------------
  const pathEnd = WINDOWS[WINDOWS.length - 1].date;
  function buildPath(gby) {
    const pts = [];
    const startIdx = ymIndex(presentISO), endIdx = ymIndex(pathEnd);
    for (let idx = startIdx; idx <= endIdx; idx++) {
      const iso = ymToISO(idx);
      const v = presentValue * valueMultiplier(PROPERTY.purchaseDate, iso, gby, presentISO);
      pts.push({ date: iso, value: v });
    }
    return pts;
  }
  const forecastPaths = {
    base: buildPath(FORECAST.scenarios.base),
    optimistic: buildPath(FORECAST.scenarios.optimistic),
    pessimistic: buildPath(FORECAST.scenarios.pessimistic),
    active: buildPath(growthByYear),
  };

  return {
    meta: META,
    presentValue,
    valuation,
    holdingCost: hcd,
    scenarioName,
    growthByYear,
    weights: W,
    windows: scored,
    ranked,
    best,
    forecastPaths,
    inputs: { property: PROPERTY, mortgage, sellingCfg },
  };
}

// Human-readable label for a composite score.
export function signalLabel(score) {
  if (score >= 40) return { label: "Strong sell window", tone: "pos" };
  if (score >= 12) return { label: "Favourable", tone: "pos" };
  if (score > -12) return { label: "Neutral / hold", tone: "neu" };
  if (score > -40) return { label: "Unfavourable", tone: "neg" };
  return { label: "Poor sell window", tone: "neg" };
}

export const FACTOR_LABELS = {
  priceTrajectory: "Price trajectory",
  financingCost: "Financing & ERC",
  netProceeds: "Net proceeds",
  seasonality: "Seasonality",
  policyMacro: "Policy & macro",
};
