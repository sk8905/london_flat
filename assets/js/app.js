// =============================================================================
// app.js  —  Entry point: load data, run model, render the single page, wire UI
// =============================================================================

import * as DATA from "../data/dataset.js?v=21";
import { runModel, signalLabel, FACTOR_LABELS } from "./model.js?v=21";
import * as C from "./charts.js?v=21";
import { monthlyPayment, monthsBetween, ymIndex, ymToISO } from "./finance.js?v=21";
import { rentVsSell } from "./letting.js?v=21";

const $ = (sel, root = document) => root.querySelector(sel);
const gbp = (n) => (n < 0 ? "−" : "") + "£" + Math.abs(Math.round(n)).toLocaleString("en-GB");
const signed = (n, f = (x) => x.toFixed(0)) => (n >= 0 ? "+" : "") + f(n);
const pct = (n) => n.toFixed(2) + "%";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (iso) => MONTHS[parseInt(iso.slice(5, 7), 10) - 1] + " " + iso.slice(0, 4);

const FACTOR_COLORS = {
  priceTrajectory: "#33566b",
  financingCost: "#6b5b7b",
  netProceeds: "#4a7c8c",
  seasonality: "#9a7b4f",
  policyMacro: "#3a6b54",
};

const num = (v, fb = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; };

// England & NI standard residential SDLT (single property, not first-time-buyer).
function computeSDLT(price) {
  const bands = [[125000, 0], [250000, 0.02], [925000, 0.05], [1500000, 0.10], [Infinity, 0.12]];
  let tax = 0, prev = 0;
  for (const [cap, rate] of bands) {
    if (price <= prev) break;
    tax += (Math.min(price, cap) - prev) * rate;
    prev = cap;
  }
  return Math.round(tax);
}

// ---- editable inputs (your real figures), persisted to the browser ----------
const LS_KEY = "flatForecaster.inputs.v2";
function defaultInputs() {
  return {
    purchasePrice: DATA.PROPERTY.purchasePrice,
    purchaseDate: DATA.PROPERTY.purchaseDate.slice(0, 7),
    postcode: DATA.PROPERTY.postcode,
    isPrimaryResidence: DATA.PROPERTY.isPrimaryResidence,
    floorAreaSqm: DATA.PROPERTY.floorAreaSqm,
    bedrooms: DATA.PROPERTY.bedrooms,
    bathrooms: DATA.PROPERTY.bathrooms,
    buildYear: DATA.PROPERTY.buildYear,
    perSqmMedian: DATA.COMPARABLES.perSqm.median,
    sdlt: 35500, // your actual SDLT paid
    otherBuyCosts: 0,
    mortgageAmount: DATA.MORTGAGE.principal,
    ratePct: DATA.MORTGAGE.ratePct,
    fixEndDate: DATA.MORTGAGE.fixEndDate.slice(0, 7),
    termYears: DATA.MORTGAGE.termYears,
    repaymentType: DATA.MORTGAGE.repaymentType,
    ercPct: DATA.MORTGAGE.ercPctWhileFixed,
    remortgageFixYears: DATA.MORTGAGE.remortgageFixYears,
    remortgageErcPct: DATA.MORTGAGE.remortgageErcPct,
    agentPct: DATA.SELLING_COSTS.agentPct,
    vatPct: DATA.SELLING_COSTS.vatPct,
    legalFixed: DATA.SELLING_COSTS.legalFixed,
    epcMisc: DATA.SELLING_COSTS.epcAndMiscFixed,
  };
}
function loadInputs() {
  try { const s = localStorage.getItem(LS_KEY); return s ? { ...defaultInputs(), ...JSON.parse(s) } : defaultInputs(); }
  catch (_) { return defaultInputs(); }
}
function saveInputs() { try { localStorage.setItem(LS_KEY, JSON.stringify(state.inputs)); } catch (_) {} }

// Merge the user's inputs onto the curated dataset before running the model.
function effectiveData() {
  const i = state.inputs;
  const purchasePrice = num(i.purchasePrice, DATA.PROPERTY.purchasePrice);
  const principal = num(i.mortgageAmount, DATA.MORTGAGE.principal);
  return {
    ...DATA,
    PROPERTY: { ...DATA.PROPERTY, purchasePrice, purchaseDate: i.purchaseDate, postcode: i.postcode,
      isPrimaryResidence: !!i.isPrimaryResidence, sdltPaid: num(i.sdlt), otherBuyCosts: num(i.otherBuyCosts),
      floorAreaSqm: num(i.floorAreaSqm, DATA.PROPERTY.floorAreaSqm), bedrooms: num(i.bedrooms, DATA.PROPERTY.bedrooms),
      bathrooms: num(i.bathrooms, DATA.PROPERTY.bathrooms), buildYear: num(i.buildYear, DATA.PROPERTY.buildYear) },
    COMPARABLES: { ...DATA.COMPARABLES, perSqm: { ...DATA.COMPARABLES.perSqm, median: num(i.perSqmMedian, DATA.COMPARABLES.perSqm.median) } },
    MORTGAGE: { ...DATA.MORTGAGE, principal, ltv: purchasePrice ? principal / purchasePrice : 0,
      ratePct: num(i.ratePct, DATA.MORTGAGE.ratePct), fixEndDate: i.fixEndDate, termYears: num(i.termYears, DATA.MORTGAGE.termYears),
      repaymentType: i.repaymentType, ercPctWhileFixed: num(i.ercPct, DATA.MORTGAGE.ercPctWhileFixed),
      remortgageFixYears: num(i.remortgageFixYears, DATA.MORTGAGE.remortgageFixYears),
      remortgageErcPct: num(i.remortgageErcPct, DATA.MORTGAGE.remortgageErcPct) },
    SELLING_COSTS: { ...DATA.SELLING_COSTS, agentPct: num(i.agentPct), vatPct: num(i.vatPct), legalFixed: num(i.legalFixed), epcAndMiscFixed: num(i.epcMisc) },
  };
}

