// =============================================================================
// app.js  —  Entry point: load data, run model, render the single page, wire UI
// =============================================================================

import * as DATA from "../data/dataset.js";
import { runModel, signalLabel, FACTOR_LABELS } from "./model.js";
import * as C from "./charts.js";
import { monthlyPayment, monthsBetween, ymIndex, ymToISO, breakEvenRecoupAll, interestPaidToDate, economicsForWindow } from "./finance.js";
import { rentVsSell } from "./letting.js";
import { rentVsBuy } from "./ownrent.js";
import * as MKT from "./market.js";

const $ = (sel, root = document) => root.querySelector(sel);
const gbp = (n) => (n < 0 ? "−" : "") + "£" + Math.abs(Math.round(n)).toLocaleString("en-GB");
const signed = (n, f = (x) => x.toFixed(0)) => (n >= 0 ? "+" : "") + f(n);
const pct = (n) => n.toFixed(2) + "%";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (iso) => MONTHS[parseInt(iso.slice(5, 7), 10) - 1] + " " + iso.slice(0, 4);

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
  rentbuy: {
    horizon: "2029-06-01",
    monthlyRent: MKT.RENT.currentAvg2bed,
    rentGrowthPct: MKT.RENT.yoYPct,
    serviceCharge: DATA.LETTING.serviceChargeGroundRentPerYear,
    maintenancePctOfValue: 1.0,
    opportunityRate: DATA.LETTING.opportunityRatePct,
  },
};

const RB_HORIZONS = [
  { label: "1 year", date: "2027-06-01" },
  { label: "3 years", date: "2029-06-01" },
  { label: "5 years", date: "2031-06-01" },
  { label: "10 years", date: "2036-06-01" },
];

const LET_HORIZONS = [
  { label: "Spring 2027", date: "2027-04-01" },
  { label: "H2 2027", date: "2027-10-01" },
  { label: "Spring 2028", date: "2028-04-01" },
  { label: "Spring 2029", date: "2029-04-01" },
  { label: "Spring 2030", date: "2030-04-01" },
];

// One-click sensitivity presets — each moves the three levers that dominate the
// outcome together (house-price growth, remortgage rate, rent) so you can stress-test
// the whole picture at once instead of nudging sliders one at a time.
const SENSITIVITY = {
  bear: { label: "Bear", scenario: "pessimistic", remortgageRate: 6.25, rentFactor: 0.92,
          note: "Weaker prices, dearer remortgage (~6.25%), softer rent (−8%)." },
  base: { label: "Base", scenario: "base", remortgageRate: DATA.MORTGAGE.remortgageRatePctAssumed, rentFactor: 1.0,
          note: "Savills / Knight Frank consensus and the June-2026 rate market." },
  bull: { label: "Bull", scenario: "optimistic", remortgageRate: 4.30, rentFactor: 1.08,
          note: "Stronger prices, cheaper remortgage (~4.30%), firmer rent (+8%)." },
};

function currentOverrides() {
  return {
    scenario: state.custom ? "custom" : state.scenario,
    growthByYear: state.growthByYear,
    remortgageRate: state.remortgageRate,
    presentValue: state.presentValue,
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
  b.textContent = msg + " — please screenshot this.";
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
  localmarket: ["Local market", "Sales, listings, HPI & forecasts within 2 km"],
  finances: ["Our finances", "What we paid, and whether to sell, rent or hold"],
  map: ["Map", "Sold & on-market homes within 2 km"],
  inputs: ["Inputs", "Your figures, forecast assumptions & methodology"],
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
  // charts size themselves to their container's width; a chart in a previously
  // hidden tab measured 0 at boot, so re-render now that this tab is visible.
  scheduleRerender();
}

function wireNav() {
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.addEventListener("click", () => switchTab(b.dataset.tab)));
  // re-fit charts to the new width when the window resizes (debounced)
  let rz;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(scheduleRerender, 200); });
}

function boot() {
  try {
    renderHeader();
    rerender();
    buildControls();
    buildLettingControls();
    buildRentBuyControls();
    buildInputs();
    wireNav();
    wireCompsToggle();
    wireRateToggle();
    initNotifications();
    loadIdentity();
  } catch (err) {
    showFatal(err && err.message ? err.message : String(err));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Notifications — detect changes since the last visit (client-side diff against
// localStorage): new recent sales, a change in the BoE base rate, or a ≥10bps
// move in the 2-year swap. Data changes when the dataset is refreshed & redeployed.
// ---------------------------------------------------------------------------
const NOTIF_SNAP_KEY = "flatForecaster.notifySnapshot.v1";
const NOTIF_LOG_KEY = "flatForecaster.notifications.v1";
const SWAP_BPS_THRESHOLD = 0.10; // 10 basis points, expressed in % points

function notifySignature() {
  const r = DATA.RATES;
  return {
    baseRate: r.baseRateNow, baseRateAsOf: r.baseRateAsOf,
    swap: r.swap2yrNow, swapAsOf: r.swap2yrAsOf,
    comps: (MKT.SALES.rows || []).map((x) => ({ key: x.addr + "|" + x.soldDate + "|" + x.price, addr: x.addr, price: x.price, date: x.soldDate })),
  };
}
function loadNotifLog() { try { return JSON.parse(localStorage.getItem(NOTIF_LOG_KEY)) || []; } catch (_) { return []; } }
function saveNotifLog(log) { try { localStorage.setItem(NOTIF_LOG_KEY, JSON.stringify(log)); } catch (_) {} }

function detectNotifications() {
  const cur = notifySignature();
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(NOTIF_SNAP_KEY)); } catch (_) {}
  let log = loadNotifLog();
  const have = new Set(log.map((n) => n.id));
  const fresh = [];
  const add = (id, type, text) => { if (!have.has(id)) { fresh.push({ id, type, text, read: false }); have.add(id); } };

  if (prev) { // first-ever load just seeds the snapshot silently (no spam)
    if (cur.baseRate != null && prev.baseRate != null && cur.baseRate !== prev.baseRate) {
      add("base:" + cur.baseRateAsOf + ":" + cur.baseRate, "rate",
        "BoE base rate " + (cur.baseRate > prev.baseRate ? "rose" : "fell") + " " + pct(prev.baseRate) + " → " + pct(cur.baseRate) + " (as of " + cur.baseRateAsOf + ").");
    }
    if (cur.swap != null && prev.swap != null && Math.abs(cur.swap - prev.swap) >= SWAP_BPS_THRESHOLD - 1e-9) {
      const bps = Math.round((cur.swap - prev.swap) * 100);
      add("swap:" + cur.swapAsOf + ":" + cur.swap, "swap",
        "2-year GBP swap moved " + (bps >= 0 ? "+" : "") + bps + "bps: " + pct(prev.swap) + " → " + pct(cur.swap) + ".");
    }
    const prevKeys = new Set((prev.comps || []).map((c) => c.key));
    cur.comps.filter((c) => !prevKeys.has(c.key)).forEach((c) =>
      add("sale:" + c.key, "sale", "New N1 sale: " + c.addr + " — " + gbp(c.price) + " (" + monthName(c.date) + ")."));
  }

  try { localStorage.setItem(NOTIF_SNAP_KEY, JSON.stringify(cur)); } catch (_) {}

  if (fresh.length) {
    const stamp = new Date().toISOString();
    fresh.forEach((n) => (n.ts = stamp));
    log = fresh.concat(log).slice(0, 50);
    saveNotifLog(log);
    nativeNotify(fresh);
  }
  return log;
}

function fmtNotifDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}

function nativeNotify(fresh) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(fresh.length === 1 ? "Bracklyn Street" : "Bracklyn Street — " + fresh.length + " updates",
      { body: fresh.slice(0, 3).map((n) => n.text).join("\n") });
  } catch (_) {}
}

function renderNotifications() {
  const log = loadNotifLog();
  const unread = log.filter((n) => !n.read).length;
  const badge = $("#notif-badge");
  if (badge) { badge.textContent = unread; badge.hidden = unread === 0; }
  const bell = $("#notif-bell"); if (bell) bell.classList.toggle("has-unread", unread > 0);
  const list = $("#notif-list");
  if (list) {
    list.innerHTML = log.length
      ? log.map((n) => `<div class="notif-item ${n.read ? "" : "unread"}"><span class="notif-dot notif-${n.type}"></span>
          <div><div class="notif-text">${n.text}</div><div class="notif-time">${fmtNotifDate(n.ts)}</div></div></div>`).join("")
      : `<div class="notif-empty">You're all caught up. You'll be alerted here whenever a new N1 sale is added, the BoE base rate changes, or the 2-year swap moves by 10bps or more.</div>`;
  }
  const foot = $("#notif-foot");
  if (foot) {
    foot.innerHTML = ("Notification" in window && Notification.permission === "granted")
      ? "Desktop alerts on."
      : `Alerts appear here on each visit. <button type="button" class="link-btn" id="notif-enable">Enable desktop alerts</button>`;
    const en = $("#notif-enable");
    if (en) en.addEventListener("click", () => { try { Notification.requestPermission().then(renderNotifications); } catch (_) {} });
  }
}

function initNotifications() {
  detectNotifications();
  renderNotifications();
  const bell = $("#notif-bell"), panel = $("#notif-panel");
  if (!bell || !panel) return;
  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = panel.hidden;
    panel.hidden = !opening;
    if (opening) {
      const log = loadNotifLog();
      if (log.some((n) => !n.read)) { saveNotifLog(log.map((n) => ({ ...n, read: true }))); }
      renderNotifications();
    }
  });
  document.addEventListener("click", (e) => { if (!panel.hidden && !panel.contains(e.target) && !bell.contains(e.target)) panel.hidden = true; });
  const clear = $("#notif-clear");
  if (clear) clear.addEventListener("click", () => { saveNotifLog([]); renderNotifications(); });
}

