// =============================================================================
// finance.js  —  Personal mortgage & sale economics (pure functions, no DOM)
// -----------------------------------------------------------------------------
// IMPORTANT: all month arithmetic is done on plain integers parsed from the ISO
// strings — never via the Date object's setMonth/getMonth, which mix UTC parsing
// with local-time mutation and break (loop forever) in timezones behind UTC.
// =============================================================================

// Absolute month index from a "YYYY-MM" or "YYYY-MM-DD" string (year*12 + month0).
export function ymIndex(iso) {
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10);
  return y * 12 + (m - 1);
}
// Inverse: month index -> "YYYY-MM".
export function ymToISO(index) {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return y + "-" + String(m).padStart(2, "0");
}
// Calendar year from an ISO date string.
export function yearOfISO(iso) { return parseInt(iso.slice(0, 4), 10); }

// Months between two YYYY-MM-DD (or YYYY-MM) dates (integer, timezone-safe).
export function monthsBetween(fromISO, toISO) {
  return ymIndex(toISO) - ymIndex(fromISO);
}

// Standard amortised monthly payment.
export function monthlyPayment(principal, annualRatePct, termYears) {
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

// Outstanding balance after `monthsPaid` months of an amortising loan.
export function balanceAfter(principal, annualRatePct, termYears, monthsPaid) {
  const r = annualRatePct / 100 / 12;
  const pmt = monthlyPayment(principal, annualRatePct, termYears);
  if (r === 0) return Math.max(0, principal - pmt * monthsPaid);
  const bal = principal * Math.pow(1 + r, monthsPaid) - pmt * ((Math.pow(1 + r, monthsPaid) - 1) / r);
  return Math.max(0, bal);
}

// Build a year-by-year growth path and return a value multiplier at a target date,
// relative to a base value at baseDate. growthByYear: { 2026: -2.0, 2027: 3.0, ... }.
export function valueMultiplier(baseDate, targetDate, growthByYear, presentISO) {
  // Apply monthly-compounded annual growth from the *present* forward (integer
  // month math — timezone-safe). Before the present we trust the observed index.
  const startIdx = ymIndex(presentISO);
  const endIdx = ymIndex(targetDate);
  if (endIdx <= startIdx) return 1;
  const lastYearKey = Object.keys(growthByYear).slice(-1)[0];
  let mult = 1;
  for (let idx = startIdx; idx < endIdx; idx++) {
    const yr = Math.floor(idx / 12);
    const annual = (growthByYear[yr] ?? growthByYear[lastYearKey] ?? 0) / 100;
    const monthly = Math.pow(1 + annual, 1 / 12) - 1;
    mult *= 1 + monthly;
  }
  return mult;
}

// Estimated current value of the flat from the observed index (purchase = 100).
export function currentValueFromIndex(purchasePrice, priceSeries, key) {
  const last = priceSeries[priceSeries.length - 1];
  return purchasePrice * (last[key] / 100);
}

// Selling costs given a sale price.
export function sellingCosts(salePrice, cfg) {
  const agent = salePrice * (cfg.agentPct / 100) * (1 + cfg.vatPct / 100);
  return {
    agent,
    legal: cfg.legalFixed,
    misc: cfg.epcAndMiscFixed,
    total: agent + cfg.legalFixed + cfg.epcAndMiscFixed,
  };
}

// Full economics of selling in a given window.
// Returns value, outstanding balance, ERC, selling costs, CGT, and net proceeds.
export function economicsForWindow(opts) {
  const {
    property, mortgage, sellingCfg, presentValue, presentISO,
    growthByYear, windowDate,
  } = opts;

  // 1) Projected sale value: present value grown forward by the scenario.
  const mult = valueMultiplier(property.purchaseDate, windowDate, growthByYear, presentISO);
  const saleValue = presentValue * mult;

  // 2) Outstanding mortgage balance at the window date.
  const monthsPaidAtFix = monthsBetween(property.purchaseDate, mortgage.fixEndDate);
  const monthsPaidAtWindow = monthsBetween(property.purchaseDate, windowDate);
  const insideFix = ymIndex(windowDate) < ymIndex(mortgage.fixEndDate);

  const io = mortgage.repaymentType === "interest_only";
  let outstanding;
  if (io) {
    outstanding = mortgage.principal; // interest-only: balance never reduces
  } else if (insideFix) {
    outstanding = balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtWindow);
  } else {
    // Pay at the fixed rate until the fix ends, then continue amortising the
    // remaining balance/term at the assumed remortgage rate.
    const balAtFix = balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtFix);
    const remainingTermYears = mortgage.termYears - monthsPaidAtFix / 12;
    const monthsAfterFix = monthsPaidAtWindow - monthsPaidAtFix;
    outstanding = balanceAfter(balAtFix, mortgage.remortgageRatePctAssumed, remainingTermYears, monthsAfterFix);
  }

  // 3) Early Repayment Charge — applies while inside EITHER the current fix or the
  //    new fixed deal taken when the current fix ends (you'd remortgage into it).
  const winIdx = ymIndex(windowDate);
  const fixIdx = ymIndex(mortgage.fixEndDate);
  const newFixEndIdx = fixIdx + Math.round((mortgage.remortgageFixYears || 0) * 12);
  let erc = 0;
  if (winIdx < fixIdx) erc = outstanding * (mortgage.ercPctWhileFixed / 100);
  else if (winIdx < newFixEndIdx) erc = outstanding * ((mortgage.remortgageErcPct || 0) / 100);

  // 4) Selling costs.
  const costs = sellingCosts(saleValue, sellingCfg);

  // 5) CGT — exempt for a primary residence (Private Residence Relief).
  const cgt = property.isPrimaryResidence ? 0 : 0; // BTL handling could go here.

  // 6) Net proceeds (cash in hand after clearing the mortgage and all costs).
  const net = saleValue - outstanding - erc - costs.total - cgt;

  return {
    windowDate, saleValue, outstanding, erc, costs, cgt, net, insideFix,
    valueMult: mult,
    equityGainVsPurchase: saleValue - property.purchasePrice,
  };
}

// Monthly mortgage payment now vs. after remortgage — the "holding cost" signal.
export function holdingCostDelta(mortgage) {
  const io = mortgage.repaymentType === "interest_only";
  const now = io
    ? mortgage.principal * (mortgage.ratePct / 100 / 12)
    : monthlyPayment(mortgage.principal, mortgage.ratePct, mortgage.termYears);
  const monthsPaidAtFix = monthsBetween(mortgage._purchaseDate, mortgage.fixEndDate);
  const balAtFix = io
    ? mortgage.principal
    : balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtFix);
  const remainingTermYears = mortgage.termYears - monthsPaidAtFix / 12;
  const after = io
    ? balAtFix * (mortgage.remortgageRatePctAssumed / 100 / 12)
    : monthlyPayment(balAtFix, mortgage.remortgageRatePctAssumed, remainingTermYears);
  return { now, after, deltaMonthly: after - now, deltaAnnual: (after - now) * 12 };
}