// Mutable override state driven by the controls.
const state = {
  scenario: DATA.FORECAST.defaultScenario,
  growthByYear: { ...DATA.FORECAST.scenarios[DATA.FORECAST.defaultScenario] },
  remortgageRate: DATA.MORTGAGE.remortgageRatePctAssumed,
  presentValue: null, // null => derive from index
  custom: false,
  inputs: loadInputs(),
  letting: {
    horizon: "2028-04-01",
    monthlyRent: DATA.LETTING.monthlyRent,
    taxBand: DATA.TAX.marginalBand,
    serviceCharge: DATA.LETTING.serviceChargeGroundRentPerYear,
    selfManage: DATA.LETTING.selfManage,
    opportunityRate: DATA.LETTING.opportunityRatePct,
    interestOnly: DATA.LETTING.interestOnly,
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
// Surface any runtime error as a visible banner instead of a silent freeze/blank,
// so problems are diagnosable on a remote machine.
function showFatal(msg) {
  let b = document.getElementById("fatal-banner");
  if (!b) { b = document.createElement("div"); b.id = "fatal-banner"; document.body.prepend(b); }
  b.textContent = "⚠ " + msg + " — please screenshot this.";
}
window.addEventListener("error", (e) => {
  // Only surface genuine errors thrown by THIS app's own scripts. Opaque
  // cross-origin "Script error." events (Safari extensions, content blockers,
  // injected scripts) carry no message/filename and are not actionable — ignore.
  const msg = e && e.message ? e.message : "";
  const ours = e && e.filename && e.filename.indexOf("/assets/js/") !== -1;
  if (!msg || /script error/i.test(msg) || !ours) return;
  showFatal(msg + (e.lineno ? " @ " + e.filename.split("/").pop() + ":" + e.lineno : ""));
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e && e.reason;
  if (r && r.message) showFatal("promise: " + r.message); // skip opaque rejections
});

const PAGE_META = {
  dashboard: ["Dashboard", "Your at-a-glance sell-timing summary"],
  signal: ["Timing signal", "The weighted score across windows and factors"],
  market: ["Market & factors", "Prices, rates, forecasts and policy — with sources"],
  comps: ["Recent N1 sales", "Actual sold 2-bed flats — size, baths, type & £/m²"],
  finances: ["Your finances", "Your position and projected net proceeds"],
  selllet: ["Sell vs let", "Keep and rent it out, or sell now?"],
  assumptions: ["Assumptions", "Tweak the forecast and read the methodology"],
  inputs: ["Inputs", "Enter your real purchase, mortgage & cost figures"],
};

function switchTab(id) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + id));
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  const meta = PAGE_META[id] || ["", ""];
  $("#page-title").textContent = meta[0];
  $("#page-sub").textContent = meta[1];
  window.scrollTo(0, 0);
  // keep the active tab visible in the horizontal mobile nav
  const activeBtn = document.querySelector(`.nav-item[data-tab="${id}"]`);
  if (activeBtn) activeBtn.scrollIntoView({ inline: "center", block: "nearest" });
}

function wireNav() {
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.addEventListener("click", () => switchTab(b.dataset.tab)));
}