// ---------------------------------------------------------------------------
// Cloudflare Access identity (sign-in status + sign-out)
// ---------------------------------------------------------------------------
async function loadIdentity() {
  const status = $("#id-status");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch("/cdn-cgi/access/get-identity", { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error("no access");
    if (!(res.headers.get("content-type") || "").includes("json")) throw new Error("not json");
    const id = await res.json();
    const who = id.email || id.name || "your account";
    if (status) status.innerHTML = "Signed in as <strong>" + who + "</strong>";
  } catch (_) {
    // Local/dev or no Access session: neutral state, keep sign-out available.
    if (status) status.innerHTML = "<strong>Local preview</strong> — not behind Access";
  } finally {
    clearTimeout(timer);
  }
}

// Data-freshness line: when this view loaded, and the newest dated item the
// notifications watch (most recent sale, base-rate date or 2yr-swap date).
function renderFreshness() {
  const r = $("#id-refresh");
  if (r) {
    try {
      r.textContent = "Last refresh " + new Date().toLocaleString("en-GB",
        { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
    } catch (_) { r.textContent = "Last refresh —"; }
  }
  const l = $("#id-latest");
  if (l) {
    const dates = [
      ...(MKT.SALES.rows || []).map((x) => x.soldDate),
      DATA.RATES.baseRateAsOf, DATA.RATES.swap2yrAsOf, DATA.RATES.remortgage70AsOf,
      ..._liveDates,
    ].filter(Boolean);
    const maxISO = dates.sort().slice(-1)[0];
    l.textContent = "Latest item " + (maxISO ? fmtDayMon(maxISO) : "—");
  }
}

// Coalesce rapid slider 'input' events into one render per animation frame, so a
// continuous drag can never queue dozens of full recomputes and lock the main thread.
const debounceRAF = (fn) => {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(); });
  };
};
const scheduleRerender = debounceRAF(() => rerender());
const scheduleLetting = debounceRAF(() => rerenderLetting());

function rerender() {
  const result = runModel(effectiveData(), currentOverrides());
  window.__model = result; // handy for inspection
  renderPaid(result);
  renderBreakEven(result);
  renderProceeds(result);
  renderLocalMarket(result);
  renderLetting(result);
  renderRentBuy(result);
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
// Small day-over-day (calendar) change on each rate badge. "Yesterday's" value is
// carried in the dataset (RATES.*Prev), maintained by the daily 08:00 routine and,
// for the base-rate and remortgage badges, overridden by the Worker where it can
// supply the prior day's figure (the Worker doesn't fetch a swap-rate series, so
// the swap badge's Prev always comes from the dataset) — so the change is genuine
// calendar day-over-day, independent of when you last visited.
function setRateBadge(id, text, title, deltaPct) {
  const el = $("#" + id);
  if (!el) return;
  el.title = title;
  let delta = "";
  if (deltaPct != null && Number.isFinite(deltaPct)) {
    const flat = Math.abs(deltaPct) < 0.005;
    const cls = flat ? "flat" : (deltaPct > 0 ? "up" : "down");
    const arrow = flat ? "" : (deltaPct > 0 ? "▲ " : "▼ ");
    delta = ` <span class="badge-delta ${cls}" title="change vs yesterday">${arrow}${Math.abs(deltaPct).toFixed(2)}%</span>`;
  }
  el.innerHTML = `<span class="badge-label">${text}</span>${delta}`;
}

function dayDelta(now, prev) {
  return (Number.isFinite(now) && Number.isFinite(prev) && prev !== 0) ? ((now - prev) / prev) * 100 : null;
}

// Render all four rate badges (base, remortgage, swap + the Islington-flats-YoY
// chip): source-linked label + day-over-day % change.
function renderRateBadges() {
  const R = DATA.RATES;
  setRateBadge("live-rate", pct(R.baseRateNow) + " base",
    "Bank of England base rate · " + R.baseRateAsOf + " — click for source", dayDelta(R.baseRateNow, R.baseRatePrev));
  setRateBadge("live-remo", pct(R.remortgage70Now) + " fix",
    "Average 2-year fixed remortgage at ~70% LTV · " + R.remortgage70AsOf + " — click for source", dayDelta(R.remortgage70Now, R.remortgage70Prev));
  if (R.swap2yrNow != null) setRateBadge("live-swap", pct(R.swap2yrNow) + " swap",
    "2-year GBP interest-rate swap (SONIA) · " + R.swap2yrAsOf + " — click for source", dayDelta(R.swap2yrNow, R.swap2yrPrev));
  // 4th chip: Islington flats year-on-year (UK HPI) — the headline "market up/down"
  // number. The YoY IS the value (not a hidden delta) so it stays visible on phones.
  const H = MKT.HPI;
  const hpiEl = $("#live-hpi");
  if (hpiEl && Number.isFinite(H.islingtonFlatsYoYPct)) {
    const y = H.islingtonFlatsYoYPct;
    const flat = Math.abs(y) < 0.05;
    const color = flat ? "var(--muted)" : (y > 0 ? "var(--pos)" : "var(--neg)");
    const arrow = flat ? "" : (y > 0 ? "▲ " : "▼ ");
    hpiEl.title = "Islington flats — year-on-year price change (UK HPI · " + monthName(H.asOf) + ") — click for source";
    hpiEl.innerHTML =
      `<span class="badge-label"><span style="color:${color};font-weight:700">${arrow}${Math.abs(y).toFixed(1)}%</span> <span style="color:var(--muted)">flats</span></span>`;
  }
}

// ISO dates from any successful live fetch, folded into the "Latest item" line.
let _liveDates = [];

function renderHeader() {
  renderRateBadges();
  const build = $("#build");
  if (build) build.textContent = "build " + (DATA.META.build || "—");
  renderFreshness();
  // Render the curated snapshot first (above), then try a non-blocking live refresh.
  // If the Worker route isn't deployed it 404s and we silently keep the snapshot —
  // the page never waits on this, so it can't hang behind Zero Trust.
  refreshLiveRates();
}

// Live upgrade of the rate values from the /api/rates Worker route (Bank of
// England data). Purely additive: any missing value leaves its snapshot in place.
async function refreshLiveRates() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4500);
    const res = await fetch("/api/rates", { headers: { accept: "application/json" }, signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const d = await res.json();
    if (!d) return;
    const seen = [];
    if (d.live && Number.isFinite(d.baseRateNow)) { DATA.RATES.baseRateNow = d.baseRateNow; if (d.baseRateAsOf) DATA.RATES.baseRateAsOf = d.baseRateAsOf; if (Number.isFinite(d.baseRatePrev)) DATA.RATES.baseRatePrev = d.baseRatePrev; seen.push(boeToISO(d.baseRateAsOf)); }
    if (d.remortgageLive && Number.isFinite(d.remortgage70Now)) { DATA.RATES.remortgage70Now = d.remortgage70Now; if (d.remortgage70AsOf) DATA.RATES.remortgage70AsOf = d.remortgage70AsOf; if (Number.isFinite(d.remortgage70Prev)) DATA.RATES.remortgage70Prev = d.remortgage70Prev; seen.push(boeToISO(d.remortgage70AsOf)); }
    if (d.swapLive && Number.isFinite(d.swap2yrNow)) { DATA.RATES.swap2yrNow = d.swap2yrNow; if (d.swap2yrAsOf) DATA.RATES.swap2yrAsOf = d.swap2yrAsOf; if (Number.isFinite(d.swap2yrPrev)) DATA.RATES.swap2yrPrev = d.swap2yrPrev; seen.push(boeToISO(d.swap2yrAsOf)); }
    _liveDates = seen.filter(Boolean);
    renderRateBadges();
    renderFreshness();
  } catch (_) { /* offline, blocked, or not deployed — keep the snapshot silently */ }
}

// "17 Jun 2026" / "01 Jun 2026" -> "2026-06-17"; "" if unparseable.
function boeToISO(s) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec((s || "").trim());
  if (!m) return "";
  const mi = MONTHS.indexOf(m[2]);
  if (mi < 0) return "";
  return m[3] + "-" + String(mi + 1).padStart(2, "0") + "-" + m[1].padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Your position
// ---------------------------------------------------------------------------
function renderPaid(r) {
  const p = r.inputs.property, m = r.inputs.mortgage;
  const io = m.repaymentType === "interest_only";
  const payNow = io ? m.principal * (m.ratePct / 100 / 12) : monthlyPayment(m.principal, m.ratePct, m.termYears);
  const equityNow = r.presentValue - balanceNow(r);
  const v = r.valuation;
  const host = $("#paid-body");
  if (!host) return;

  const deposit = Math.max(0, p.purchasePrice - m.principal);
  const sdlt = p.sdltPaid || 0;
  const buyCosts = p.otherBuyCosts || 0;
  const cashInAtPurchase = deposit + sdlt + buyCosts;
  const interestPaid = interestPaidToDate(m, DATA.META.asOf);
  const paymentsToDate = monthsBetween(p.purchaseDate, DATA.META.asOf) * payNow;
  const principalRepaid = Math.max(0, m.principal - balanceNow(r));
  const totalPaidSoFar = cashInAtPurchase + paymentsToDate; // all cash out of pocket to date

  const months = monthsBetween(p.purchaseDate, DATA.META.asOf);
  const cnote = (t) => t ? ` <span class="cnote">${t}</span>` : "";
  const row = (label, val, note, cls) => `<tr${cls ? ` class="${cls}"` : ""}><td>${label}${cnote(note)}</td><td class="num">${val}</td></tr>`;

  const valLead = v.compVal ? `
    <div class="val-lead">
      <div class="val-head">Estimated current value${cnote("anchored to actual sold prices")}</div>
      <div class="val-main">${gbp(r.presentValue)} <span class="val-sub">≈ ${gbp(v.impliedPerSqm)}/m² · ${p.floorAreaSqm} m² · ${p.bedrooms}-bed/${p.bathrooms}-bath, built ${p.buildYear}</span></div>
      <table class="calc mini">
        ${row("A · purchase trended by Islington sold-price index", gbp(v.indexVal))}
        ${row("B · £/m² comparable from N1 Land Registry sales", gbp(v.compVal), gbp(v.perSqm.median) + "/m² · range " + gbp(v.compLow) + "–" + gbp(v.compHigh))}
        ${row("For reference — you paid", gbp(p.purchasePrice), gbp(v.purchasePerSqm) + "/m² · " + monthName(p.purchaseDate))}
      </table>
    </div>` : "";

  host.innerHTML = valLead + `
    <h3 class="panel-h">What we've paid so far</h3>
    <table class="calc">
      ${row("Purchase price", gbp(p.purchasePrice), monthName(p.purchaseDate) + " · " + p.postcode)}
      ${row("Deposit", gbp(deposit), (100 - m.ltv * 100).toFixed(0) + "% of price")}
      ${row("Stamp Duty (SDLT)", gbp(sdlt), "paid at purchase")}
      ${row("Other buying costs", gbp(buyCosts), "legal, survey, etc.")}
      ${row("Cash in at purchase", gbp(cashInAtPurchase), "deposit + SDLT + costs", "sub")}
      ${row("Mortgage payments to date", gbp(paymentsToDate), months + " mo @ " + gbp(payNow) + "/mo")}
      ${row("of which interest", gbp(interestPaid), "gone, not recoverable", "minor")}
      ${row("of which principal", gbp(principalRepaid), "back to you as equity", "minor")}
      ${row("Total paid so far", gbp(totalPaidSoFar), "all cash out of pocket to date", "total")}
    </table>
    <h3 class="panel-h" style="margin-top:20px">What the mortgage is costing</h3>
    <table class="calc">
      ${row("Mortgage balance now", gbp(balanceNow(r)), "outstanding")}
      ${row("Monthly payment", gbp(payNow), (io ? "interest-only" : "capital & interest") + " @ " + pct(m.ratePct))}
      ${row("Rate / fix ends", pct(m.ratePct), "fixed until " + monthName(m.fixEndDate))}
      ${row("Post-fix payment", gbp(r.holdingCost.after), signed(r.holdingCost.deltaMonthly, (x) => gbp(x)) + "/mo @ ~" + pct(m.remortgageRatePctAssumed))}
      ${row("Est. value now", gbp(r.presentValue), valueDelta(r.presentValue - p.purchasePrice))}
      ${row("Est. equity now", gbp(equityNow), "value − outstanding balance", "sub")}
    </table>
    <p class="muted small">${p.isPrimaryResidence
      ? "CGT: this is your main residence, so a sale qualifies for Private Residence Relief — <strong>normally no Capital Gains Tax</strong> at any sale date."
      : "CGT: marked as <strong>not your main residence</strong> — a sale may be liable to Capital Gains Tax (see Sell vs let for the partial-relief estimate)."}
      Edit any figure on the <strong>Inputs</strong> tab — saved in this browser.</p>`;
}

