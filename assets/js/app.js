// =============================================================================
// app.js  —  Entry point: load data, run model, render the single page, wire UI
// =============================================================================

import * as DATA from "../data/dataset.js";
import { runModel, signalLabel, FACTOR_LABELS } from "./model.js";
import * as C from "./charts.js";
import { monthlyPayment, monthsBetween } from "./finance.js";
import { rentVsSell } from "./letting.js";

const $ = (sel, root = document) => root.querySelector(sel);
const gbp = (n) => (n < 0 ? "−" : "") + "£" + Math.abs(Math.round(n)).toLocaleString("en-GB");
const signed = (n, f = (x) => x.toFixed(0)) => (n >= 0 ? "+" : "") + f(n);
const pct = (n) => n.toFixed(2) + "%";
const monthName = (iso) =>
  new Date(iso.length === 7 ? iso + "-01" : iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

const FACTOR_COLORS = {
  priceTrajectory: "#2563eb",
  financingCost: "#9333ea",
  netProceeds: "#0891b2",
  seasonality: "#f59e0b",
  policyMacro: "#10b981",
};

// Mutable override state driven by the controls.
const state = {
  scenario: DATA.FORECAST.defaultScenario,
  growthByYear: { ...DATA.FORECAST.scenarios[DATA.FORECAST.defaultScenario] },
  remortgageRate: DATA.MORTGAGE.remortgageRatePctAssumed,
  presentValue: null, // null => derive from index
  custom: false,
  letting: {
    horizon: "2028-04-01",
    monthlyRent: DATA.LETTING.monthlyRent,
    taxBand: DATA.TAX.marginalBand,
    serviceCharge: DATA.LETTING.serviceChargeGroundRentPerYear,
    selfManage: DATA.LETTING.selfManage,
    opportunityRate: DATA.LETTING.opportunityRatePct,
  },
};

const LET_HORIZONS = [
  { label: "Spring 2027", date: "2027-04-01" },
  { label: "H2 2027", date: "2027-10-01" },
  { label: "Spring 2028", date: "2028-04-01" },
  { label: "Spring 2029", date: "2029-04-01" },
  { label: "Spring 2030", date: "2030-04-01" },
];

function currentOverrides() {
  return {
    scenario: state.custom ? "custom" : state.scenario,
    growthByYear: state.growthByYear,
    remortgageRate: state.remortgageRate,
    presentValue: state.presentValue ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function boot() {
  renderHeader();
  rerender();
  buildControls();
  buildLettingControls();
  renderStaticFactorChartsOnce();
  refreshLiveRate();
}

// Coalesce rapid slider 'input' events into one render per animation frame, so a
// continuous drag can never queue dozens of full recomputes and lock the main thread.
let _rerenderQueued = false;
function scheduleRerender() {
  if (_rerenderQueued) return;
  _rerenderQueued = true;
  requestAnimationFrame(() => { _rerenderQueued = false; rerender(); });
}
let _lettingQueued = false;
function scheduleLetting() {
  if (_lettingQueued) return;
  _lettingQueued = true;
  requestAnimationFrame(() => { _lettingQueued = false; rerenderLetting(); });
}

function rerender() {
  const result = runModel(DATA, currentOverrides());
  window.__model = result; // handy for inspection
  renderVerdict(result);
  renderPosition(result);
  renderSignal(result);
  renderProceeds(result);
  renderForecastChart(result);
  renderFactorScores(result);
  renderLetting(result);
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
function renderHeader() {
  $("#as-of").textContent = "Data as of " + monthName(DATA.META.asOf);
  $("#live-rate").textContent = pct(DATA.RATES.baseRateNow) + " base rate";
}

async function refreshLiveRate() {
  // The badge shows the curated snapshot by default. If an optional /api/boe-rate
  // endpoint happens to exist (a Cloudflare function or Worker route), light it up
  // with the live value. On a pure static host this fails fast — and it is strictly
  // time-boxed and content-type-guarded so it can NEVER hang the page or the tab.
  $("#live-rate").title = "Snapshot value — " + DATA.RATES.baseRateAsOf;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch("/api/boe-rate", { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) return;
    if (!(res.headers.get("content-type") || "").includes("application/json")) return; // static host returned HTML
    const data = await res.json();
    if (data && typeof data.rate === "number") {
      const badge = $("#live-rate");
      badge.textContent = pct(data.rate) + " base rate";
      badge.classList.add("live");
      badge.title = "Live from Bank of England" + (data.date ? " (" + data.date + ")" : "");
    }
  } catch (_) {
    // offline / static / aborted: keep the curated snapshot value
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Verdict hero
// ---------------------------------------------------------------------------
function renderVerdict(r) {
  const best = r.best;
  const sig = signalLabel(best.composite);
  const host = $("#verdict-body");

  const runnerUp = r.ranked[1];
  const reasons = topReasons(best);

  host.innerHTML = `
    <div class="verdict-grid">
      <div class="verdict-main">
        <div class="verdict-kicker">Model recommendation</div>
        <h2 class="verdict-window">${best.window.label}</h2>
        <div class="pill pill-${sig.tone}">${sig.label} · signal ${signed(best.composite)}</div>
        <p class="verdict-lead">
          Of the windows considered, <strong>${best.window.label}</strong> scores highest. Projected sale
          value <strong>${gbp(best.saleValue)}</strong> → estimated net proceeds
          <strong>${gbp(best.net)}</strong> after clearing the mortgage and all costs
          ${best.erc > 0 ? `(includes a ${gbp(best.erc)} early-repayment charge)` : `(no early-repayment charge — outside the fixed period)`}.
        </p>
        <ul class="verdict-reasons">${reasons.map((x) => `<li>${x}</li>`).join("")}</ul>
        <p class="verdict-note">Next best: <strong>${runnerUp.window.label}</strong> (signal ${signed(runnerUp.composite)}).
        This is a model, not advice — see the reasoning and sources below, and adjust the assumptions to your view.</p>
      </div>
      <div class="verdict-gauge">
        <div id="gauge"></div>
        <div class="gauge-caption">Composite sell-timing signal<br>for ${best.window.label}</div>
      </div>
    </div>`;
  C.gauge($("#gauge"), best.composite, sig.label);
}

function topReasons(w) {
  const out = [];
  const c = w.contributions;
  const entries = Object.entries(c).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const [k, v] of entries.slice(0, 3)) {
    const dir = v >= 0 ? "supports" : "argues against";
    out.push(`<strong>${FACTOR_LABELS[k]}</strong> ${dir} this window (${signed(v, (x) => x.toFixed(0))} pts).`);
  }
  if (w.erc > 0) out.push(`Selling here is still inside your fix, so a <strong>${gbp(w.erc)}</strong> early-repayment charge applies.`);
  else out.push(`Outside the fixed period — <strong>no early-repayment charge</strong>.`);
  return out;
}

// ---------------------------------------------------------------------------
// Your position
// ---------------------------------------------------------------------------
function renderPosition(r) {
  const p = DATA.PROPERTY, m = r.inputs.mortgage;
  const payNow = monthlyPayment(m.principal, m.ratePct, m.termYears);
  const equityNow = r.presentValue - balanceNow(r);
  const host = $("#position-body");
  host.innerHTML = `
    <div class="cards">
      ${card("Purchase", gbp(p.purchasePrice), monthName(p.purchaseDate) + " · " + p.postcode)}
      ${card("Est. value now", gbp(r.presentValue), valueDelta(r.presentValue - p.purchasePrice))}
      ${card("Mortgage", gbp(m.principal), (m.ltv * 100).toFixed(0) + "% LTV @ " + pct(m.ratePct))}
      ${card("Deposit / equity in", gbp(p.purchasePrice - m.principal), "at purchase")}
      ${card("Monthly payment", gbp(payNow), "capital & interest, " + m.termYears + "yr")}
      ${card("Est. equity now", gbp(equityNow), "value − outstanding balance")}
      ${card("Fix ends", monthName(m.fixEndDate), "then remortgage @ ~" + pct(m.remortgageRatePctAssumed))}
      ${card("Post-fix payment", gbp(r.holdingCost.after), signed(r.holdingCost.deltaMonthly, (x) => gbp(x)) + "/mo vs now")}
    </div>
    <p class="muted small">CGT: this is your main residence, so a sale qualifies for Private Residence Relief —
      <strong>normally no Capital Gains Tax</strong> at any sale date.</p>`;
}

function balanceNow(r) {
  // outstanding today = the "now" window economics minus its (small) projection
  const nowWin = r.windows.find((w) => w.window.id === "now");
  return nowWin ? nowWin.outstanding : r.inputs.mortgage.principal;
}

function valueDelta(d) {
  const cls = d >= 0 ? "up" : "down";
  return `<span class="delta ${cls}">${signed(d, gbp)}</span> vs purchase`;
}

function card(label, big, sub) {
  return `<div class="card"><div class="card-label">${label}</div>
    <div class="card-value">${big}</div><div class="card-sub">${sub}</div></div>`;
}

// ---------------------------------------------------------------------------
// Signal: ranking table + stacked contributions
// ---------------------------------------------------------------------------
function renderSignal(r) {
  const host = $("#signal-body");
  const rows = r.ranked.map((w, i) => {
    const sig = signalLabel(w.composite);
    return `<tr class="${i === 0 ? "best-row" : ""}">
      <td>${i === 0 ? "★ " : ""}${w.window.label}</td>
      <td><span class="pill pill-${sig.tone} mini">${signed(w.composite)}</span></td>
      <td>${gbp(w.saleValue)}</td>
      <td>${gbp(w.net)}</td>
      <td>${w.erc > 0 ? gbp(w.erc) : "—"}</td>
      <td class="muted">${sig.label}</td>
    </tr>`;
  }).join("");

  host.innerHTML = `
    <div class="chart-wrap"><div id="contrib-chart"></div>
      <p class="chart-cap">How each factor contributes to the signal for every window. Bars above zero push
      "sell here"; below zero push "wait". The black tick is the net signal. Weights:
      ${Object.entries(r.weights).map(([k, v]) => `${FACTOR_LABELS[k]} ${(v * 100).toFixed(0)}%`).join(" · ")}.</p>
    </div>
    <div class="table-wrap"><table class="rank-table">
      <thead><tr><th>Window</th><th>Signal</th><th>Est. sale value</th><th>Net proceeds</th><th>ERC</th><th>Read</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;

  const factors = Object.keys(FACTOR_LABELS).map((k) => ({ key: k, label: FACTOR_LABELS[k], color: FACTOR_COLORS[k] }));
  C.stackedContrib($("#contrib-chart"), r.windows, factors);
}

// ---------------------------------------------------------------------------
// Net proceeds chart + table
// ---------------------------------------------------------------------------
function renderProceeds(r) {
  const host = $("#proceeds-body");
  const bars = r.windows.map((w) => ({
    label: w.window.label,
    value: w.net,
    color: w === r.best ? "#16a34a" : "#0891b2",
    valueLabel: gbp(w.net),
    sub: w.erc > 0 ? "−" + gbp(w.erc) + " ERC" : "no ERC",
  }));
  host.innerHTML = `
    <div class="chart-wrap"><div id="proceeds-chart"></div>
      <p class="chart-cap">Estimated cash in hand after repaying the mortgage, early-repayment charge (if any),
      agent + VAT, legal and EPC costs. Scenario: <strong>${state.custom ? "Custom" : r.scenarioName}</strong>.</p></div>
    <div class="table-wrap"><table class="rank-table">
      <thead><tr><th>Window</th><th>Sale value</th><th>Outstanding</th><th>ERC</th><th>Selling costs</th><th>CGT</th><th>Net</th></tr></thead>
      <tbody>${r.windows.map((w) => `<tr class="${w === r.best ? "best-row" : ""}">
        <td>${w.window.label}</td><td>${gbp(w.saleValue)}</td><td>${gbp(w.outstanding)}</td>
        <td>${w.erc > 0 ? gbp(w.erc) : "—"}</td><td>${gbp(w.costs.total)}</td><td>£0</td>
        <td><strong>${gbp(w.net)}</strong></td></tr>`).join("")}</tbody>
    </table></div>`;
  C.barChart($("#proceeds-chart"), { bars, yFormat: (v) => "£" + Math.round(v / 1000) + "k", height: 300 });
}

// ---------------------------------------------------------------------------
// Forecast value path chart
// ---------------------------------------------------------------------------
function renderForecastChart(r) {
  const host = $("#forecast-chart");
  const toPts = (path) => path.map((p) => ({ x: monthName(p.date), y: p.value }));
  const base = r.forecastPaths.base, opt = r.forecastPaths.optimistic, pes = r.forecastPaths.pessimistic;
  const active = r.forecastPaths.active;

  const markers = [];
  const fixLabel = monthName(DATA.MORTGAGE.fixEndDate);
  if (base.some((p) => monthName(p.date) === fixLabel)) markers.push({ x: fixLabel, label: "fix ends" });

  C.lineChart(host, {
    height: 320,
    series: [
      { name: "Active scenario", color: "#2563eb", points: toPts(active), width: 3, dots: false },
      { name: "Optimistic", color: "#16a34a", points: toPts(opt), dashed: true, dots: false },
      { name: "Pessimistic", color: "#dc2626", points: toPts(pes), dashed: true, dots: false },
    ],
    band: { lower: pes.map((p) => p.value), upper: opt.map((p) => p.value), color: "#2563eb" },
    yFormat: (v) => "£" + Math.round(v / 1000) + "k",
    yRef: DATA.PROPERTY.purchasePrice,
    yRefLabel: "purchase " + gbp(DATA.PROPERTY.purchasePrice),
    markers,
  });
}

// ---------------------------------------------------------------------------
// Per-window factor scores (diverging) for the recommended window
// ---------------------------------------------------------------------------
function renderFactorScores(r) {
  const host = $("#factor-scores");
  const w = r.best;
  const items = Object.keys(FACTOR_LABELS).map((k) => ({
    label: FACTOR_LABELS[k], value: w.factors[k], color: FACTOR_COLORS[k],
  }));
  host.innerHTML = `<p class="chart-cap">Raw factor scores for the recommended window
    (<strong>${w.window.label}</strong>), before weighting. Range −100 to +100.</p><div id="factor-div"></div>`;
  C.divergingBars($("#factor-div"), { items });
}

// ---------------------------------------------------------------------------
// Static factor charts (price history, rates) — rendered once
// ---------------------------------------------------------------------------
function renderStaticFactorChartsOnce() {
  // Price history (£) — Islington vs London, anchored to purchase
  const ph = DATA.PRICE_HISTORY;
  const toGBP = (idx) => (idx / 100) * DATA.PROPERTY.purchasePrice;
  C.lineChart($("#price-chart"), {
    height: 300,
    series: [
      { name: "Your flat (Islington-tracked)", color: "#2563eb",
        points: ph.series.map((s) => ({ x: monthName(s.date), y: toGBP(s.islington) })) },
      { name: "London-wide", color: "#9333ea", dashed: true,
        points: ph.series.map((s) => ({ x: monthName(s.date), y: toGBP(s.london) })) },
    ],
    yFormat: (v) => "£" + Math.round(v / 1000) + "k",
    yRef: DATA.PROPERTY.purchasePrice, yRefLabel: "purchase",
  });

  // Rates chart — base rate, 2yr fix, your rate
  const rr = DATA.RATES;
  const fixLabels = rr.fix2yrSeries.map((s) => monthName(s.date));
  C.lineChart($("#rates-chart"), {
    height: 300,
    series: [
      { name: "Avg 2yr fix", color: "#dc2626", points: rr.fix2yrSeries.map((s) => ({ x: monthName(s.date), y: s.rate })) },
      { name: "BoE base rate", color: "#0891b2",
        points: rr.fix2yrSeries.map((s) => {
          const b = nearestBase(rr.baseSeries, s.date);
          return { x: monthName(s.date), y: b };
        }) },
      { name: "Your fixed rate", color: "#16a34a", dashed: true,
        points: rr.fix2yrSeries.map((s) => ({ x: monthName(s.date), y: rr.yourRate })) },
    ],
    yFormat: (v) => v.toFixed(1) + "%",
  });
}

function nearestBase(series, dateISO) {
  const t = new Date(dateISO + "-01");
  let best = series[0];
  for (const s of series) if (new Date(s.date + "-01") <= t) best = s;
  return best.rate;
}

// ---------------------------------------------------------------------------
// Rent-it-out vs sell comparison
// ---------------------------------------------------------------------------
function computeLetting(r) {
  const L = state.letting;
  const letCfg = {
    ...DATA.LETTING,
    monthlyRent: L.monthlyRent,
    serviceChargeGroundRentPerYear: L.serviceCharge,
    selfManage: L.selfManage,
    opportunityRatePct: L.opportunityRate,
    letMortgageRatePctAfterFix: DATA.LETTING.letMortgageRatePctAfterFix,
  };
  const tax = { ...DATA.TAX, marginalBand: L.taxBand };
  const mortgage = { ...r.inputs.mortgage, _purchaseDate: DATA.PROPERTY.purchaseDate };
  const sellNowNet = r.windows.find((w) => w.window.id === "now").net;
  return rentVsSell({
    property: DATA.PROPERTY, mortgage, sellingCfg: r.inputs.sellingCfg,
    presentValue: r.presentValue, presentISO: DATA.META.asOf,
    growthByYear: r.growthByYear, saleDate: L.horizon,
    letCfg, TAX: tax, sellNowNet,
  });
}

function renderLetting(r) {
  const res = computeLetting(r);
  const host = $("#letting-summary");
  const wins = res.advantageLet >= 0;
  const horizonLabel = (LET_HORIZONS.find((h) => h.date === state.letting.horizon) || {}).label || res.saleDate;
  const bandLabel = { basic: "basic-rate (20%)", higher: "higher-rate (40→42%)", additional: "additional-rate (45→47%)" }[res.band];

  host.innerHTML = `
    <div class="verdict-kicker">Sell now vs. let it &amp; sell in ${horizonLabel}</div>
    <p class="letting-lead">
      Over <strong>${res.years.toFixed(1)} years</strong>, letting it out and selling in ${horizonLabel} is projected to leave you
      <strong class="${wins ? "delta up" : "delta down"}">${gbp(Math.abs(res.advantageLet))}</strong>
      ${wins ? "better" : "worse"} off than selling now and investing the proceeds at ${pct(state.letting.opportunityRate)}.
      Assumes a ${bandLabel} taxpayer; mortgage interest gets the 20% Section&nbsp;24 credit, not full relief.
    </p>
    <div class="cards">
      ${card("Cumulative net rent", gbp(res.cumulativeNetRent), res.cumulativeNetRent < 0 ? "after mortgage, costs & tax" : "after costs & tax")}
      ${card("Net sale in " + horizonLabel, gbp(res.sale.netSaleProceeds), res.sale.cgt > 0 ? "incl. " + gbp(res.sale.cgt) + " CGT" : "CGT £0 here")}
      ${card("Let &amp; sell — total", gbp(res.letTotal), "rent cash-flow + net sale")}
      ${card("Sell now &amp; invest", gbp(res.sellNowGrown), gbp(res.sellNowNet) + " grown @ " + pct(state.letting.opportunityRate))}
    </div>
    <div class="chart-wrap"><div id="letting-chart"></div>
      <p class="chart-cap">Projected total wealth at ${horizonLabel} under each path. Letting is dragged down by
      negative monthly cash flow (rent doesn't cover a capital-repayment mortgage of this size) but builds equity and
      captures price recovery; selling now realises cash you can invest elsewhere.</p></div>`;

  C.barChart($("#letting-chart"), {
    bars: [
      { label: "Let & sell later", value: res.letTotal, color: wins ? "#16a34a" : "#0891b2", valueLabel: gbp(res.letTotal) },
      { label: "Sell now & invest", value: res.sellNowGrown, color: wins ? "#0891b2" : "#16a34a", valueLabel: gbp(res.sellNowGrown) },
    ],
    yFormat: (v) => "£" + Math.round(v / 1000) + "k", height: 280,
  });

  // year-by-year table + CGT/relief breakdown
  const tHost = $("#letting-table");
  const s = res.sale;
  tHost.innerHTML = `
    <div class="table-wrap"><table class="rank-table">
      <thead><tr><th>Year from</th><th>Gross rent*</th><th>Running costs</th><th>Mortgage interest</th><th>Income tax</th><th>Net cash flow</th></tr></thead>
      <tbody>${res.yearsTable.map((y) => `<tr>
        <td>${monthName(y.label)}</td><td>${gbp(y.grossRent)}</td><td>${gbp(y.opex)}</td>
        <td>${gbp(y.interest)}</td><td>${gbp(y.tax)}</td>
        <td class="${y.netCashFlow >= 0 ? "" : "neg-cell"}"><strong>${gbp(y.netCashFlow)}</strong></td></tr>`).join("")}
      </tbody>
    </table>
    <p class="muted small">*Effective of a ${DATA.LETTING.voidMonthsPerYear}-month/yr void allowance. Running costs =
      letting agent ${state.letting.selfManage ? "(self-managed: £0)" : DATA.LETTING.agentFeePct + "%+VAT"} + ${DATA.LETTING.maintenancePctOfRent}% maintenance +
      insurance + service charge/ground rent. Mortgage interest shown for the Section 24 credit; it is not a deductible expense.</p></div>
    <div class="cgt-box">
      <strong>Capital Gains Tax on the eventual sale</strong> — letting your former home erodes Private Residence Relief.
      You lived in it for ${s.monthsAsResidence} months; with the final 9 months always exempt, about
      <strong>${(s.chargeableFraction * 100).toFixed(0)}%</strong> of the gain over ${res.years.toFixed(1)} years is chargeable.
      Estimated gain ${gbp(s.totalGain)} → chargeable ${gbp(s.chargeableGain)} → CGT <strong>${gbp(s.cgt)}</strong>
      (residential rate for a ${res.band}-rate taxpayer, after the ${gbp(DATA.TAX.cgtAnnualExempt)} annual allowance).
      Selling <em>now</em> keeps the gain fully CGT-exempt.
    </div>`;
}

function buildLettingControls() {
  const host = $("#letting-controls");
  host.innerHTML = `
    <div class="controls-grid">
      <label class="ctrl"><span>Sell horizon (let until)</span>
        <select id="let-horizon">${LET_HORIZONS.map((h) =>
          `<option value="${h.date}" ${h.date === state.letting.horizon ? "selected" : ""}>${h.label}</option>`).join("")}</select></label>
      <label class="ctrl"><span>Your income tax band</span>
        <select id="let-band">
          <option value="basic" ${state.letting.taxBand === "basic" ? "selected" : ""}>Basic (20%)</option>
          <option value="higher" ${state.letting.taxBand === "higher" ? "selected" : ""}>Higher (40% → 42%)</option>
          <option value="additional" ${state.letting.taxBand === "additional" ? "selected" : ""}>Additional (45% → 47%)</option>
        </select></label>
      <label class="ctrl"><span>Monthly rent: <strong id="lbl-rent">${gbp(state.letting.monthlyRent)}</strong></span>
        <input id="let-rent" type="range" min="2000" max="4200" step="25" value="${state.letting.monthlyRent}"></label>
      <label class="ctrl"><span>Service charge + ground rent/yr: <strong id="lbl-sc">${gbp(state.letting.serviceCharge)}</strong></span>
        <input id="let-sc" type="range" min="0" max="8000" step="100" value="${state.letting.serviceCharge}"></label>
      <label class="ctrl"><span>Opportunity return on sale cash: <strong id="lbl-opp">${pct(state.letting.opportunityRate)}</strong></span>
        <input id="let-opp" type="range" min="0" max="8" step="0.25" value="${state.letting.opportunityRate}"></label>
      <label class="ctrl ctrl-check"><input id="let-self" type="checkbox" ${state.letting.selfManage ? "checked" : ""}>
        <span>Self-manage (no letting agent fee)</span></label>
    </div>`;

  $("#let-horizon").addEventListener("change", (e) => { state.letting.horizon = e.target.value; rerenderLetting(); });
  $("#let-band").addEventListener("change", (e) => { state.letting.taxBand = e.target.value; rerenderLetting(); });
  $("#let-rent").addEventListener("input", (e) => {
    state.letting.monthlyRent = parseFloat(e.target.value); $("#lbl-rent").textContent = gbp(state.letting.monthlyRent); scheduleLetting();
  });
  $("#let-sc").addEventListener("input", (e) => {
    state.letting.serviceCharge = parseFloat(e.target.value); $("#lbl-sc").textContent = gbp(state.letting.serviceCharge); scheduleLetting();
  });
  $("#let-opp").addEventListener("input", (e) => {
    state.letting.opportunityRate = parseFloat(e.target.value); $("#lbl-opp").textContent = pct(state.letting.opportunityRate); scheduleLetting();
  });
  $("#let-self").addEventListener("change", (e) => { state.letting.selfManage = e.target.checked; rerenderLetting(); });
}

function rerenderLetting() {
  renderLetting(runModel(DATA, currentOverrides()));
}

// ---------------------------------------------------------------------------
// Scenario controls
// ---------------------------------------------------------------------------
function buildControls() {
  const host = $("#controls-body");
  const yrs = Object.keys(DATA.FORECAST.scenarios.base);
  host.innerHTML = `
    <div class="controls-grid">
      <label class="ctrl">
        <span>Forecast scenario</span>
        <select id="ctrl-scenario">
          <option value="pessimistic">Pessimistic</option>
          <option value="base" selected>Base (consensus)</option>
          <option value="optimistic">Optimistic</option>
        </select>
      </label>
      <label class="ctrl">
        <span>Remortgage rate after fix: <strong id="lbl-remo">${pct(state.remortgageRate)}</strong></span>
        <input id="ctrl-remo" type="range" min="3.5" max="7" step="0.05" value="${state.remortgageRate}">
      </label>
      <label class="ctrl">
        <span>Est. value now: <strong id="lbl-pv"></strong></span>
        <input id="ctrl-pv" type="range" min="780000" max="980000" step="5000">
      </label>
      ${yrs.map((y) => `
      <label class="ctrl">
        <span>${y} growth: <strong id="lbl-g${y}">${state.growthByYear[y].toFixed(1)}%</strong></span>
        <input class="ctrl-growth" data-year="${y}" type="range" min="-8" max="10" step="0.5" value="${state.growthByYear[y]}">
      </label>`).join("")}
      <button id="ctrl-reset" class="btn-reset" type="button">Reset to consensus</button>
    </div>
    <p class="muted small">Sliders recompute every chart and the recommendation live. Defaults reflect the
      Savills / Knight Frank / Zoopla consensus and the June 2026 rate market.</p>`;

  // init present-value slider to derived value
  const derived = runModel(DATA, {}).presentValue;
  const pvInput = $("#ctrl-pv");
  pvInput.value = Math.round(derived / 5000) * 5000;
  $("#lbl-pv").textContent = gbp(pvInput.value);

  $("#ctrl-scenario").addEventListener("change", (e) => {
    state.scenario = e.target.value;
    state.custom = false;
    state.growthByYear = { ...DATA.FORECAST.scenarios[state.scenario] };
    syncGrowthSliders();
    rerender();
  });
  $("#ctrl-remo").addEventListener("input", (e) => {
    state.remortgageRate = parseFloat(e.target.value);
    $("#lbl-remo").textContent = pct(state.remortgageRate);
    scheduleRerender();
  });
  pvInput.addEventListener("input", (e) => {
    state.presentValue = parseFloat(e.target.value);
    $("#lbl-pv").textContent = gbp(state.presentValue);
    scheduleRerender();
  });
  document.querySelectorAll(".ctrl-growth").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const y = e.target.dataset.year;
      state.growthByYear[y] = parseFloat(e.target.value);
      state.custom = true;
      $("#lbl-g" + y).textContent = state.growthByYear[y].toFixed(1) + "%";
      scheduleRerender();
    });
  });
  $("#ctrl-reset").addEventListener("click", () => {
    state.scenario = DATA.FORECAST.defaultScenario;
    state.custom = false;
    state.growthByYear = { ...DATA.FORECAST.scenarios[state.scenario] };
    state.remortgageRate = DATA.MORTGAGE.remortgageRatePctAssumed;
    state.presentValue = null;
    $("#ctrl-scenario").value = state.scenario;
    $("#ctrl-remo").value = state.remortgageRate;
    $("#lbl-remo").textContent = pct(state.remortgageRate);
    pvInput.value = Math.round(derived / 5000) * 5000;
    $("#lbl-pv").textContent = gbp(pvInput.value);
    syncGrowthSliders();
    rerender();
  });
}

function syncGrowthSliders() {
  document.querySelectorAll(".ctrl-growth").forEach((inp) => {
    const y = inp.dataset.year;
    inp.value = state.growthByYear[y];
    $("#lbl-g" + y).textContent = state.growthByYear[y].toFixed(1) + "%";
  });
}

document.addEventListener("DOMContentLoaded", boot);