function boot() {
  try {
    renderHeader();
    rerender();
    buildControls();
    buildLettingControls();
    buildInputs();
    wireNav();
    loadIdentity();
  } catch (err) {
    showFatal(err && err.message ? err.message : String(err));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Cloudflare Access identity (sign-in status + sign-out)
// ---------------------------------------------------------------------------
async function loadIdentity() {
  const text = $("#user-status-text"), email = $("#user-email"), initial = $("#user-initial");
  const chip = document.querySelector(".user-chip");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch("/cdn-cgi/access/get-identity", { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error("no access");
    if (!(res.headers.get("content-type") || "").includes("json")) throw new Error("not json");
    const id = await res.json();
    const who = id.email || id.name || "Signed in";
    text.textContent = "Signed in";
    email.textContent = who;
    initial.textContent = (who[0] || "•").toUpperCase();
    if (chip) chip.querySelector(".user-status").classList.add("online");
  } catch (_) {
    // Local/dev or no Access session: show a neutral state, keep sign-out available.
    text.textContent = "Local preview";
    email.textContent = "not behind Access";
    initial.textContent = "•";
  } finally {
    clearTimeout(timer);
  }
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
  const result = runModel(effectiveData(), currentOverrides());
  window.__model = result; // handy for inspection
  renderVerdict(result);
  renderDashboard(result);
  renderPosition(result);
  renderSignal(result);
  renderProceeds(result);
  renderForecastChart(result);
  renderFactorCharts(result);
  renderComps(result);
  renderFactorScores(result);
  renderLetting(result);
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
function renderHeader() {
  $("#as-of").textContent = "Data as of " + monthName(DATA.META.asOf);
  const badge = $("#live-rate");
  badge.textContent = pct(DATA.RATES.baseRateNow) + " base rate";
  badge.title = "Snapshot value — " + DATA.RATES.baseRateAsOf;
  const build = $("#build");
  if (build) build.textContent = "build " + (DATA.META.build || "—");
  // No network calls: the rate is the curated snapshot in dataset.js. This keeps the
  // page 100% static with zero post-load activity behind Zero Trust.
}

// ---------------------------------------------------------------------------
// Verdict hero
// ---------------------------------------------------------------------------
function renderVerdict(r) {
  const best = r.best;
  const sig = signalLabel(best.composite);
  const host = $("#verdict-body");
  const runnerUp = r.ranked[1];
  const cashIn = cashInvested(r).total;
  const profitBest = best.net - cashIn;

  host.innerHTML = `
    <div class="verdict-head">
      <div>
        <div class="verdict-kicker">Model recommendation</div>
        <h2 class="verdict-window">${best.window.label}</h2>
      </div>
      <div class="pill pill-${sig.tone}">${sig.label} · signal ${signed(best.composite)}</div>
    </div>
    <p class="verdict-lead">
      Highest-scoring window. Sale value <strong>${gbp(best.saleValue)}</strong> → net proceeds
      <strong>${gbp(best.net)}</strong> → <strong>${gbp(profitBest)}</strong> profit after your ${gbp(cashIn)} deposit + SDLT
      ${best.erc > 0 ? `(after a ${gbp(best.erc)} ERC)` : `(no ERC — outside the fix)`}.
      Next best: <strong>${runnerUp.window.label}</strong> (signal ${signed(runnerUp.composite)}).
      <span class="muted">Model, not advice — see the reasoning and sources below.</span>
    </p>`;
}

// ---------------------------------------------------------------------------
// Dashboard summary
// ---------------------------------------------------------------------------
function renderDashboard(r) {
  const best = r.best;
  const equityNow = r.presentValue - balanceNow(r);
  const let2 = computeLetting(r);
  const horizonLabel = (LET_HORIZONS.find((h) => h.date === state.letting.horizon) || {}).label || "horizon";
  const letWins = let2.advantageLet >= 0;

  // KPIs
  const deposit = r.inputs.property.purchasePrice - r.inputs.mortgage.principal;
  const buyCosts = (r.inputs.property.sdltPaid || 0) + (r.inputs.property.otherBuyCosts || 0);
  const cashIn = deposit + buyCosts; // total cash you sank in at purchase
  const profitBest = best.net - cashIn;
  $("#dash-kpis").innerHTML = [
    kpi("Best-window net proceeds", gbp(best.net), "total cash in hand · " + best.window.label, "pos"),
    kpi("Profit after deposit &amp; SDLT", gbp(profitBest), `net − ${gbp(cashIn)} you put in`, profitBest >= 0 ? "gold" : "neg"),
    kpi("Est. equity now", gbp(equityNow), "value − mortgage balance"),
    kpi(`Let vs sell (to ${horizonLabel})`, signed(let2.advantageLet, gbp), letWins ? "letting ahead" : "selling ahead", letWins ? "pos" : "neg"),
  ].join("");

  // mini charts
  C.barChart($("#dash-signal-chart"), {
    bars: r.windows.map((w) => ({
      label: w.window.label.replace(/ \(.*\)/, ""), value: Math.round(w.composite),
      color: w === best ? "#33566b" : (w.composite >= 0 ? "#aebfc9" : "#d9b3b3"),
      valueLabel: signed(w.composite),
    })),
    yFormat: (v) => v.toFixed(0), height: 240, baseline: 0, yUnit: "signal score",
  });
  C.barChart($("#dash-proceeds-chart"), {
    bars: r.windows.map((w) => ({
      label: w.window.label.replace(/ \(.*\)/, ""), value: w.net,
      color: w === best ? "#3a6b54" : "#a9c6b6", valueLabel: gbp(w.net),
      sub: (w.net - cashIn >= 0 ? "+" + gbp(w.net - cashIn) + " profit" : gbp(w.net - cashIn) + " short"),
    })),
    yFormat: (v) => "£" + Math.round(v / 1000) + "k", height: 260, yUnit: "£ proceeds",
    yRef: cashIn, yRefLabel: "you put in " + gbp(cashIn) + " (deposit + SDLT)",
  });

  // drivers
  const entries = Object.entries(best.contributions).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
  $("#dash-drivers").innerHTML = `<div class="drivers">${entries.map(([k, v]) => `
    <div class="driver">
      <div class="driver-top"><span class="driver-name">${FACTOR_LABELS[k]}</span>
        <span class="driver-score ${v >= 0 ? "pos" : "neg"}">${signed(v, (x) => x.toFixed(0))}</span></div>
      <div class="driver-text">${driverText(k, best)}</div>
    </div>`).join("")}</div>`;

  // quick links
  $("#dash-links").innerHTML = [
    qlink("signal", "Full timing signal"),
    qlink("market", "Explore market & factors"),
    qlink("finances", "See your finances"),
    qlink("selllet", "Sell vs let analysis"),
  ].join("");
  document.querySelectorAll("#dash-links .qlink").forEach((b) =>
    b.addEventListener("click", () => switchTab(b.dataset.go)));
}

function kpi(label, value, sub, tone) {
  return `<div class="kpi ${tone || ""}"><div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}
function qlink(go, label) { return `<button class="qlink" data-go="${go}">${label}</button>`; }

function driverText(k, w) {
  switch (k) {
    case "priceTrajectory": return `Projected value ${gbp(w.saleValue)} with ${w.momentum >= 0 ? "positive" : "negative"} momentum (${w.momentum.toFixed(1)}%/yr).`;
    case "financingCost": return w.erc > 0 ? `Inside the fix — a ${gbp(w.erc)} early-repayment charge applies.` : `Outside the fix — no early-repayment charge.`;
    case "netProceeds": return `Cash in hand of ${gbp(w.net)} after all costs.`;
    case "seasonality": return `Demand strength index ${w.season.toFixed(2)} for this window's month.`;
    case "policyMacro": return `Net of CGT exemption, the mansion-tax threshold and macro risk at this date.`;
    default: return "";
  }
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
  const p = r.inputs.property, m = r.inputs.mortgage;
  const io = m.repaymentType === "interest_only";
  const payNow = io ? m.principal * (m.ratePct / 100 / 12) : monthlyPayment(m.principal, m.ratePct, m.termYears);
  const equityNow = r.presentValue - balanceNow(r);
  const v = r.valuation;
  const host = $("#position-body");
  const valBox = v.compVal ? `
    <div class="val-box">
      <div class="val-head">Estimated current value — anchored to <strong>actual sold prices</strong></div>
      <div class="val-main">${gbp(r.presentValue)} <span class="val-sub">≈ ${gbp(v.impliedPerSqm)}/m² · ${p.floorAreaSqm} m² (${p.bedrooms}-bed/${p.bathrooms}-bath, built ${p.buildYear})</span></div>
      <div class="val-anchors">
        <span>① Your purchase, trended by the Islington <strong>sold-price</strong> index: <strong>${gbp(v.indexVal)}</strong></span>
        <span>② £/m² comparable from N1 <strong>Land Registry sales</strong> (${gbp(v.perSqm.median)}/m²): <strong>${gbp(v.compVal)}</strong> <span class="muted">(range ${gbp(v.compLow)}–${gbp(v.compHigh)})</span></span>
        <span>For reference, you paid <strong>${gbp(p.purchasePrice)}</strong> = ${gbp(v.purchasePerSqm)}/m² in ${monthName(p.purchaseDate)}</span>
      </div>
      <p class="muted small">The headline value is the <strong>blend of anchors ① and ②</strong> — both based on real
        transactions, not asking prices or forecasts. Forward forecasts are used only to project this value into the future.</p>
    </div>` : "";
  host.innerHTML = valBox + `
    <div class="cards">
      ${card("Purchase", gbp(p.purchasePrice), monthName(p.purchaseDate) + " · " + p.postcode)}
      ${card("Est. value now", gbp(r.presentValue), valueDelta(r.presentValue - p.purchasePrice))}
      ${card("Mortgage", gbp(m.principal), (m.ltv * 100).toFixed(0) + "% LTV @ " + pct(m.ratePct))}
      ${card("Deposit / equity in", gbp(p.purchasePrice - m.principal), "at purchase")}
      ${card("Monthly payment", gbp(payNow), (io ? "interest-only" : "capital & interest") + ", " + m.termYears + "yr")}
      ${card("Est. equity now", gbp(equityNow), "value − outstanding balance")}
      ${card("Fix ends", monthName(m.fixEndDate), "then remortgage @ ~" + pct(m.remortgageRatePctAssumed))}
      ${card("Post-fix payment", gbp(r.holdingCost.after), signed(r.holdingCost.deltaMonthly, (x) => gbp(x)) + "/mo vs now")}
    </div>
    <p class="muted small">${p.isPrimaryResidence
      ? "CGT: this is your main residence, so a sale qualifies for Private Residence Relief — <strong>normally no Capital Gains Tax</strong> at any sale date."
      : "CGT: marked as <strong>not your main residence</strong> — a sale may be liable to Capital Gains Tax (see Sell vs let for the partial-relief estimate)."}</p>
    <p class="muted small">Edit any of these on the <strong>Inputs</strong> tab — your figures are saved in this browser.</p>`;
}

// Total cash you sank in at purchase: deposit + SDLT + other buying costs.
function cashInvested(r) {
  const deposit = r.inputs.property.purchasePrice - r.inputs.mortgage.principal;
  const buyCosts = (r.inputs.property.sdltPaid || 0) + (r.inputs.property.otherBuyCosts || 0);
  return { deposit, buyCosts, total: deposit + buyCosts };
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
  const cashIn = cashInvested(r).total;
  const rows = r.ranked.map((w, i) => {
    const sig = signalLabel(w.composite);
    const profit = w.net - cashIn;
    return `<tr class="${i === 0 ? "best-row" : ""}">
      <td>${i === 0 ? "★ " : ""}${w.window.label}</td>
      <td><span class="pill pill-${sig.tone} mini">${signed(w.composite)}</span></td>
      <td>${gbp(w.saleValue)}</td>
      <td>${gbp(w.net)}</td>
      <td class="${profit >= 0 ? "" : "neg-cell"}">${signed(profit, gbp)}</td>
      <td>${w.erc > 0 ? gbp(w.erc) : "—"}</td>
      <td class="muted">${sig.label}</td>
    </tr>`;
  }).join("");

  host.innerHTML = `
    <div class="chart-wrap"><div id="contrib-chart"></div>
      <p class="chart-cap">Vertical axis is the <strong>signal score in points (−100 to +100), not £</strong>. Each
      coloured segment is a factor's weighted contribution; bars above zero push "sell here", below zero push "wait".
      The black tick marks the net signal for that window. Weights:
      ${Object.entries(r.weights).map(([k, v]) => `${FACTOR_LABELS[k]} ${(v * 100).toFixed(0)}%`).join(" · ")}.</p>
    </div>
    <div class="table-wrap"><table class="rank-table">
      <thead><tr><th>Window</th><th>Signal</th><th>Est. sale value</th><th>Net proceeds</th><th>Net profit*</th><th>ERC</th><th>Read</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="muted small">*Net profit = net proceeds − your ${gbp(cashIn)} cash in (deposit + SDLT + buying costs).</p></div>`;

  const factors = Object.keys(FACTOR_LABELS).map((k) => ({ key: k, label: FACTOR_LABELS[k], color: FACTOR_COLORS[k] }));
  C.stackedContrib($("#contrib-chart"), r.windows, factors, 320, "signal score (pts)");
}

// ---------------------------------------------------------------------------
// Net proceeds chart + table
// ---------------------------------------------------------------------------
function renderProceeds(r) {
  const host = $("#proceeds-body");
  const { deposit, buyCosts, total: cashIn } = cashInvested(r);
  const bars = r.windows.map((w) => ({
    label: w.window.label,
    value: w.net, // net proceeds (cash in hand)
    color: w === r.best ? "#3a6b54" : "#a9c6b6",
    valueLabel: gbp(w.net),
    sub: (w.net - cashIn >= 0 ? "+" + gbp(w.net - cashIn) + " profit" : gbp(w.net - cashIn) + " short"),
  }));
  host.innerHTML = `
    <div class="chart-wrap"><div id="proceeds-chart"></div>
      <p class="chart-cap">Bars = <strong>net proceeds (cash in hand)</strong>. The dashed line is the
      <strong>${gbp(cashIn)} you put in</strong> (${gbp(deposit)} deposit + ${gbp(buyCosts)} SDLT/buying costs); the bar
      above it is your <strong>net profit</strong> (shown under each bar). Scenario:
      <strong>${state.custom ? "Custom" : r.scenarioName}</strong>.</p></div>
    <div class="table-wrap"><table class="rank-table">
      <thead><tr><th>Window</th><th>Sale value</th><th>Outstanding</th><th>ERC</th><th>Selling costs</th><th>CGT</th><th>Net proceeds</th><th>Less deposit + SDLT</th><th>Net profit</th></tr></thead>
      <tbody>${r.windows.map((w) => `<tr class="${w === r.best ? "best-row" : ""}">
        <td>${w.window.label}</td><td>${gbp(w.saleValue)}</td><td>${gbp(w.outstanding)}</td>
        <td>${w.erc > 0 ? gbp(w.erc) : "—"}</td><td>${gbp(w.costs.total)}</td><td>£0</td>
        <td>${gbp(w.net)}</td><td class="muted">−${gbp(cashIn)}</td>
        <td class="${w.net - cashIn >= 0 ? "" : "neg-cell"}"><strong>${gbp(w.net - cashIn)}</strong></td></tr>`).join("")}</tbody>
    </table>
    <p class="muted small"><strong>Net proceeds</strong> = sale value − outstanding mortgage − ERC − selling costs − CGT:
      the total cash you'd receive. <strong>Net profit</strong> then returns the <strong>${gbp(cashIn)}</strong> you originally
      put in (${gbp(deposit)} deposit + ${gbp(buyCosts)} SDLT/buying costs), leaving the true gain on your cash —
      your repaid mortgage principal and price growth, net of all costs.</p></div>`;
  C.barChart($("#proceeds-chart"), {
    bars, yFormat: (v) => "£" + Math.round(v / 1000) + "k", height: 300, yUnit: "£ proceeds",
    yRef: cashIn, yRefLabel: "you put in " + gbp(cashIn) + " (deposit + SDLT)",
  });
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
  const fixLabel = monthName(r.inputs.mortgage.fixEndDate);
  if (base.some((p) => monthName(p.date) === fixLabel)) markers.push({ x: fixLabel, label: "fix ends" });

  C.lineChart(host, {
    height: 320,
    series: [
      { name: "Active scenario", color: "#33566b", points: toPts(active), width: 3, dots: false },
      { name: "Optimistic", color: "#3a6b54", points: toPts(opt), dashed: true, dots: false },
      { name: "Pessimistic", color: "#9c4040", points: toPts(pes), dashed: true, dots: false },
    ],
    band: { lower: pes.map((p) => p.value), upper: opt.map((p) => p.value), color: "#33566b" },
    yFormat: (v) => "£" + Math.round(v / 1000) + "k",
    yUnit: "£ value",
    yRef: r.inputs.property.purchasePrice,
    yRefLabel: "purchase " + gbp(r.inputs.property.purchasePrice),
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
    (<strong>${w.window.label}</strong>) before weighting — each in <strong>signal points from −100 to +100</strong>
    (not £). Positive favours selling in this window.</p><div id="factor-div"></div>`;
  C.divergingBars($("#factor-div"), { items });
}

// ---------------------------------------------------------------------------
// Factor charts (price history, rates) — re-rendered so they track your inputs
// ---------------------------------------------------------------------------
function renderFactorCharts(r) {
  // Price history (£) — Islington vs London, anchored to your purchase price
  const ph = DATA.PRICE_HISTORY;
  const purchasePrice = r.inputs.property.purchasePrice;
  const toGBP = (idx) => (idx / 100) * purchasePrice;
  C.lineChart($("#price-chart"), {
    height: 300,
    series: [
      { name: "Your flat (Islington-tracked)", color: "#33566b",
        points: ph.series.map((s) => ({ x: monthName(s.date), y: toGBP(s.islington) })) },
      { name: "London-wide", color: "#6b5b7b", dashed: true,
        points: ph.series.map((s) => ({ x: monthName(s.date), y: toGBP(s.london) })) },
    ],
    yFormat: (v) => "£" + Math.round(v / 1000) + "k",
    yUnit: "£ value",
    yRef: purchasePrice, yRefLabel: "purchase",
  });

  // Rates chart — base rate, 2yr fix, your rate
  const rr = DATA.RATES;
  const yourRate = r.inputs.mortgage.ratePct;
  C.lineChart($("#rates-chart"), {
    height: 300,
    series: [
      { name: "Avg 2yr fix", color: "#9c4040", points: rr.fix2yrSeries.map((s) => ({ x: monthName(s.date), y: s.rate })) },
      { name: "BoE base rate", color: "#4a7c8c",
        points: rr.fix2yrSeries.map((s) => ({ x: monthName(s.date), y: nearestBase(rr.baseSeries, s.date) })) },
      { name: "Your fixed rate", color: "#3a6b54", dashed: true,
        points: rr.fix2yrSeries.map((s) => ({ x: monthName(s.date), y: yourRate })) },
    ],
    yFormat: (v) => v.toFixed(1) + "%",
    yUnit: "interest rate",
  });
}

function nearestBase(series, dateISO) {
  const t = ymIndex(dateISO);
  let best = series[0];
  for (const s of series) if (ymIndex(s.date) <= t) best = s;
  return best.rate;
}

// ---------------------------------------------------------------------------
// Recent N1 2-bed flat sales (comparables)
// ---------------------------------------------------------------------------
function renderComps(r) {
  const host = $("#comps-body");
  if (!host) return;
  const p = r.inputs.property;
  const yours = {
    addr: p.postcode + " — your flat", date: p.purchaseDate.slice(0, 7), price: p.purchasePrice,
    beds: p.bedrooms, baths: p.bathrooms, type: "Apartment — new build (" + p.buildYear + ")", sqm: p.floorAreaSqm, you: true,
  };
  const rows = DATA.COMPS.rows.map((x) => ({ ...x, perSqm: Math.round(x.price / x.sqm) }));
  rows.push({ ...yours, perSqm: Math.round(yours.price / yours.sqm) });
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first

  const psmList = DATA.COMPS.rows.map((x) => x.price / x.sqm).sort((a, b) => a - b);
  const n = psmList.length;
  const median = Math.round(n % 2 ? psmList[(n - 1) / 2] : (psmList[n / 2 - 1] + psmList[n / 2]) / 2);
  const yourPsm = Math.round(yours.price / yours.sqm);
  const diffPct = (yourPsm / median - 1) * 100;

  host.innerHTML = `
    <div class="cards">
      ${card("Sales shown", String(DATA.COMPS.rows.length), "recent N1 2-bed flats")}
      ${card("Median £/m²", gbp(median), "across these sales")}
      ${card("Your £/m² (paid)", gbp(yourPsm), signed(diffPct, (x) => x.toFixed(0) + "%") + " vs median")}
      ${card("Your flat", gbp(p.purchasePrice), p.floorAreaSqm + " m² · " + p.bedrooms + "-bed/" + p.bathrooms + "-bath")}
    </div>
    <div class="table-wrap"><table class="rank-table comps-table">
      <thead><tr><th>Sold</th><th>Address / area</th><th>Price</th><th>Beds</th><th>Baths</th><th>Building type</th><th>Size (m²)</th><th>£/m²</th></tr></thead>
      <tbody>${rows.map((x) => `<tr class="${x.you ? "best-row" : ""}">
        <td>${monthName(x.date)}</td><td>${x.you ? "★ " : ""}${x.addr}</td><td>${gbp(x.price)}</td>
        <td>${x.beds}</td><td>${x.baths}</td><td>${x.type}</td><td>${x.sqm}</td>
        <td><strong>${gbp(x.perSqm)}</strong></td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted small">${DATA.COMPS.note} Sources:
      <a href="https://www.gov.uk/search-house-prices" target="_blank" rel="noopener">HM Land Registry sold prices</a> ·
      <a href="https://www.zoopla.co.uk/house-prices/n1-7tx/" target="_blank" rel="noopener">Zoopla N1 7TX</a>.</p>
    <p class="disclaimer"><strong>Representative data.</strong> Compiled from Land Registry sold prices with floor area and
      bathrooms from EPC/listing data; bathroom counts and some areas reflect each property's typical spec where not in open
      data. Verify individual transactions against the sources before relying on them.</p>`;
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
    interestOnly: L.interestOnly,
    letMortgageRatePctAfterFix: DATA.LETTING.letMortgageRatePctAfterFix,
  };
  const tax = { ...DATA.TAX, marginalBand: L.taxBand };
  const mortgage = { ...r.inputs.mortgage, _purchaseDate: r.inputs.property.purchaseDate };
  const sellNowNet = r.windows.find((w) => w.window.id === "now").net;
  return rentVsSell({
    property: r.inputs.property, mortgage, sellingCfg: r.inputs.sellingCfg,
    presentValue: r.presentValue, presentISO: DATA.META.asOf,
    growthByYear: r.growthByYear, saleDate: L.horizon,
    letCfg, TAX: tax, sellNowNet,
  });
}

function letPeriodLabel(startISO, months) {
  const endISO = ymToISO(ymIndex(startISO) + months - 1);
  return monthName(startISO) + " – " + monthName(endISO) + (months < 12 ? ` · ${months} mo` : "");
}

function renderLetting(r) {
  const res = computeLetting(r);
  const host = $("#letting-summary");
  const wins = res.advantageLet >= 0;
  const horizonLabel = (LET_HORIZONS.find((h) => h.date === state.letting.horizon) || {}).label || res.saleDate;
  const bandLabel = { basic: "basic-rate (20%)", higher: "higher-rate (40→42%)", additional: "additional-rate (45→47%)" }[res.band];
  // cash you put in that ISN'T equity (i.e. excluding principal repayments)
  const trueCashCost = res.cumulativeNetRent + (res.interestOnly ? 0 : res.cumulativePrincipal);
  const cashIn = cashInvested(r).total;
  const saleProfit = res.sale.netSaleProceeds - cashIn;

  host.innerHTML = `
    <div class="verdict-kicker">Sell now vs. let it &amp; sell in ${horizonLabel}</div>
    <p class="letting-lead">
      Over <strong>${res.years.toFixed(1)} years</strong>, letting then selling in ${horizonLabel} leaves you
      <strong class="${wins ? "delta up" : "delta down"}">${gbp(Math.abs(res.advantageLet))} ${wins ? "better" : "worse"} off</strong>
      than selling now and investing the proceeds at ${pct(state.letting.opportunityRate)} — assuming a ${bandLabel} taxpayer
      on ${res.interestOnly ? "an interest-only" : "a capital-repayment"} mortgage.
    </p>
    <div class="cards">
      ${card("Net sale in " + horizonLabel, gbp(res.sale.netSaleProceeds), signed(saleProfit, gbp) + " net profit" + (res.sale.cgt > 0 ? " · " + gbp(res.sale.cgt) + " CGT" : ""))}
      ${card("Rental cash flow", gbp(res.cumulativeNetRent), res.interestOnly ? "out of pocket, period total" : "incl. " + gbp(res.cumulativePrincipal) + " principal you keep")}
      ${card("Let &amp; sell — total", gbp(res.letTotal), "net sale + rental cash flow")}
      ${card("Sell now &amp; invest", gbp(res.sellNowGrown), gbp(res.sellNowNet) + " grown @ " + pct(state.letting.opportunityRate))}
    </div>
    <div class="cgt-box">
      <strong>Why letting can lose despite a bigger sale figure.</strong> Selling in ${horizonLabel} nets
      <strong>${gbp(res.sale.netSaleProceeds)}</strong> versus <strong>${gbp(res.sellNowNet)}</strong> now — but holding
      costs <strong>${gbp(Math.abs(res.cumulativeNetRent))}</strong> of cash over the period${res.interestOnly ? "" : `, of which
      <strong>${gbp(res.cumulativePrincipal)}</strong> is mortgage principal that comes back to you as equity (already counted
      in the sale figure)`}. So the real out-of-pocket cost of holding is about <strong>${gbp(Math.abs(trueCashCost))}</strong>.
      Set against the ${pct(state.letting.opportunityRate)} you could earn on the sell-now cash, letting ends up
      ${wins ? "ahead" : "behind"} by ${gbp(Math.abs(res.advantageLet))}.
    </div>
    <div class="chart-wrap"><div id="letting-chart"></div>
      <p class="chart-cap">Projected total wealth at ${horizonLabel} under each path.</p></div>`;

  C.barChart($("#letting-chart"), {
    bars: [
      { label: "Let & sell later", value: res.letTotal, color: wins ? "#3a6b54" : "#4a7c8c", valueLabel: gbp(res.letTotal) },
      { label: "Sell now & invest", value: res.sellNowGrown, color: wins ? "#4a7c8c" : "#3a6b54", valueLabel: gbp(res.sellNowGrown) },
    ],
    yFormat: (v) => "£" + Math.round(v / 1000) + "k", height: 280, yUnit: "£ total wealth",
  });

  // year-by-year table + CGT/relief breakdown
  const tHost = $("#letting-table");
  const s = res.sale;
  tHost.innerHTML = `
    <div class="table-wrap"><table class="rank-table">
      <thead><tr><th>Period</th><th>Gross rent*</th><th>Running costs</th><th>Interest</th><th>Principal†</th><th>Income tax</th><th>Net cash flow</th></tr></thead>
      <tbody>${res.yearsTable.map((y) => `<tr>
        <td>${letPeriodLabel(y.label, y.months)}</td><td>${gbp(y.grossRent)}</td><td>${gbp(y.opex)}</td>
        <td>${gbp(y.interest)}</td><td>${gbp(y.principal)}</td><td>${gbp(y.tax)}</td>
        <td class="${y.netCashFlow >= 0 ? "" : "neg-cell"}"><strong>${gbp(y.netCashFlow)}</strong></td></tr>`).join("")}
      </tbody>
    </table>
    <p class="muted small">*Effective of a ${DATA.LETTING.voidMonthsPerYear}-month/yr void allowance; the final period may be
      shorter than 12 months (shown). Running costs = letting agent
      ${state.letting.selfManage ? "(self-managed: £0)" : DATA.LETTING.agentFeePct + "%+VAT"} + ${DATA.LETTING.maintenancePctOfRent}% maintenance +
      insurance + service charge/ground rent. Mortgage interest isn't a deductible expense (it gets the 20% Section 24 credit).
      <strong>†Principal</strong> repayments leave your cash flow but build equity — they return to you in the sale figure, so
      they're not a true cost.</p></div>
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
      <label class="ctrl ctrl-check"><input id="let-io" type="checkbox" ${state.letting.interestOnly ? "checked" : ""}>
        <span>Interest-only mortgage (typical buy-to-let)</span></label>
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
  $("#let-io").addEventListener("change", (e) => { state.letting.interestOnly = e.target.checked; rerenderLetting(); });
}

function rerenderLetting() {
  renderLetting(runModel(effectiveData(), currentOverrides()));
}

// ---------------------------------------------------------------------------
// Inputs tab — your real figures, saved to the browser
// ---------------------------------------------------------------------------
function buildInputs() {
  const i = state.inputs;
  const host = $("#inputs-body");
  const fld = (id, label, type, value, attrs = "") =>
    `<label class="ctrl"><span>${label}</span><input id="${id}" type="${type}" value="${value}" ${attrs}></label>`;
  const deposit = num(i.purchasePrice) - num(i.mortgageAmount);

  host.innerHTML = `
    <div class="input-group"><h3 class="panel-h">Property &amp; purchase costs</h3>
      <div class="controls-grid">
        ${fld("in-price", "Purchase price (£)", "number", i.purchasePrice, 'min="0" step="1000"')}
        ${fld("in-pdate", "Purchase date", "month", i.purchaseDate)}
        ${fld("in-postcode", "Postcode", "text", i.postcode)}
        <label class="ctrl ctrl-check"><input id="in-primary" type="checkbox" ${i.isPrimaryResidence ? "checked" : ""}>
          <span>Main residence (CGT-exempt)</span></label>
        ${fld("in-sdlt", "Stamp Duty (SDLT) paid (£)", "number", i.sdlt, 'min="0" step="100"')}
        ${fld("in-buycosts", "Other buying costs — legal, survey (£)", "number", i.otherBuyCosts, 'min="0" step="50"')}
      </div>
      <p class="muted small">SDLT defaults to the England standard residential estimate for your purchase price.
        <button id="in-sdlt-est" type="button" class="link-btn">Re-estimate from price</button> — or just type your actual figure.</p>
    </div>
    <div class="input-group"><h3 class="panel-h">Property details &amp; sold-price comparable</h3>
      <div class="controls-grid">
        ${fld("in-area", "Internal floor area (m²)", "number", i.floorAreaSqm, 'min="10" step="0.01"')}
        ${fld("in-permsqm", "Comparable sold price (£/m²)", "number", i.perSqmMedian, 'min="1000" step="50"')}
        ${fld("in-beds", "Bedrooms", "number", i.bedrooms, 'min="0" step="1"')}
        ${fld("in-baths", "Bathrooms", "number", i.bathrooms, 'min="0" step="1"')}
        ${fld("in-built", "Year built", "number", i.buildYear, 'min="1800" max="2030" step="1"')}
      </div>
      <p class="muted small">Current value is anchored to <strong>actual sold prices</strong>: your purchase trended by the
        Islington sold-price index, blended with floor area × £/m² from N1 Land Registry sales
        (range ${gbp(DATA.COMPARABLES.perSqm.low)}–${gbp(DATA.COMPARABLES.perSqm.high)}/m²). Forecasts are used only to
        project forward.</p>
    </div>
    <div class="input-group"><h3 class="panel-h">Mortgage</h3>
      <div class="controls-grid">
        ${fld("in-mort", "Amount borrowed (£)", "number", i.mortgageAmount, 'min="0" step="1000"')}
        ${fld("in-rate", "Interest rate (%)", "number", i.ratePct, 'min="0" max="15" step="0.01"')}
        ${fld("in-fix", "Fixed rate ends", "month", i.fixEndDate)}
        ${fld("in-term", "Term (years)", "number", i.termYears, 'min="1" max="40" step="1"')}
        <label class="ctrl"><span>Repayment type</span><select id="in-rep">
          <option value="capital_and_interest" ${i.repaymentType === "capital_and_interest" ? "selected" : ""}>Capital &amp; interest</option>
          <option value="interest_only" ${i.repaymentType === "interest_only" ? "selected" : ""}>Interest-only</option>
        </select></label>
        ${fld("in-erc", "Current-fix ERC (% of balance)", "number", i.ercPct, 'min="0" max="10" step="0.1"')}
        ${fld("in-remo-fix", "Remortgage: new fixed term (years)", "number", i.remortgageFixYears, 'min="0" max="10" step="1"')}
        ${fld("in-remo-erc", "Remortgage ERC while in new fix (% of balance)", "number", i.remortgageErcPct, 'min="0" max="10" step="0.1"')}
      </div>
      <p class="muted small">Deposit / cash you put in: <strong id="in-deposit">${gbp(deposit)}</strong> (purchase − amount borrowed).
        Selling inside the new fix you take in ${monthName(i.fixEndDate)} also triggers <em>its</em> ERC — set the remortgage
        term or ERC to 0 if you'll go onto a tracker / no-ERC deal.</p>
    </div>
    <div class="input-group"><h3 class="panel-h">Selling costs</h3>
      <div class="controls-grid">
        ${fld("in-agent", "Estate agent fee (% excl VAT)", "number", i.agentPct, 'min="0" max="5" step="0.05"')}
        ${fld("in-vat", "VAT on agent fee (%)", "number", i.vatPct, 'min="0" max="25" step="1"')}
        ${fld("in-legal", "Legal / conveyancing (£)", "number", i.legalFixed, 'min="0" step="50"')}
        ${fld("in-epc", "EPC &amp; misc (£)", "number", i.epcMisc, 'min="0" step="50"')}
      </div></div>
    <div class="input-actions">
      <button id="in-reset" class="btn-reset" type="button">Reset to defaults</button>
      <span class="muted small">✓ Saved automatically in this browser (this device only). Rent &amp; service charge are on the <strong>Sell vs let</strong> tab.</span>
    </div>`;

  const bind = (sel, key, ev, parse) => $(sel).addEventListener(ev, (e) => {
    state.inputs[key] = parse(e.target);
    saveInputs();
    const d = num(state.inputs.purchasePrice) - num(state.inputs.mortgageAmount);
    const dep = $("#in-deposit"); if (dep) dep.textContent = gbp(d);
    scheduleRerender();
  });
  const valNum = (t) => num(t.value);
  const valStr = (t) => t.value;
  bind("#in-price", "purchasePrice", "input", valNum);
  bind("#in-pdate", "purchaseDate", "change", valStr);
  bind("#in-postcode", "postcode", "change", valStr);
  bind("#in-primary", "isPrimaryResidence", "change", (t) => t.checked);
  bind("#in-sdlt", "sdlt", "input", valNum);
  bind("#in-buycosts", "otherBuyCosts", "input", valNum);
  bind("#in-area", "floorAreaSqm", "input", valNum);
  bind("#in-permsqm", "perSqmMedian", "input", valNum);
  bind("#in-beds", "bedrooms", "input", valNum);
  bind("#in-baths", "bathrooms", "input", valNum);
  bind("#in-built", "buildYear", "input", valNum);
  $("#in-sdlt-est").addEventListener("click", () => {
    state.inputs.sdlt = computeSDLT(num(state.inputs.purchasePrice));
    $("#in-sdlt").value = state.inputs.sdlt; saveInputs(); scheduleRerender();
  });
  bind("#in-mort", "mortgageAmount", "input", valNum);
  bind("#in-rate", "ratePct", "input", valNum);
  bind("#in-fix", "fixEndDate", "change", valStr);
  bind("#in-term", "termYears", "input", valNum);
  bind("#in-rep", "repaymentType", "change", valStr);
  bind("#in-erc", "ercPct", "input", valNum);
  bind("#in-remo-fix", "remortgageFixYears", "input", valNum);
  bind("#in-remo-erc", "remortgageErcPct", "input", valNum);
  bind("#in-agent", "agentPct", "input", valNum);
  bind("#in-vat", "vatPct", "input", valNum);
  bind("#in-legal", "legalFixed", "input", valNum);
  bind("#in-epc", "epcMisc", "input", valNum);
  $("#in-reset").addEventListener("click", () => {
    state.inputs = defaultInputs(); saveInputs(); buildInputs(); scheduleRerender();
  });
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
  const derived = runModel(effectiveData(), {}).presentValue;
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