// Break-even sale price, shown for three cumulative cash-recoup targets.
function renderBreakEven(r) {
  const host = $("#breakeven-body");
  if (!host) return;
  const p = r.inputs.property, m = r.inputs.mortgage;
  const rentCfg = { monthlyRent: MKT.RENT.currentAvg2bed, growthPct: MKT.RENT.yoYPct };
  const be = breakEvenRecoupAll({
    property: p, mortgage: m, sellingCfg: r.inputs.sellingCfg, saleDateISO: DATA.META.asOf, cgtCfg: r.cgtCfg, rentCfg,
  });
  const t = be.tiers, ci = be.inputs, value = r.presentValue;
  const rentSaved = be.rentSaved;
  const monthsOwned = monthsBetween(p.purchaseDate, DATA.META.asOf);

  // One priced scenario row inside a tier card: a label, the break-even price, and
  // how that price compares with today's estimated value.
  const scnRow = (label, scn, accent) => {
    const gap = scn.breakEvenPrice - value;
    const over = gap > 0;
    return `<div class="be-scn${accent ? " be-scn-alt" : ""}">
      <div class="be-scn-top">
        <span class="be-scn-label">${label}</span>
        <span class="be-scn-price">${gbp(scn.breakEvenPrice)}</span>
      </div>
      <div class="be-scn-gap"><span class="pill pill-${over ? "neg" : "pos"}">${
        over ? gbp(gap) + " above" : gbp(-gap) + " below"} value</span></div>
    </div>`;
  };

  // A tier card: two scenarios — pure recoup, and the same target net of rent saved.
  const tierCard = (num, name, recoups, tier) => `<div class="be-tier">
      <div class="be-tier-head">
        <span class="be-tier-num">${num}</span>
        <div>
          <div class="be-tier-name">${name}</div>
          <div class="be-tier-recoups">Get back ${recoups}</div>
        </div>
      </div>
      <div class="be-scn-table">
        ${scnRow("Sale price to recoup that cash", tier.recoup, false)}
        ${scnRow(`Net of ${gbp(rentSaved)} rent saved vs renting`, tier.vsRent, true)}
      </div>
    </div>`;

  const cashCosts = gbp(ci.deposit + ci.sdlt + ci.buyingCosts);
  const cashAll = gbp(ci.deposit + ci.sdlt + ci.buyingCosts + ci.interestPaid);

  host.innerHTML = `
    <p class="letting-lead">Three break-even sale prices, depending on how much of your own cash you want back before a sale
      "washes its face". Each shows <strong>two scenarios</strong>: the sale price to recoup that cash, and — because owning has
      spared you rent — a lower price once the <strong>${gbp(rentSaved)}</strong> rent you'd have paid is credited. Both assume a
      sale <strong>today</strong> (est. value ${gbp(value)}), after clearing the mortgage and every selling cost.</p>
    <div class="be-tiers">
      ${tierCard("i", "Deposit back", `your ${gbp(ci.deposit)} deposit`, t.deposit)}
      ${tierCard("ii", "Deposit + purchase costs back", `deposit + SDLT + buying costs (${cashCosts})`, t.costs)}
      ${tierCard("iii", "All cash back", `the above + mortgage interest paid so far (${cashAll})`, t.all)}
    </div>
    <div class="table-wrap"><table class="rank-table kv">
      <thead><tr><th>Cash each scenario returns</th><th>Amount</th></tr></thead>
      <tbody>
        <tr><td>Deposit <span class="muted small">— target (i)</span></td><td>${gbp(ci.deposit)}</td></tr>
        <tr><td>+ Stamp Duty (SDLT)</td><td>${gbp(ci.sdlt)}</td></tr>
        <tr><td>+ Other buying costs <span class="muted small">— target (ii)</span></td><td>${gbp(ci.buyingCosts)}</td></tr>
        <tr class="best-row"><td>+ Mortgage interest paid to date <span class="muted small">— target (iii)</span></td><td>${gbp(ci.interestPaid)}</td></tr>
        <tr><td>Rent saved <span class="muted small">— credited in the "vs renting" scenario</span></td><td>−${gbp(rentSaved)}</td></tr>
      </tbody>
    </table></div>
    <p class="muted small">Every price also has to cover the <strong>${gbp(ci.outstanding)} outstanding mortgage</strong>${
      ci.erc > 0 ? ", the " + gbp(ci.erc) + " early-repayment charge" : ""}, the estate-agent fee (incl VAT), legal, EPC${
      p.isPrimaryResidence ? "" : " and Capital Gains Tax"} — that is why each break-even sits above the cash it returns. The
      <strong>vs-renting</strong> figure credits the rent you'd have paid living elsewhere: ${gbp(rentSaved)} over ${monthsOwned}
      months, at today's ~${gbp(MKT.RENT.currentAvg2bed)}/mo local 2-bed rent (grown ${MKT.RENT.yoYPct}%/yr) — a real saving that
      lowers the price at which owning beats having rented. All assume a sale <strong>today</strong>; break-evens drift up the
      longer you hold as interest mounts, while rent saved keeps growing — see the recoup-all line on the proceeds chart below.</p>`;
}

// Total cash you sank in at purchase: deposit + SDLT + other buying costs.
function cashInvested(r) {
  const deposit = r.inputs.property.purchasePrice - r.inputs.mortgage.principal;
  const sdltPlusBuyCosts = (r.inputs.property.sdltPaid || 0) + (r.inputs.property.otherBuyCosts || 0);
  return { deposit, buyCosts: sdltPlusBuyCosts, total: deposit + sdltPlusBuyCosts };
}

function balanceNow(r) {
  // outstanding today = the "now" window economics minus its (small) projection
  const nowWin = r.windows.find((w) => w.window.id === "now");
  return nowWin ? nowWin.outstanding : r.inputs.mortgage.principal;
}

// Recoup-all-cash break-even line for the proceeds chart (bars = net proceeds).
// The threshold is the total cash sunk in by each window's date — deposit + SDLT +
// buying costs + interest paid to date — i.e. the net proceeds needed to get every
// pound back. A bar above the line means you've recouped all your cash. Rises over
// time as more interest is paid.
function breakEvenValues(r) {
  const p = r.inputs.property, m = r.inputs.mortgage;
  const fixedCash = Math.max(0, p.purchasePrice - m.principal) + (p.sdltPaid || 0) + (p.otherBuyCosts || 0);
  return r.windows.map((w) => fixedCash + interestPaidToDate(m, w.window.date));
}

function valueDelta(d) {
  const cls = d >= 0 ? "up" : "down";
  return `<span class="delta ${cls}">${signed(d, gbp)}</span> vs purchase`;
}

function card(label, big, sub, tone) {
  return `<div class="card ${tone || ""}"><div class="card-label">${label}</div>
    <div class="card-value">${big}</div><div class="card-sub">${sub}</div></div>`;
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
    color: w === r.best ? "#2f7d57" : "#a9c6b6",
    valueLabel: gbp(w.net),
    sub: (w.net - cashIn >= 0 ? "+" + gbp(w.net - cashIn) + " profit" : gbp(w.net - cashIn) + " short"),
  }));
  host.innerHTML = `
    <div class="chart-wrap"><div id="proceeds-chart"></div>
      <p class="chart-cap">Bars = <strong>net proceeds (cash in hand)</strong>. The grey dashed line is the
      <strong>${gbp(cashIn)} you put in</strong> (${gbp(deposit)} deposit + ${gbp(buyCosts)} SDLT/buying costs); the bar
      above it is your <strong>net profit</strong> (shown under each bar). The
      <strong style="color:#a06a3c">bronze line</strong> is the <strong>recoup-all-cash break-even</strong> — the net
      proceeds needed to get every pound back (deposit + SDLT + buying costs + interest paid to that date); a bar above it
      means you've recouped all your cash. Scenario: <strong>${state.custom ? "Custom" : r.scenarioName}</strong>.</p></div>
    <div class="table-wrap"><table class="rank-table kv">
      <thead><tr><th>Window</th><th>Sale value</th><th>Outstanding</th><th>ERC</th><th>Selling costs</th><th>CGT</th><th>Net proceeds</th><th>Less deposit + SDLT</th><th>Net profit</th></tr></thead>
      <tbody>${r.windows.map((w) => `<tr class="${w === r.best ? "best-row" : ""}">
        <td>${w.window.label}</td><td>${gbp(w.saleValue)}</td><td>${gbp(w.outstanding)}</td>
        <td>${w.erc > 0 ? gbp(w.erc) : "—"}</td><td>${gbp(w.costs.total)}</td><td>${w.cgt > 0 ? gbp(w.cgt) : "—"}</td>
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
    overlay: { values: breakEvenValues(r) },
  });
}

// ---------------------------------------------------------------------------
// SECTION 1 — Local market (within 2 km of N1 7TX)
// ---------------------------------------------------------------------------
function fmtDayMon(iso) {
  if (!iso) return "—";
  const d = iso.length >= 10 ? parseInt(iso.slice(8, 10), 10) : null;
  return (d ? d + " " : "") + monthName(iso);
}

// Merged sold / on-market comps table with a Sold⇄Listed toggle. Phone-first:
// short building name in a frozen first column (full address in-row), date-sorted.
let _compsView = "sold";
let _comps = { sold: [], listed: [] };
const _compsSort = { sold: { key: "soldDate", dir: "desc" }, listed: { key: "listedDate", dir: "desc" } };
const _nbSort = { key: "units", dir: "desc" };
const _fcSort = { key: "priceYoY", dir: "desc" };
const shortAddr = (a) => {
  const seg = a.split(",").map((s) => s.trim());
  const s = seg[0]
    // drop floor/position descriptors that aren't a building name ("Top Floor
    // Flat, 30 Duncan Terrace" → fall through to the street)
    .replace(/^(?:Top|Ground|First|Second|Third|Lower(?: Ground)?|Upper|Raised(?: Ground)?|Garden|Basement)\s+(?:Floor\s+)?Flat\b\s*/i, "")
    .replace(/^Flat\s+\S+\s*/i, "")
    .replace(/^Unit\s+\S+\s*/i, "")
    .replace(/^\d+[A-Za-z]?\s+/, "").trim();
  return s || seg[1] || seg[0];
};
// Single distinctive word for the tightest first column: the first real name word,
// skipping house numbers and generic street/building/directional words (so
// "26 Gainsborough Studios West" → "Gainsborough", "The Cooper Building" → "Cooper").
const ADDR_GENERIC = new Set(["the", "flat", "apartment", "apartments", "court", "house", "building", "buildings",
  "studios", "studio", "road", "street", "avenue", "close", "tower", "towers", "square", "walk", "terrace",
  "gardens", "garden", "place", "lane", "row", "mews", "point", "north", "south", "east", "west", "london",
  "hackney", "islington"]);
const oneWord = (a) => {
  const words = shortAddr(a).split(/\s+/).filter(Boolean);
  let res = null;
  for (const w of words) {
    if (/^\d/.test(w)) continue;
    const lw = w.toLowerCase().replace(/[^a-z]/g, "");
    if (!lw || ADDR_GENERIC.has(lw)) continue;
    res = w.replace(/[.,]$/, ""); break;
  }
  if (!res) res = words.find((w) => !/^\d+$/.test(w)) || words[0] || a;
  if (res === "New" && /new north road/i.test(a)) return "NNR"; // no building name → abbreviate the street
  return res;
};

// Generic click-to-sort table. cols: [{key,label,get,num,cell,tdcls}]. `state`
// {key,dir} is mutated on header click; opts.rerender re-invokes the caller.
function sortableTable(host, cols, rows, state, opts) {
  if (!host) return;
  const col = cols.find((c) => c.key === state.key) || cols[0];
  const dir = state.dir === "asc" ? 1 : -1;
  const sorted = rows.slice().sort((a, b) => {
    let va = col.get(a), vb = col.get(b);
    if (col.num) return ((va == null ? -Infinity : va) - (vb == null ? -Infinity : vb)) * dir;
    return String(va == null ? "" : va).localeCompare(String(vb == null ? "" : vb)) * dir;
  });
  const ar = (c) => c.key === state.key ? `<span class="sort-ar">${state.dir === "asc" ? "▲" : "▼"}</span>` : "";
  host.innerHTML = `<div class="table-wrap"><table class="rank-table comps-table ${(opts && opts.cls) || ""}">
    <thead><tr>${cols.map((c) => `<th class="sort-th${c.key === state.key ? " sorted" : ""}" data-k="${c.key}">${c.label}${ar(c)}</th>`).join("")}</tr></thead>
    <tbody>${sorted.map((x) => `<tr>${cols.map((c) => `<td class="${c.tdcls ? c.tdcls(x) : ""}">${c.cell(x)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
  host.querySelectorAll(".sort-th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k, c = cols.find((cc) => cc.key === k);
    if (state.key === k) state.dir = state.dir === "asc" ? "desc" : "asc";
    else { state.key = k; state.dir = c.num ? "desc" : "asc"; }
    opts.rerender();
  }));
}

function renderComps() {
  const host = $("#lm-comps-body");
  if (!host) return;
  const badge = (n) => `<span class="rank-badge">${n}</span>`;
  const addrCol = { key: "addr", label: "Property", get: (x) => oneWord(x.addr), tdcls: () => "addr-cell", cell: (x) => badge(x._rank) + oneWord(x.addr) };
  const common = [
    { key: "perSqm", label: "£/m²", num: true, get: (x) => x.perSqm, cell: (x) => gbp(x.perSqm) },
    { key: "sqm", label: "m²", num: true, get: (x) => x.sqm, cell: (x) => x.sqm },
    { key: "type", label: "Type", get: (x) => x.type, cell: (x) => x.type },
    { key: "full", label: "Full address", get: (x) => x.addr, tdcls: () => "muted", cell: (x) => `${x.addr} · ${x.distKm}&nbsp;km` },
  ];
  if (_compsView === "sold") {
    const cols = [addrCol,
      { key: "soldDate", label: "Sold", get: (x) => x.soldDate, tdcls: () => "date-cell", cell: (x) => monthName(x.soldDate) },
      { key: "price", label: "Price", num: true, get: (x) => x.price, cell: (x) => `<strong><a href="https://www.gov.uk/search-house-prices" target="_blank" rel="noopener">${gbp(x.price)}</a></strong>` },
      { key: "vsAskingPct", label: "vs&nbsp;ask", num: true, get: (x) => x.vsAskingPct, tdcls: (x) => x.vsAsking < 0 ? "neg-cell" : "", cell: (x) => x.vsAskingPct != null ? signed(x.vsAskingPct, (v) => v.toFixed(1)) + "%" : "—" },
      { key: "daysOnMarket", label: "Days", num: true, get: (x) => x.daysOnMarket, cell: (x) => x.daysOnMarket != null ? x.daysOnMarket : "—" },
      ...common];
    if (_comps.sold.length) sortableTable(host, cols, _comps.sold, _compsSort.sold, { cls: "sticky-first", rerender: renderComps });
    else host.innerHTML = `<p class="muted">No sales in the radius.</p>`;
  } else {
    const cols = [addrCol,
      { key: "listedDate", label: "Listed", get: (x) => x.listedDate, tdcls: () => "date-cell", cell: (x) => fmtDayMon(x.listedDate) },
      { key: "askingPrice", label: "Asking", num: true, get: (x) => x.askingPrice, cell: (x) => `<strong>${gbp(x.askingPrice)}</strong>` },
      { key: "status", label: "Status", get: (x) => x.status, cell: (x) => x.status },
      { key: "daysListed", label: "Days", num: true, get: (x) => x.daysListed, cell: (x) => x.daysListed != null ? x.daysListed : "—" },
      ...common];
    if (_comps.listed.length) sortableTable(host, cols, _comps.listed, _compsSort.listed, { cls: "sticky-first", rerender: renderComps });
    else host.innerHTML = `<p class="muted">No active listings in the radius.</p>`;
  }
}
function wireCompsToggle() {
  document.querySelectorAll("#lm-comps-toggle .toggle-btn").forEach((b) =>
    b.addEventListener("click", () => {
      _compsView = b.dataset.comps;
      document.querySelectorAll("#lm-comps-toggle .toggle-btn").forEach((x) => x.classList.toggle("active", x === b));
      renderComps();
    }));
}

// Rate-sensitivity chart with an optional swap-implied forecast overlay.
let _rateForecast = false;
let _rateOpts = null;
function renderRateChart() {
  const host = $("#lm-rate-sens");
  if (!host || !_rateOpts) return;
  C.dualAxisLine(host, {
    xLabels: _rateOpts.xLabels, xValues: _rateOpts.xValues, height: _rateOpts.height,
    left: _rateOpts.left, right: _rateOpts.right, marker: _rateOpts.marker,
    forecast: _rateForecast ? _rateOpts.fc : null,
  });
}
function wireRateToggle() {
  document.querySelectorAll("#lm-rate-toggle .toggle-btn").forEach((b) =>
    b.addEventListener("click", () => {
      _rateForecast = b.dataset.rate === "forecast";
      document.querySelectorAll("#lm-rate-toggle .toggle-btn").forEach((x) => x.classList.toggle("active", x === b));
      renderRateChart();
    }));
}

// ---- comp-quality filters (recompute the valuation from a chosen comp set) ----
let _compFilters = { newBuild: false, similar: false, noOutliers: false };
let _lastLmResult = null;

// Apply the active comp filters to a derived-sales array (each row has type, sqm,
// perSqm). `you` is your floor area for the "similar size" band.
function applyCompFilters(rows, youSqm) {
  let out = rows.slice();
  if (_compFilters.newBuild) out = out.filter((x) => /new build/i.test(x.type || ""));
  if (_compFilters.similar && youSqm) out = out.filter((x) => x.sqm && Math.abs(x.sqm - youSqm) / youSqm <= 0.25);
  if (_compFilters.noOutliers) {
    const psm = out.map((x) => x.perSqm).filter(Number.isFinite).sort((a, b) => a - b);
    if (psm.length >= 4) {
      const q = (f) => psm[Math.floor((psm.length - 1) * f)];
      const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
      out = out.filter((x) => !Number.isFinite(x.perSqm) || (x.perSqm >= q1 - 1.5 * iqr && x.perSqm <= q3 + 1.5 * iqr));
    }
  }
  return out;
}

// Trend arrow + colour. `goodIsUp` flips the colour meaning (e.g. rising DOM is bad).
function trendMeta(dir, goodIsUp) {
  if (Math.abs(dir) < 1e-9) return { arrow: "→", cls: "flat", color: "var(--muted)" };
  const up = dir > 0;
  const good = goodIsUp ? up : !up;
  return { arrow: up ? "↑" : "↓", cls: good ? "up" : "down", color: good ? "var(--pos)" : "var(--neg)" };
}

// Sell-timing verdict at the top of Local market — a compact read of the composite
// model (the same engine the Finances tab uses for the full sell-vs-hold).
function renderTimingVerdict(r) {
  const host = $("#lm-verdict");
  if (!host) return;
  if (!r.best) { host.innerHTML = ""; return; }
  const best = r.best, sig = signalLabel(best.composite), next = r.ranked[1];
  const drivers = Object.entries(best.contributions)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2)
    .map(([k, v]) => `${FACTOR_LABELS[k] || k} ${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}`);
  host.innerHTML = `
    <div class="verdict-kicker">Best time to sell — model read</div>
    <div class="lm-verdict-head">
      <div class="lm-verdict-window">${best.window.label}</div>
      <span class="pill pill-${sig.tone}">${sig.label} · ${signed(best.composite)}</span>
    </div>
    <p class="lm-verdict-lead">Projected sale value <strong>${gbp(best.saleValue)}</strong> → net proceeds
      <strong>${gbp(best.net)}</strong>. Top drivers: ${drivers.join(" · ")}.
      Next best: <strong>${next.window.label}</strong> (${signed(next.composite)}).</p>
    <div class="src-line muted">Model, not advice — blends price trajectory, financing/ERC, seasonality &amp; policy across candidate sell windows. Full sell-vs-hold in <strong>Finances</strong>.</div>`;
}

// Wire the comp-quality filter chips once (delegated — the container persists even
// though its chips are re-rendered each pass).
function wireCompFilters() {
  const cf = $("#lm-comp-filters");
  if (!cf || cf._wired) return;
  cf._wired = true;
  cf.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cf]");
    if (!b) return;
    _compFilters[b.dataset.cf] = !_compFilters[b.dataset.cf];
    if (_lastLmResult) renderLocalMarket(_lastLmResult);
  });
}

function renderLocalMarket(r) {
  _lastLmResult = r;
  const p = r.inputs.property;
  const allStats = MKT.salesStats();
  // filtered sold set drives the valuation + comps table
  const filteredSold = applyCompFilters(allStats.rows, p.floorAreaSqm);
  const stats = {
    ...allStats,
    rows: filteredSold,
    count: filteredSold.length,
    medianPerSqm: MKT.median(filteredSold.map((x) => x.perSqm)),
    medianDaysOnMarket: MKT.median(filteredSold.map((x) => x.daysOnMarket)),
    medianVsAskingPct: MKT.median(filteredSold.map((x) => x.vsAskingPct)),
    pctBelowAsking: (() => {
      const wa = filteredSold.filter((x) => Number.isFinite(x.vsAsking));
      return wa.length ? Math.round(wa.filter((x) => x.vsAsking < 0).length / wa.length * 100) : null;
    })(),
  };
  const sales = stats.rows;
  const listings = MKT.deriveListings(MKT.RADIUS_KM, DATA.META.asOf);
  const lpm = MKT.LISTINGS_PER_MONTH.series;
  const avgLpm = lpm.length ? Math.round(lpm.reduce((s, x) => s + x.count, 0) / lpm.length) : 0;
  const yourPsm = p.floorAreaSqm ? Math.round(p.purchasePrice / p.floorAreaSqm) : null;
  const soldDates = sales.map((s) => s.soldDate).filter(Boolean).sort();
  const salesPeriod = soldDates.length ? monthName(soldDates[0]) + " – " + monthName(soldDates[soldDates.length - 1]) : "";

  // ---- sell-timing verdict (reuses the composite model — see Finances) ----
  renderTimingVerdict(r);

  // ---- desktop valuation with a confidence read (comp count + £/m² spread) ----
  const medianPsm = stats.medianPerSqm;
  const compVal = medianPsm && p.floorAreaSqm ? Math.round(medianPsm * p.floorAreaSqm) : null;
  const estDays = stats.medianDaysOnMarket != null ? Math.round(stats.medianDaysOnMarket) : null;
  const psmArr = sales.map((x) => x.perSqm).filter(Number.isFinite);
  const psmMed = MKT.median(psmArr) || 1;
  const spreadPct = psmArr.length >= 2 ? (Math.max(...psmArr) - Math.min(...psmArr)) / psmMed : 1;
  const conf = (stats.count >= 8 && spreadPct < 0.6) ? { label: "High", cls: "pos" }
    : (stats.count >= 4 && spreadPct < 0.95) ? { label: "Medium", cls: "neu" }
    : { label: "Low", cls: "neg" };
  const valHost = $("#lm-valuation");
  if (valHost) valHost.innerHTML = compVal ? `
    <div class="val-lead">
      <div class="val-head">Desktop valuation — your flat <span class="conf-pill conf-${conf.cls}" title="Valuation confidence — from comp count &amp; £/m² spread">${conf.label}</span></div>
      <div class="val-cols">
        <div class="val-col">
          <div class="val-main">${gbp(compVal)}</div>
          <div class="val-sub">${gbp(medianPsm)}/m² × ${p.floorAreaSqm} m² · ${stats.count} comps</div>
        </div>
        <div class="val-col">
          <div class="val-main2">≈ ${estDays} days</div>
          <div class="val-sub">est. time to sell (list→sold)</div>
        </div>
      </div>
      <div class="val-note">Local median £/m² &amp; days-on-market${salesPeriod ? " · sales " + salesPeriod : ""}. Confidence from comp count &amp; £/m² spread.</div>
    </div>`
    : `<div class="val-lead"><div class="val-head">Desktop valuation — your flat</div><div class="val-note">No sold comps match the current filters — clear one below.</div></div>`;

  // ---- comp-quality filter chips (recompute the valuation from a chosen set) ----
  const cf = $("#lm-comp-filters");
  if (cf) {
    const chip = (key, label) => `<button type="button" class="filter-chip${_compFilters[key] ? " on" : ""}" data-cf="${key}">${label}</button>`;
    cf.innerHTML = chip("newBuild", "New-build only") + chip("similar", "Similar size ±25%") + chip("noOutliers", "Drop £/m² outliers")
      + `<span class="filter-note">${stats.count} of ${allStats.count} comps</span>`;
  }
  wireCompFilters();

  // simple stat row (used by the clustered KPIs and the HPI block)
  const statrow = (l, v, s) => `<div class="statrow"><span class="sr-label">${l}</span><span class="sr-value">${v}</span><span class="sr-sub">${s || ""}</span></div>`;

  // ---- clustered KPIs: Price / Speed / Supply, with trend arrows + sparklines ----
  const trends = MKT.salesTrends();
  const mos = MKT.monthsOfSupply(MKT.RADIUS_KM, DATA.META.asOf);
  const H0 = MKT.HPI;
  const spk = [];
  const kpiRow = (label, value, sub, trend) => {
    let trendHtml = "";
    if (trend && trend.series && trend.series.length >= 2) {
      const tm = trendMeta(trend.dir, trend.goodIsUp);
      const sid = "spk-" + trend.id;
      spk.push({ id: sid, values: trend.series, color: tm.color });
      trendHtml = `<span class="kpi-trend"><span class="spark" id="${sid}"></span><span class="tr-arrow" style="color:${tm.color}">${tm.arrow}</span></span>`;
    }
    return `<div class="statrow kpi-stat"><span class="sr-label">${label}</span><span class="sr-value">${value}</span><span class="sr-sub"><span>${sub || ""}</span>${trendHtml}</span></div>`;
  };
  const group = (title, rows) => `<div class="kpi-group"><div class="kpi-group-h">${title}</div><div class="statrows">${rows}</div></div>`;
  const kpis = $("#lm-kpis");
  if (kpis) kpis.innerHTML =
    group("Price",
      kpiRow("Median £/m²", medianPsm ? gbp(medianPsm) : "—", yourPsm ? "you paid " + gbp(yourPsm) : "", { id: "psm", dir: trends.dir.psm, goodIsUp: true, series: trends.psm.map((x) => x.v) }) +
      kpiRow("Islington flats", H0 ? gbp(H0.islingtonFlatsAvg) : "—", H0 ? signed(H0.islingtonFlatsYoYPct, (x) => x.toFixed(1) + "%") + " YoY" : "")) +
    group("Speed",
      kpiRow("Median days on market", estDays != null ? estDays + " days" : "—", "list → sold", { id: "dom", dir: trends.dir.dom, goodIsUp: false, series: trends.dom.map((x) => x.v) }) +
      kpiRow("Sold below asking", stats.pctBelowAsking != null ? stats.pctBelowAsking + "%" : "—", stats.medianVsAskingPct != null ? "median " + signed(stats.medianVsAskingPct, (x) => x.toFixed(1)) + "%" : "", { id: "vsask", dir: trends.dir.vsAsk, goodIsUp: true, series: trends.vsAsk.map((x) => x.v) })) +
    group("Supply",
      kpiRow("On the market now", String(listings.length), "within 2 km") +
      kpiRow("New listings / mo", String(avgLpm), "avg last " + lpm.length + " mo") +
      kpiRow("Months of supply", mos.months != null ? "~" + Math.round(mos.months) + " mo" : "—", mos.months != null ? (mos.months > 6 ? "slow · buyer's market" : mos.months < 4 ? "tight · seller's" : "balanced") + " · indicative" : "indicative"));
  spk.forEach((s) => { const e = $("#" + s.id); if (e) C.sparkline(e, s.values, { color: s.color }); });

  const note = $("#lm-source-note");
  if (note) note.innerHTML = `Live: <a href="https://www.gov.uk/search-house-prices" target="_blank" rel="noopener">HM Land Registry</a> prices · <a href="https://homedata.co.uk/" target="_blank" rel="noopener">Homedata</a> listings &amp; rents · <a href="https://landregistry.data.gov.uk/app/ukhpi" target="_blank" rel="noopener">UK&nbsp;HPI</a>. <span class="asof">Comps &amp; listings as of ${MKT.SALES.asOf} · HPI ${monthName(MKT.HPI.asOf)}.</span>`;

  // ---- projected net-proceeds curve (scenario band) + best window ----
  const procHost = $("#lm-proceeds-chart");
  if (procHost && r.best) {
    const P = r.inputs.property, M = r.inputs.mortgage, cfg = r.inputs.sellingCfg;
    const startIdx = ymIndex(DATA.META.asOf), OUT = 30;
    const netAt = (gby, iso) => economicsForWindow({ property: P, mortgage: M, sellingCfg: cfg, presentValue: r.presentValue, presentISO: DATA.META.asOf, growthByYear: gby, windowDate: iso, cgtCfg: r.cgtCfg }).net;
    const labels = [], base = [], lo = [], hi = [];
    for (let k = 0; k <= OUT; k += 1) {
      const iso = ymToISO(startIdx + k);
      labels.push(monthName(iso).replace(/ 20/, " '"));
      base.push(Math.round(netAt(DATA.FORECAST.scenarios.base, iso)));
      lo.push(Math.round(netAt(DATA.FORECAST.scenarios.pessimistic, iso)));
      hi.push(Math.round(netAt(DATA.FORECAST.scenarios.optimistic, iso)));
    }
    const cashIn = cashInvested(r).total;
    const bestIdx = Math.max(0, Math.min(OUT, ymIndex(r.best.window.date) - startIdx));
    C.lineChart(procHost, {
      series: [{ name: "Net proceeds (base)", color: "#2f7d57", points: labels.map((l, i) => ({ x: l, y: base[i] })), dots: false }],
      band: { lower: lo, upper: hi, color: "#2f7d57" },
      markers: [{ x: labels[bestIdx], label: "best window" }],
      yRef: cashIn, yRefLabel: "you put in " + gbp(cashIn),
      yFormat: (v) => "£" + Math.round(v / 1000) + "k", height: 250, yUnit: "£ net proceeds",
    });
    const pcap = $("#lm-proceeds-cap");
    if (pcap) {
      const diff = base[bestIdx] - base[0];
      pcap.innerHTML = `Cash in hand after clearing the mortgage, ERC &amp; selling costs, month by month; shaded band = bear→bull growth. `
        + `Model's best window is <strong>${r.best.window.label}</strong> (~${gbp(base[bestIdx])}${bestIdx > 0 ? ", " + (diff >= 0 ? "+" : "") + gbp(diff) + " vs selling now" : ""}).`;
    }
  }

  // ---- seasonality: best months to list (Rightmove demand index) ----
  const seasHost = $("#lm-seasonality");
  const S = DATA.SEASONALITY;
  if (seasHost && S) {
    const maxIdx = Math.max(...S.monthIndex);
    C.barChart(seasHost, {
      bars: S.monthIndex.map((v, i) => ({ label: MONTHS[i], value: Math.round(v * 100),
        color: v >= maxIdx - 0.03 ? "#2f7d57" : (v >= 1.0 ? "#4a7c8c" : "#c3ccd3") })),
      yFormat: (v) => String(v), height: 180, yUnit: "demand index", labelEvery: 1, xTicks: true, baseline: 80, hideValues: true,
    });
    const best3 = S.monthIndex.map((v, i) => ({ m: MONTHS[i], v })).sort((a, b) => b.v - a.v).slice(0, 3).map((x) => x.m);
    const scap = $("#lm-seasonality-cap");
    if (scap) scap.innerHTML = `Strongest listing months: <strong>${best3.join(", ")}</strong> — spring peaks as buyers return; December is weakest. Demand strength, not a price guarantee · <a href="https://www.rightmove.co.uk/guides/seller/preparing-to-sell/is-now-the-right-time-to-sell/" target="_blank" rel="noopener">Rightmove</a>.`;
  }

  // ---- new listings per month ----
  const lpmHost = $("#lm-listings-chart");
  if (lpmHost) C.barChart(lpmHost, {
    bars: lpm.map((x) => ({ label: monthName(x.month).replace(/ 20/, " '"), value: x.count, valueLabel: String(x.count), color: "#4a7c8c" })),
    yFormat: (v) => v.toFixed(0), height: 220, yUnit: "new listings",
    xTicks: true, labelEvery: 3, // a notch every month, date label once a quarter
  });
  const lcap = $("#lm-listings-cap");
  if (lcap) {
    const first3 = lpm.slice(0, 3).reduce((s, x) => s + x.count, 0) / 3;
    const last3 = lpm.slice(-3).reduce((s, x) => s + x.count, 0) / 3;
    const dir = last3 > first3 * 1.1 ? "rising" : last3 < first3 * 0.9 ? "easing" : "steady";
    lcap.innerHTML = `New 2-bed supply is <strong>${dir}</strong> (${Math.round(first3)}→${Math.round(last3)}/mo over the window). More new listings = more competition when you sell.`;
  }

  // ---- price rank (1 = dearest) + date-sorted rows for the merged table ----
  const sold = sales.slice();
  sold.slice().sort((a, b) => b.price - a.price).forEach((x, i) => { x._rank = i + 1; });
  sold.sort((a, b) => (a.soldDate < b.soldDate ? 1 : a.soldDate > b.soldDate ? -1 : 0));
  const listed = listings.slice();
  listed.slice().sort((a, b) => b.askingPrice - a.askingPrice).forEach((x, i) => { x._rank = i + 1; });
  listed.sort((a, b) => ((a.listedDate || "") < (b.listedDate || "") ? 1 : (a.listedDate || "") > (b.listedDate || "") ? -1 : 0));
  _comps = { sold, listed };
  renderComps();

  // ---- map (own tab): sold blue, listings amber, your flat green; pins by price rank ----
  const tipHtml = (a, b, c2) => `<strong>${a}</strong><span>${b}</span><span>${c2}</span>`;
  const tipPlain = (a, b, c2) => `${a} — ${b} · ${c2}`;
  const salePins = sold.map((x) => ({ lat: x.lat, lng: x.lng, n: x._rank,
    tip: tipHtml(x.addr, gbp(x.price) + " · " + gbp(x.perSqm) + "/m²", "sold " + monthName(x.soldDate)),
    plain: tipPlain(x.addr, gbp(x.price), "sold " + monthName(x.soldDate)) }));
  const listPins = listed.map((x) => ({ lat: x.lat, lng: x.lng, n: x._rank, listing: true,
    tip: tipHtml(x.addr, gbp(x.askingPrice) + " · " + gbp(x.perSqm) + "/m²", x.status),
    plain: tipPlain(x.addr, gbp(x.askingPrice) + " asking", x.status) }));
  const mapPoints = salePins.concat(listPins).concat(
    Number.isFinite(p.lat) && Number.isFinite(p.lng) ? [{ lat: p.lat, lng: p.lng, you: true,
      tip: tipHtml("Your flat — " + p.postcode, gbp(p.purchasePrice), "bought " + monthName(p.purchaseDate)),
      plain: tipPlain("Your flat — " + p.postcode, gbp(p.purchasePrice), "bought " + monthName(p.purchaseDate)) }] : []);
  const mapHost = $("#lm-map");
  if (mapHost) C.scatterMap(mapHost, { points: mapPoints });
  const legend = $("#lm-legend");
  if (legend) legend.innerHTML = `<div class="map-legend">
      <div class="map-legend-item"><span class="map-num you"></span><span><strong>Your flat</strong> · ${gbp(p.purchasePrice)}${yourPsm ? " · " + gbp(yourPsm) + "/m²" : ""}</span></div>
      ${sold.slice().sort((a, b) => a._rank - b._rank).map((x) => `<div class="map-legend-item"><span class="map-num">${x._rank}</span><span>${oneWord(x.addr)} · sold ${gbp(x.price)}${x.perSqm ? " · " + gbp(x.perSqm) + "/m²" : ""}</span></div>`).join("")}
      ${listed.slice().sort((a, b) => a._rank - b._rank).map((x) => `<div class="map-legend-item"><span class="map-num listing">${x._rank}</span><span>${oneWord(x.addr)} · ${gbp(x.askingPrice)}${x.perSqm ? " · " + gbp(x.perSqm) + "/m²" : ""}</span></div>`).join("")}
    </div>`;

  // ---- HPI (tight rows + linked) ----
  const H = MKT.HPI;
  const yoy = (v) => signed(v, (x) => x.toFixed(1) + "%") + " YoY";
  const hpiHost = $("#lm-hpi");
  if (hpiHost) hpiHost.innerHTML = `<div class="statrows sr-2">` +
    statrow("Islington", gbp(H.islingtonAvg), yoy(H.islingtonYoYPct)) +
    statrow("Islington flats", gbp(H.islingtonFlatsAvg), yoy(H.islingtonFlatsYoYPct)) +
    statrow("N1 7TX 12-mo", gbp(H.n17txAvg12m), "2 km flats") +
    statrow("London", gbp(H.londonAvg), yoy(H.londonYoYPct)) +
    statrow("England", gbp(H.englandAvg), yoy(H.englandYoYPct)) +
    `</div><a class="src-line" href="https://landregistry.data.gov.uk/app/ukhpi" target="_blank" rel="noopener">UK HPI · ${monthName(H.asOf)}</a>`;

  // ---- rate sensitivity: DATA-BASED (real elasticities from UK HPI + BoE + volumes) ----
  const baseRate = DATA.RATES.remortgage70Now;
  const basePrice = compVal || r.presentValue, baseDays = estDays || 120;
  const rateGrid = [3.5, 4, 4.5, 5, 5.5, 6, 6.5];
  const PRICE_ELAST = -0.022;   // UK HPI Islington flats vs BoE 2-yr fix, 2021 peak → 2026
  const DAYS_ELAST = 0.024;     // London sales-volume fall per +1pp (turnover/liquidity proxy)
  const priceVals = rateGrid.map((rt) => Math.round(basePrice * (1 + PRICE_ELAST * (rt - baseRate))));
  const daysVals = rateGrid.map((rt) => Math.max(20, Math.round(baseDays * (1 + DAYS_ELAST * (rt - baseRate)))));
  let mIdx = 0; rateGrid.forEach((rt, i) => { if (Math.abs(rt - baseRate) < Math.abs(rateGrid[mIdx] - baseRate)) mIdx = i; });
  // Forecast 2-yr-fix path from the BoE OIS instantaneous forward curve (month-end
  // 2026-06): 2-yr swap forward starting in T years + the current fix-vs-swap
  // spread (~1.04pp). The curve prices SONIA broadly flat near ~4%, so the fix
  // holds ~5% and edges up by 2030 — this is the market path, not an assumption.
  // deltas vs now: 2028 ≈ +0.0pp, 2030 ≈ +0.2pp (fwd 2y swap 4.02→4.02→4.24%).
  const OIS = DATA.RATES.oisFix2yForecast || { asOf: "2026-06", d30: 0.2 };
  const r30 = Math.round((baseRate + OIS.d30) * 100) / 100;
  // Two points: now (curve is flat through ~2028) and 2030. The "now" dot is left
  // unlabelled because the vertical "now ~5.0%" marker already names it — labelling
  // it again just crowds the curve crossing. Only the 2030 endpoint gets a label.
  const fcPath = [{ label: "", rate: baseRate }, { label: "'30", rate: r30 }];
  _rateOpts = {
    xLabels: rateGrid.map((rt) => rt.toFixed(1) + "%"), xValues: rateGrid, height: 260,
    left: { name: "Est. price", color: "#1f5a73", values: priceVals, format: (val) => "£" + Math.round(val / 1000) + "k" },
    right: { name: "Time to sell", color: "#a06a3c", values: daysVals, format: (val) => Math.round(val) + "d" },
    marker: { index: mIdx, label: "now ~" + baseRate.toFixed(1) + "%" }, fc: fcPath,
  };
  renderRateChart();
  const rcap = $("#lm-rate-cap");
  if (rcap) rcap.innerHTML = `Data-based: Islington flat prices moved ≈−2.2% per +1&nbsp;pt on the 2-yr fix (<a href="https://landregistry.data.gov.uk/app/ukhpi" target="_blank" rel="noopener">UK&nbsp;HPI</a> vs <a href="https://www.bankofengland.co.uk/boeapps/database" target="_blank" rel="noopener">Bank of England</a>, 2021–26); time-to-sell proxied from London sales volumes. <strong>Rate forecast</strong> (dots): from the <a href="https://www.bankofengland.co.uk/statistics/yield-curves" target="_blank" rel="noopener">BoE OIS forward curve</a> (${OIS.asOf}) — the 2-yr fix holds ~${baseRate.toFixed(1)}% and edges to ~${r30.toFixed(1)}% by 2030, so little rate-driven price relief.`;

  // ---- new-build pipeline (sortable) ----
  const pipe = MKT.pipelineWithinRadius();
  const nbHost = $("#lm-newbuilds");
  if (nbHost) {
    nbHost.innerHTML = `<p class="src-line"><strong>${pipe.totalUnits.toLocaleString("en-GB")} homes</strong> across ${pipe.rows.length} schemes within 2 km · <a href="https://www.planit.org.uk/planapplic/loc/N1%207TX/search" target="_blank" rel="noopener">PlanIt</a></p><div id="lm-nb-table"></div>`;
    const nbCols = [
      { key: "name", label: "Scheme", get: (x) => x.short || x.name, cell: (x) => `<strong>${x.url ? `<a href="${x.url}" target="_blank" rel="noopener">${x.short || x.name}</a>` : (x.short || x.name)}</strong> <span class="muted">· ${x.distKm}&nbsp;km</span>` },
      { key: "units", label: "Homes", num: true, get: (x) => x.units, cell: (x) => x.units },
      { key: "completion", label: "Done", get: (x) => x.completion, cell: (x) => x.completion },
      { key: "status", label: "Status", get: (x) => x.status, cell: (x) => x.status },
      { key: "note", label: "Note", get: (x) => x.note, tdcls: () => "muted", cell: (x) => x.note },
    ];
    const renderNb = () => sortableTable($("#lm-nb-table"), nbCols, pipe.rows, _nbSort, { rerender: renderNb });
    renderNb();
  }

  // ---- forecasts (sortable) ----
  const fHost = $("#lm-forecasts");
  if (fHost) {
    fHost.innerHTML = `<div id="lm-fc-table"></div><p class="src-line asof">Third-party analyst views (editorial, not a local measurement) · as of ${monthName(MKT.FORECASTS.asOf)}.</p>`;
    const fcCols = [
      { key: "source", label: "Source", get: (x) => x.short || x.source, cell: (x) => `<strong>${x.url ? `<a href="${x.url}" target="_blank" rel="noopener">${x.short || x.source}</a>` : (x.short || x.source)}</strong>` },
      { key: "horizon", label: "Horizon", get: (x) => x.horizon, cell: (x) => x.horizon },
      { key: "priceYoY", label: "Price", num: true, get: (x) => x.priceYoY, cell: (x) => x.priceYoY == null ? "—" : signed(x.priceYoY, (v) => v.toFixed(1)) + "%" },
      { key: "activity", label: "Read", get: (x) => x.activity, tdcls: () => "muted", cell: (x) => x.activity },
    ];
    const renderFc = () => sortableTable($("#lm-fc-table"), fcCols, MKT.FORECASTS.rows, _fcSort, { rerender: renderFc });
    renderFc();
  }
}

// ---------------------------------------------------------------------------
// SECTION 2 — Rent-it-out vs sell comparison
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
      { label: "Let & sell later", value: res.letTotal, color: wins ? "#2f7d57" : "#4a7c8c", valueLabel: gbp(res.letTotal) },
      { label: "Sell now & invest", value: res.sellNowGrown, color: wins ? "#4a7c8c" : "#2f7d57", valueLabel: gbp(res.sellNowGrown) },
    ],
    yFormat: (v) => "£" + Math.round(v / 1000) + "k", height: 280, yUnit: "£ total wealth",
  });

  // year-by-year table + CGT/relief breakdown
  const tHost = $("#letting-table");
  const s = res.sale;
  tHost.innerHTML = `
    <div class="table-wrap"><table class="rank-table kv">
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
      <label class="ctrl"><span>Monthly rent (£)</span>
        <input id="let-rent" type="number" min="0" step="25" value="${state.letting.monthlyRent}"></label>
      <label class="ctrl"><span>Service charge + ground rent (£/yr)</span>
        <input id="let-sc" type="number" min="0" step="50" value="${state.letting.serviceCharge}"></label>
      <label class="ctrl"><span>Opportunity return on sale cash (%)</span>
        <input id="let-opp" type="number" min="0" max="20" step="0.25" value="${state.letting.opportunityRate}"></label>
      <label class="ctrl ctrl-check"><input id="let-self" type="checkbox" ${state.letting.selfManage ? "checked" : ""}>
        <span>Self-manage (no letting agent fee)</span></label>
      <label class="ctrl ctrl-check"><input id="let-io" type="checkbox" ${state.letting.interestOnly ? "checked" : ""}>
        <span>Interest-only mortgage (typical buy-to-let)</span></label>
    </div>`;

  $("#let-horizon").addEventListener("change", (e) => { state.letting.horizon = e.target.value; rerenderLetting(); });
  $("#let-band").addEventListener("change", (e) => { state.letting.taxBand = e.target.value; rerenderLetting(); });
  $("#let-rent").addEventListener("input", (e) => { state.letting.monthlyRent = num(e.target.value, state.letting.monthlyRent); scheduleLetting(); });
  $("#let-sc").addEventListener("input", (e) => { state.letting.serviceCharge = num(e.target.value, state.letting.serviceCharge); scheduleLetting(); });
  $("#let-opp").addEventListener("input", (e) => { state.letting.opportunityRate = num(e.target.value, state.letting.opportunityRate); scheduleLetting(); });
  $("#let-self").addEventListener("change", (e) => { state.letting.selfManage = e.target.checked; rerenderLetting(); });
  $("#let-io").addEventListener("change", (e) => { state.letting.interestOnly = e.target.checked; rerenderLetting(); });
}

function rerenderLetting() {
  renderLetting(runModel(effectiveData(), currentOverrides()));
}

// ---------------------------------------------------------------------------
// SECTION 3 — Rent vs buy (own this flat, or rent the equivalent?)
// ---------------------------------------------------------------------------
function computeRentBuy(r) {
  const RB = state.rentbuy;
  const mortgage = { ...r.inputs.mortgage, _purchaseDate: r.inputs.property.purchaseDate };
  return rentVsBuy({
    property: r.inputs.property, mortgage, sellingCfg: r.inputs.sellingCfg,
    presentValue: r.presentValue, presentISO: DATA.META.asOf,
    growthByYear: r.growthByYear, horizonISO: RB.horizon,
    rentCfg: {
      monthlyRent: RB.monthlyRent, rentGrowthPct: RB.rentGrowthPct,
      serviceChargePerYear: RB.serviceCharge, maintenancePctOfValue: RB.maintenancePctOfValue,
    },
    opportunityRatePct: RB.opportunityRate,
  });
}

function renderRentBuy(r) {
  const host = $("#rb-summary");
  if (!host) return;
  const res = computeRentBuy(r);
  const M = res.monthly, T = res.terminal;
  const horizonLabel = (RB_HORIZONS.find((h) => h.date === state.rentbuy.horizon) || {}).label || res.horizonISO;
  const ownCheaperMonthly = M.ownVsRent < 0;
  const ownWins = T.advantageOwn >= 0;

  host.innerHTML = `
    <div class="verdict-kicker">Monthly economic cost — owning vs renting the equivalent 2-bed</div>
    <p class="letting-lead">Right now, owning costs about <strong>${gbp(M.ownEconomic)}/mo</strong> in economic terms versus
      <strong>${gbp(M.rent)}/mo</strong> to rent — owning is
      <strong class="${ownCheaperMonthly ? "delta up" : "delta down"}">${gbp(Math.abs(M.ownVsRent))}/mo ${ownCheaperMonthly ? "cheaper" : "dearer"}</strong>.
      Owning cost excludes mortgage principal (that builds equity) and nets off expected price growth.</p>
    <div class="cards">
      ${card("Mortgage interest", gbp(M.interest) + "/mo", "not principal")}
      ${card("Service charge + upkeep", gbp(M.serviceMaint) + "/mo", "curated estimate")}
      ${card("Opportunity cost of equity", gbp(M.oppCostEquity) + "/mo", "on " + gbp(res.equityNow) + " @ " + pct(state.rentbuy.opportunityRate))}
      ${card("Less expected growth", (M.appreciation >= 0 ? "−" : "+") + gbp(Math.abs(M.appreciation)) + "/mo", "value change this year")}
      ${card("= Owning cost", gbp(M.ownEconomic) + "/mo", "economic monthly", "gold")}
      ${card("Rent for equivalent", gbp(M.rent) + "/mo", "avg 2-bed within 2 km")}
    </div>

    <div class="verdict-kicker" style="margin-top:20px">Wealth after ${horizonLabel} — keep owning vs sell &amp; rent</div>
    <p class="letting-lead">Keeping the flat leaves you
      <strong class="${ownWins ? "delta up" : "delta down"}">${gbp(Math.abs(T.advantageOwn))} ${ownWins ? "better" : "worse"} off</strong>
      than selling now for ${gbp(res.sellNowNet)} net, investing it at ${pct(state.rentbuy.opportunityRate)}, and renting —
      over ${res.years.toFixed(1)} years. Each year the cheaper option invests the surplus at the same return.</p>
    <div class="cards">
      ${card("Own — wealth at horizon", gbp(T.wealthOwn), "net equity + invested savings")}
      ${card("Rent — wealth at horizon", gbp(T.wealthRent), gbp(res.sellNowNet) + " grown @ " + pct(state.rentbuy.opportunityRate))}
      ${card("Owning advantage", signed(T.advantageOwn, gbp), ownWins ? "owning ahead" : "renting ahead", ownWins ? "pos" : "neg")}
    </div>
    <div class="chart-wrap"><div id="rb-wealth-chart"></div>
      <p class="chart-cap">Projected total wealth at ${horizonLabel} under each path.</p></div>`;

  C.barChart($("#rb-wealth-chart"), {
    bars: [
      { label: "Keep owning", value: T.wealthOwn, color: ownWins ? "#2f7d57" : "#4a7c8c", valueLabel: gbp(T.wealthOwn) },
      { label: "Sell & rent", value: T.wealthRent, color: ownWins ? "#4a7c8c" : "#2f7d57", valueLabel: gbp(T.wealthRent) },
    ],
    yFormat: (v) => "£" + Math.round(v / 1000) + "k", height: 280, yUnit: "£ total wealth",
  });

  // rent series chart
  const rc = $("#rb-rent-chart");
  if (rc) C.lineChart(rc, {
    height: 260,
    series: [{ name: "Avg 2-bed rent (2 km)", color: "#1f5a73",
      points: MKT.RENT.series.map((s) => ({ x: monthName(s.month), y: s.rent })) }],
    yFormat: (v) => "£" + Math.round(v).toLocaleString("en-GB"), yUnit: "£/month",
  });
  const cap = $("#rb-rent-cap");
  if (cap) cap.innerHTML = `Average advertised rent for a 2-bed within 2 km: <strong>${gbp(MKT.RENT.currentAvg2bed)}/mo</strong>
    (${signed(MKT.RENT.yoYPct, (x) => x.toFixed(1))}% YoY). Source:
    <a href="https://www.rightmove.co.uk/property-to-rent/Islington.html" target="_blank" rel="noopener">Rightmove</a> ·
    <a href="https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/privaterentandhousepricesuk/latest" target="_blank" rel="noopener">ONS</a>.`;

  // year-by-year table
  const tbl = $("#rb-table");
  if (tbl) tbl.innerHTML = `
    <div class="table-wrap"><table class="rank-table kv">
      <thead><tr><th>Period</th><th>Rent paid</th><th>Own — interest</th><th>Own — principal†</th><th>Service+upkeep</th><th>Own cash out</th><th>Rent − own cash</th></tr></thead>
      <tbody>${res.yearsTable.map((y) => {
        const diff = y.rent - y.ownCash;
        return `<tr><td>${letPeriodLabel(y.label, y.months)}</td><td>${gbp(y.rent)}</td>
          <td>${gbp(y.interest)}</td><td>${gbp(y.principal)}</td><td>${gbp(y.serviceMaint)}</td>
          <td>${gbp(y.ownCash)}</td><td class="${diff >= 0 ? "" : "neg-cell"}"><strong>${signed(diff, gbp)}</strong></td></tr>`;
      }).join("")}</tbody>
    </table>
    <p class="muted small">†Principal repayments leave your cash flow but build equity — a positive "Rent − own cash" means
      owning is cheaper that year, and the surplus is invested at your opportunity rate toward the horizon.</p></div>`;
}

function buildRentBuyControls() {
  const host = $("#rb-controls");
  if (!host) return;
  const RB = state.rentbuy;
  host.innerHTML = `
    <div class="controls-grid">
      <label class="ctrl"><span>Compare over</span>
        <select id="rb-horizon">${RB_HORIZONS.map((h) =>
          `<option value="${h.date}" ${h.date === RB.horizon ? "selected" : ""}>${h.label}</option>`).join("")}</select></label>
      <label class="ctrl"><span>Rent for equivalent (£/mo)</span>
        <input id="rb-rent" type="number" min="0" step="25" value="${RB.monthlyRent}"></label>
      <label class="ctrl"><span>Rent growth (%/yr)</span>
        <input id="rb-rentg" type="number" min="0" max="15" step="0.25" value="${RB.rentGrowthPct}"></label>
      <label class="ctrl"><span>Service charge + ground rent (£/yr)</span>
        <input id="rb-sc" type="number" min="0" step="50" value="${RB.serviceCharge}"></label>
      <label class="ctrl"><span>Maintenance (% of value/yr)</span>
        <input id="rb-maint" type="number" min="0" max="5" step="0.1" value="${RB.maintenancePctOfValue}"></label>
      <label class="ctrl"><span>Opportunity return (%/yr)</span>
        <input id="rb-opp" type="number" min="0" max="20" step="0.25" value="${RB.opportunityRate}"></label>
    </div>`;
  $("#rb-horizon").addEventListener("change", (e) => { RB.horizon = e.target.value; rerenderRentBuy(); });
  $("#rb-rent").addEventListener("input", (e) => { RB.monthlyRent = num(e.target.value, RB.monthlyRent); scheduleRentBuy(); });
  $("#rb-rentg").addEventListener("input", (e) => { RB.rentGrowthPct = num(e.target.value, RB.rentGrowthPct); scheduleRentBuy(); });
  $("#rb-sc").addEventListener("input", (e) => { RB.serviceCharge = num(e.target.value, RB.serviceCharge); scheduleRentBuy(); });
  $("#rb-maint").addEventListener("input", (e) => { RB.maintenancePctOfValue = num(e.target.value, RB.maintenancePctOfValue); scheduleRentBuy(); });
  $("#rb-opp").addEventListener("input", (e) => { RB.opportunityRate = num(e.target.value, RB.opportunityRate); scheduleRentBuy(); });
}

const scheduleRentBuy = debounceRAF(() => rerenderRentBuy());
function rerenderRentBuy() {
  renderRentBuy(runModel(effectiveData(), currentOverrides()));
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
      <span class="muted small">Saved automatically in this browser (this device only). Rent &amp; service charge are on the <strong>Sell vs let</strong> tab.</span>
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
    <div class="preset-row">
      <span class="preset-lead">Sensitivity</span>
      <div class="preset-btns">
        ${Object.keys(SENSITIVITY).map((k) =>
          `<button class="preset-btn" data-preset="${k}">${SENSITIVITY[k].label}</button>`).join("")}
      </div>
      <span class="preset-note" id="preset-note">Bear / Base / Bull move growth, remortgage rate and rent together.</span>
    </div>
    <div class="controls-grid">
      <label class="ctrl">
        <span>Forecast scenario</span>
        <select id="ctrl-scenario">
          <option value="pessimistic">Pessimistic</option>
          <option value="base" selected>Base (consensus)</option>
          <option value="optimistic">Optimistic</option>
        </select>
      </label>
      <label class="ctrl"><span>Remortgage rate after fix (%)</span>
        <input id="ctrl-remo" type="number" min="0" max="15" step="0.05" value="${state.remortgageRate}"></label>
      <label class="ctrl"><span>Est. value now (£)</span>
        <input id="ctrl-pv" type="number" min="0" step="1000"></label>
      ${yrs.map((y) => `
      <label class="ctrl"><span>${y} growth (%)</span>
        <input class="ctrl-growth" data-year="${y}" type="number" min="-20" max="20" step="0.5" value="${state.growthByYear[y]}"></label>`).join("")}
      <button id="ctrl-reset" class="btn-reset" type="button">Reset to consensus</button>
    </div>
    <p class="muted small">These recompute every chart and the recommendation live. Leave "Est. value now" blank to use the
      model's derived figure. Defaults reflect the Savills / Knight Frank / Zoopla consensus and the June 2026 rate market.</p>`;

  // init present-value box to the derived value (blank => derived at runtime)
  const derived = runModel(effectiveData(), {}).presentValue;
  const pvInput = $("#ctrl-pv");
  pvInput.value = state.presentValue != null ? state.presentValue : Math.round(derived / 1000) * 1000;

  document.querySelectorAll(".preset-btn").forEach((b) =>
    b.addEventListener("click", () => applyPreset(b.dataset.preset)));

  $("#ctrl-scenario").addEventListener("change", (e) => {
    state.scenario = e.target.value;
    state.custom = false;
    state.growthByYear = { ...DATA.FORECAST.scenarios[state.scenario] };
    syncGrowthSliders();
    rerender();
  });
  $("#ctrl-remo").addEventListener("input", (e) => {
    state.remortgageRate = num(e.target.value, state.remortgageRate);
    scheduleRerender();
  });
  pvInput.addEventListener("input", (e) => {
    state.presentValue = e.target.value === "" ? null : num(e.target.value);
    scheduleRerender();
  });
  document.querySelectorAll(".ctrl-growth").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const y = e.target.dataset.year;
      state.growthByYear[y] = num(e.target.value, state.growthByYear[y]);
      state.custom = true;
      scheduleRerender();
    });
  });
  $("#ctrl-reset").addEventListener("click", () => {
    state.scenario = DATA.FORECAST.defaultScenario;
    state.custom = false;
    state.growthByYear = { ...DATA.FORECAST.scenarios[state.scenario] };
    state.remortgageRate = DATA.MORTGAGE.remortgageRatePctAssumed;
    state.presentValue = null;
    state.letting.monthlyRent = DATA.LETTING.monthlyRent;
    $("#ctrl-scenario").value = state.scenario;
    $("#ctrl-remo").value = state.remortgageRate;
    pvInput.value = Math.round(derived / 1000) * 1000;
    const lr = $("#let-rent"); if (lr) lr.value = state.letting.monthlyRent;
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
    $("#preset-note").textContent = "Bear / Base / Bull move growth, remortgage rate and rent together.";
    syncGrowthSliders();
    rerender();
  });
}

function syncGrowthSliders() {
  document.querySelectorAll(".ctrl-growth").forEach((inp) => {
    inp.value = state.growthByYear[inp.dataset.year];
  });
}

// Apply a Bear/Base/Bull preset: set growth scenario, remortgage rate and rent
// together, sync every affected control, then recompute the whole page.
function applyPreset(name) {
  const p = SENSITIVITY[name];
  if (!p) return;
  state.scenario = p.scenario;
  state.custom = false;
  state.growthByYear = { ...DATA.FORECAST.scenarios[p.scenario] };
  state.remortgageRate = p.remortgageRate;
  state.letting.monthlyRent = Math.round(DATA.LETTING.monthlyRent * p.rentFactor / 25) * 25;

  // sync scenario controls
  const sc = $("#ctrl-scenario"); if (sc) sc.value = p.scenario;
  const remo = $("#ctrl-remo"); if (remo) remo.value = p.remortgageRate;
  syncGrowthSliders();
  // sync letting rent control
  const lr = $("#let-rent"); if (lr) lr.value = state.letting.monthlyRent;

  const note = $("#preset-note"); if (note) note.textContent = p.note;
  document.querySelectorAll(".preset-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.preset === name));

  rerender();
}

document.addEventListener("DOMContentLoaded", boot);
