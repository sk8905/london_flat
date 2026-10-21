// =============================================================================
// app.js  —  Entry point: load data, run model, render the single page, wire UI
// =============================================================================

import * as DATA from "../data/dataset.js";
import { runModel, signalLabel, FACTOR_LABELS } from "./model.js";
import * as C from "./charts.js";
import { monthlyPayment, balanceAfter, monthsBetween, ymIndex, ymToISO, breakEvenRecoupAll, interestPaidToDate, economicsForWindow } from "./finance.js";
import { rentVsSell } from "./letting.js";
import { rentVsBuy } from "./ownrent.js";
import * as MKT from "./market.js";

const $ = (sel, root = document) => root.querySelector(sel);
const gbp = (n) => (n < 0 ? "−" : "") + "£" + Math.abs(Math.round(n)).toLocaleString("en-GB");
const signed = (n, f = (x) => x.toFixed(0)) => (n >= 0 ? "+" : "") + f(n);
const pct = (n) => n.toFixed(2) + "%";
const kFmt = (v) => "£" + Math.round(v / 1000) + "k";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (iso) => MONTHS[parseInt(iso.slice(5, 7), 10) - 1] + " " + iso.slice(0, 4);

const num = (v, fb = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; };

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
  rentFactor: 1, // Bear/Bull presets scale the calculator's default rents
  calc: null,    // { type, params } — set at boot (CALCS is defined further down)
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
  const msg = e.message ? e.message : "";
  const ours = e.filename && e.filename.indexOf("/assets/js/") !== -1;
  if (!msg || /script error/i.test(msg) || !ours) return;
  showFatal(msg + (e.lineno ? " @ " + e.filename.split("/").pop() + ":" + e.lineno : ""));
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  if (r && r.message) showFatal("promise: " + r.message); // skip opaque rejections
});

const PAGE_META = {
  market: ["Market", "Sold & for-sale flats within 2 km — £/m² and price achieved vs asking"],
  forecast: ["Forecast", "Best window, projected proceeds, rate outlook & analyst views"],
  finances: ["Finances", "Calculator — pick a calculation, change any input"],
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
    state.calc = loadCalc();
    renderHeader();
    buildControls();
    buildInputs();
    rerender(true);
    wireNav();
    wireCompsToggle();
    initNotifications();
    loadIdentity();
    loadMapConfig();
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
    comps: (MKT.SALES.rows || []).map((x) => ({ key: x.addr + "|" + x.soldDate + "|" + x.price, addr: x.addr, price: x.price, date: x.soldDate, sqm: x.sqm })),
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
    cur.comps.filter((c) => !prevKeys.has(c.key)).forEach((c) => {
      const psm = c.sqm > 0 ? " · " + gbp(Math.round(c.price / c.sqm)) + "/m²" : "";
      add("sale:" + c.key, "sale", "New N1 sale: " + c.addr + " — " + gbp(c.price) + psm + " (" + monthName(c.date) + ").");
    });
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

// Show £/m² on a sale notification even if it was logged before that detail existed:
// match the sale back to the current dataset by address and splice £/m² in before
// the trailing "(month)". New notifications already carry it, so the guard skips them.
function notifDisplayText(n) {
  if (n.type !== "sale" || /\/m²/.test(n.text)) return n.text;
  const addr = String(n.id || "").replace(/^sale:/, "").split("|")[0];
  const row = (MKT.SALES.rows || []).find((x) => x.addr === addr);
  if (!row || !(row.sqm > 0)) return n.text;
  const psm = " · " + gbp(Math.round(row.price / row.sqm)) + "/m²";
  const at = n.text.lastIndexOf(" (");
  return at === -1 ? n.text + psm : n.text.slice(0, at) + psm + n.text.slice(at);
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
          <div><div class="notif-text">${notifDisplayText(n)}</div><div class="notif-time">${fmtNotifDate(n.ts)}</div></div></div>`).join("")
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

// Data-freshness line: when this view loaded, and the newest dated item across
// sales, base rate, swap and remortgage rate (a superset of what the
// notifications bell watches — see notifySignature, which skips remortgage rate).
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
const scheduleRefresh = debounceRAF(() => rerender(true));

// rebuildCalc: also re-render the calculator's input fields so their defaults pick
// up changed figures/assumptions (skipped on resize/tab switch so a focused field —
// and the phone keyboard — isn't torn down).
function rerender(rebuildCalc) {
  const result = runModel(effectiveData(), currentOverrides());
  window.__model = result; // handy for inspection
  renderMarket(result);
  renderForecast(result);
  if (rebuildCalc) buildCalc(result); else renderCalc(result);
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

function fmtDayMon(iso) {
  if (!iso) return "—";
  const d = iso.length >= 10 ? parseInt(iso.slice(8, 10), 10) : null;
  return (d ? d + " " : "") + monthName(iso);
}

// Total cash you sank in at purchase: deposit + SDLT + other buying costs.
function cashInvested(r) {
  const deposit = Math.max(0, r.inputs.property.purchasePrice - r.inputs.mortgage.principal);
  const sdltPlusBuyCosts = (r.inputs.property.sdltPaid || 0) + (r.inputs.property.otherBuyCosts || 0);
  return { deposit, buyCosts: sdltPlusBuyCosts, total: deposit + sdltPlusBuyCosts };
}

// Outstanding balance at a date — the sale-side economics carry it, so reuse them.
function balanceAt(r, iso) {
  return economicsForWindow({
    property: r.inputs.property, mortgage: r.inputs.mortgage, sellingCfg: r.inputs.sellingCfg,
    presentValue: r.presentValue, presentISO: DATA.META.asOf, growthByYear: r.growthByYear, windowDate: iso, cgtCfg: r.cgtCfg,
  }).outstanding;
}

// ===========================================================================
// MARKET — actual sold & for-sale flats within 2 km: £/m² and achieved vs asking
// ===========================================================================
let _compsView = "sold";
let _comps = { sold: [], listed: [] };
const _compsSort = { sold: { key: "soldDate", dir: "desc" }, listed: { key: "listedDate", dir: "desc" } };
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

// Generic click-to-sort table. cols: [{key,label,get,num,cell,tdcls}]. `sortState`
// {key,dir} is mutated on header click; opts.rerender re-invokes the caller.
function sortableTable(host, cols, rows, sortState, opts) {
  if (!host) return;
  const col = cols.find((c) => c.key === sortState.key) || cols[0];
  const dir = sortState.dir === "asc" ? 1 : -1;
  const sorted = rows.slice().sort((a, b) => {
    let va = col.get(a), vb = col.get(b);
    if (col.num) return ((va == null ? -Infinity : va) - (vb == null ? -Infinity : vb)) * dir;
    return String(va == null ? "" : va).localeCompare(String(vb == null ? "" : vb)) * dir;
  });
  const ar = (c) => c.key === sortState.key ? `<span class="sort-ar">${sortState.dir === "asc" ? "▲" : "▼"}</span>` : "";
  host.innerHTML = `<div class="table-wrap"><table class="rank-table comps-table ${(opts && opts.cls) || ""}">
    <thead><tr>${cols.map((c) => `<th class="sort-th${c.key === sortState.key ? " sorted" : ""}" data-k="${c.key}">${c.label}${ar(c)}</th>`).join("")}</tr></thead>
    <tbody>${sorted.map((x) => `<tr>${cols.map((c) => `<td class="${c.tdcls ? c.tdcls(x) : ""}">${c.cell(x)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
  host.querySelectorAll(".sort-th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k, c = cols.find((cc) => cc.key === k);
    if (sortState.key === k) sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
    else { sortState.key = k; sortState.dir = c.num ? "desc" : "asc"; }
    opts.rerender();
  }));
}

const pctFmt = (v) => v == null ? "—" : signed(v, (x) => x.toFixed(1)) + "%";

function renderComps() {
  const host = $("#mk-comps-body");
  if (!host) return;
  const badge = (n) => `<span class="rank-badge">${n}</span>`;
  const addrCol = { key: "addr", label: "Property", get: (x) => oneWord(x.addr), tdcls: () => "addr-cell", cell: (x) => `<span title="${x.addr}">${badge(x._rank)}${oneWord(x.addr)}</span>` };
  const psmCol = { key: "perSqm", label: "£/m²", num: true, get: (x) => x.perSqm, cell: (x) => x.perSqm ? `<strong>${gbp(x.perSqm)}</strong>` : "—" };
  const sqmCol = { key: "sqm", label: "m²", num: true, get: (x) => x.sqm, cell: (x) => x.sqm || "—" };
  if (_compsView === "sold") {
    const cols = [addrCol,
      { key: "soldDate", label: "Sold", get: (x) => x.soldDate, tdcls: () => "date-cell", cell: (x) => monthName(x.soldDate) },
      { key: "askingPrice", label: "Asking", num: true, get: (x) => x.askingPrice, cell: (x) => x.askingPrice ? gbp(x.askingPrice) : "—" },
      { key: "price", label: "Sold for", num: true, get: (x) => x.price, cell: (x) => `<a href="https://www.gov.uk/search-house-prices" target="_blank" rel="noopener">${gbp(x.price)}</a>` },
      { key: "vsAskingPct", label: "vs&nbsp;ask", num: true, get: (x) => x.vsAskingPct, tdcls: (x) => x.vsAsking < 0 ? "neg-cell" : "", cell: (x) => pctFmt(x.vsAskingPct) },
      psmCol, sqmCol];
    if (_comps.sold.length) sortableTable(host, cols, _comps.sold, _compsSort.sold, { cls: "sticky-first", rerender: renderComps });
    else host.innerHTML = `<p class="muted">No sales match the current filters.</p>`;
  } else {
    const cols = [addrCol,
      { key: "listedDate", label: "Listed", get: (x) => x.listedDate, tdcls: () => "date-cell", cell: (x) => fmtDayMon(x.listedDate) },
      { key: "askingPrice", label: "Asking", num: true, get: (x) => x.askingPrice, cell: (x) => gbp(x.askingPrice) },
      psmCol, sqmCol,
      { key: "daysListed", label: "Days", num: true, get: (x) => x.daysListed, cell: (x) => x.daysListed != null ? x.daysListed : "—" },
      { key: "status", label: "Status", get: (x) => x.status, cell: (x) => x.status }];
    if (_comps.listed.length) sortableTable(host, cols, _comps.listed, _compsSort.listed, { cls: "sticky-first", rerender: renderComps });
    else host.innerHTML = `<p class="muted">No listings match the current filters.</p>`;
  }
}
function wireCompsToggle() {
  document.querySelectorAll("#mk-comps-toggle .toggle-btn").forEach((b) =>
    b.addEventListener("click", () => {
      _compsView = b.dataset.comps;
      document.querySelectorAll("#mk-comps-toggle .toggle-btn").forEach((x) => x.classList.toggle("active", x === b));
      renderComps();
    }));
}

// ---- comp-quality filters (apply to both the sold and for-sale sets) ----
const _compFilters = { newBuild: false, similar: false, noOutliers: false };
let _lastResult = null;

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

// Wire the filter chips once (delegated — the chips are re-rendered each pass).
function wireCompFilters() {
  const cf = $("#mk-filters");
  if (!cf || cf._wired) return;
  cf._wired = true;
  cf.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cf]");
    if (!b) return;
    _compFilters[b.dataset.cf] = !_compFilters[b.dataset.cf];
    if (_lastResult) renderMarket(_lastResult);
  });
}

// Map tiles: OpenStreetMap (no key) by default; MapTiler when the Worker exposes a key.
let _mapTiles = null;

function renderMarket(r) {
  _lastResult = r;
  const p = r.inputs.property, area = p.floorAreaSqm || 0;
  const allSold = MKT.salesStats().rows;
  const allListed = MKT.deriveListings(MKT.RADIUS_KM, DATA.META.asOf);
  const sold = applyCompFilters(allSold, area);
  const listed = applyCompFilters(allListed, area);

  const soldPsm = MKT.median(sold.map((x) => x.perSqm));
  const askPsm = MKT.median(listed.map((x) => x.perSqm));
  const withAsk = sold.filter((x) => Number.isFinite(x.vsAskingPct));
  const medVs = MKT.median(withAsk.map((x) => x.vsAskingPct));
  const pctBelow = withAsk.length ? Math.round(withAsk.filter((x) => x.vsAsking < 0).length / withAsk.length * 100) : null;
  const askPremium = soldPsm && askPsm ? (askPsm / soldPsm - 1) * 100 : null;
  const yourPsm = area ? Math.round(p.purchasePrice / area) : null;

  // ---- headline: the four numbers that matter + what they imply for your flat ----
  const box = (lbl, big, sub, cls) => `<div class="ol-box"><div class="ol-lbl">${lbl}</div><div class="ol-big ${cls || ""}">${big}</div><div class="ol-sub">${sub}</div></div>`;
  const head = $("#mk-headline");
  if (head) {
    head.classList.remove("loading");
    head.innerHTML = `
      <div class="kpi4">
        ${box("Sold £/m²", soldPsm ? gbp(soldPsm) : "—", `median · ${sold.length} sales`)}
        ${box("Asking £/m²", askPsm ? gbp(askPsm) : "—", askPremium != null ? `${pctFmt(askPremium)} vs sold · ${listed.length} for sale` : `${listed.length} for sale`, "amber")}
        ${box("Achieved vs asking", pctFmt(medVs), `median · ${withAsk.length} with asking`, medVs != null && medVs < 0 ? "neg" : "pos")}
        ${box("Sold below asking", pctBelow != null ? pctBelow + "%" : "—", "share of sales")}
      </div>
      <div class="val-note">Your ${area}&nbsp;m² at sold £/m² ≈ <strong>${soldPsm ? gbp(soldPsm * area) : "—"}</strong>;
        at asking £/m² ≈ <strong>${askPsm ? gbp(askPsm * area) : "—"}</strong>${askPsm && medVs != null ? `, or ≈ <strong>${gbp(askPsm * area * (1 + medVs / 100))}</strong> after the typical ${pctFmt(medVs)} discount` : ""}.
        You paid ${yourPsm ? gbp(yourPsm) + "/m²" : "—"}.</div>`;
  }

  const cf = $("#mk-filters");
  if (cf) {
    const chip = (key, label) => `<button type="button" class="filter-chip${_compFilters[key] ? " on" : ""}" data-cf="${key}">${label}</button>`;
    cf.innerHTML = chip("newBuild", "New-build only") + chip("similar", "Similar size ±25%") + chip("noOutliers", "Drop £/m² outliers")
      + `<span class="filter-note">${sold.length}/${allSold.length} sold · ${listed.length}/${allListed.length} for sale</span>`;
  }
  wireCompFilters();
  const src = $("#mk-source");
  if (src) src.innerHTML = `<span class="asof">Sold as of ${fmtDayMon(MKT.SALES.asOf)} · listings ${fmtDayMon(MKT.LISTINGS.asOf)} · <a href="https://www.gov.uk/search-house-prices" target="_blank" rel="noopener">HM Land Registry</a> · <a href="https://find-energy-certificate.service.gov.uk/" target="_blank" rel="noopener">EPC floor areas</a> · <a href="https://homedata.co.uk/" target="_blank" rel="noopener">Homedata</a></span>`;

  // ---- £/m² by quarter (sold) against today's asking median ----
  const qkey = (iso) => iso.slice(0, 4) + " Q" + (Math.floor((parseInt(iso.slice(5, 7), 10) - 1) / 3) + 1);
  const buckets = new Map();
  sold.filter((x) => x.soldDate && Number.isFinite(x.perSqm)).forEach((x) => {
    const k = qkey(x.soldDate);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(x.perSqm);
  });
  const qs = [...buckets.keys()].sort();
  const chartHost = $("#mk-psm-chart"), cap = $("#mk-psm-cap");
  if (chartHost) {
    if (qs.length >= 2) {
      C.lineChart(chartHost, {
        series: [{ name: "Sold £/m² (quarterly median)", color: "#0e9c68", points: qs.map((k) => ({ x: k.replace(/^20/, "'"), y: Math.round(MKT.median(buckets.get(k))) })) }],
        yRef: askPsm || undefined, yRefLabel: askPsm ? "asking now " + gbp(askPsm) : undefined,
        yFormat: (v) => "£" + (v / 1000).toFixed(1) + "k", height: 230, yUnit: "£ per m²",
      });
      if (cap) cap.innerHTML = `Quarterly median of sold £/m² (n = ${qs.map((k) => buckets.get(k).length).join(" · ")}); dashed line = median asking £/m² today. Small samples — read the direction, not the decimals.`;
    } else {
      chartHost.innerHTML = `<p class="muted">Not enough sales across quarters with the current filters.</p>`;
      if (cap) cap.textContent = "";
    }
  }

  // ---- achieved vs asking: one diverging bar per sale that had a listing price ----
  const vaHost = $("#mk-vsask");
  if (vaHost) {
    const rows = withAsk.slice().sort((a, b) => (a.soldDate < b.soldDate ? 1 : -1));
    const maxAbs = Math.max(5, ...rows.map((x) => Math.abs(x.vsAskingPct)));
    vaHost.innerHTML = rows.length ? `<div class="va-list">${rows.map((x) => {
      const w = (Math.abs(x.vsAskingPct) / maxAbs) * 50, neg = x.vsAskingPct < 0;
      return `<div class="va-row" title="${x.addr}">
        <span class="va-name">${oneWord(x.addr)}<span class="va-sub">${monthName(x.soldDate)} · ${gbp(x.askingPrice)} → ${gbp(x.price)}</span></span>
        <span class="va-track"><span class="va-bar ${neg ? "neg" : "pos"}" style="${neg ? "right:50%" : "left:50%"};width:${w.toFixed(1)}%"></span></span>
        <span class="va-pct ${neg ? "neg-cell" : ""}">${pctFmt(x.vsAskingPct)}</span></div>`;
    }).join("")}</div>` : `<p class="muted">No sales with a known asking price match the current filters.</p>`;
    const vc = $("#mk-vsask-cap");
    if (vc) vc.innerHTML = rows.length ? `Sold price vs last asking price, newest first. Median <strong>${pctFmt(medVs)}</strong>; ${pctBelow}% sold below asking — price yours ~${medVs != null ? Math.abs(medVs).toFixed(1) : "—"}% above where you want to land.` : "";
  }

  // ---- table: price rank (1 = dearest) ----
  const soldR = sold.map((x) => ({ ...x })), listR = listed.map((x) => ({ ...x }));
  soldR.slice().sort((a, b) => b.price - a.price).forEach((x, i) => { x._rank = i + 1; });
  listR.slice().sort((a, b) => b.askingPrice - a.askingPrice).forEach((x, i) => { x._rank = i + 1; });
  _comps = { sold: soldR, listed: listR };
  renderComps();

  // ---- map: sold, for sale, and your flat ----
  const tipHtml = (a, b, c2) => `<strong>${a}</strong><span>${b}</span><span>${c2}</span>`;
  const tipPlain = (a, b, c2) => `${a} — ${b} · ${c2}`;
  const psmTxt = (v) => v ? " · " + gbp(v) + "/m²" : "";
  const salePins = soldR.map((x) => ({ lat: x.lat, lng: x.lng, n: x._rank,
    tip: tipHtml(x.addr, gbp(x.price) + psmTxt(x.perSqm), "sold " + monthName(x.soldDate) + (x.vsAskingPct != null ? " · " + pctFmt(x.vsAskingPct) + " vs ask" : "")),
    plain: tipPlain(x.addr, gbp(x.price), "sold " + monthName(x.soldDate)) }));
  const listPins = listR.map((x) => ({ lat: x.lat, lng: x.lng, n: x._rank, listing: true,
    tip: tipHtml(x.addr, gbp(x.askingPrice) + psmTxt(x.perSqm), x.status),
    plain: tipPlain(x.addr, gbp(x.askingPrice) + " asking", x.status) }));
  const you = Number.isFinite(p.lat) && Number.isFinite(p.lng) ? [{ lat: p.lat, lng: p.lng, you: true,
    tip: tipHtml("Your flat — " + p.postcode, gbp(p.purchasePrice) + psmTxt(yourPsm), "bought " + monthName(p.purchaseDate)),
    plain: tipPlain("Your flat — " + p.postcode, gbp(p.purchasePrice), "bought " + monthName(p.purchaseDate)) }] : [];
  const mapHost = $("#mk-map");
  if (mapHost) C.scatterMap(mapHost, { points: salePins.concat(listPins, you), tiles: _mapTiles });
  const legend = $("#mk-legend");
  if (legend) legend.innerHTML = `<div class="map-legend">
      <div class="map-legend-item"><span class="map-num you"></span><span><strong>Your flat</strong> · ${gbp(p.purchasePrice)}${psmTxt(yourPsm)}</span></div>
      ${soldR.slice().sort((a, b) => a._rank - b._rank).map((x) => `<div class="map-legend-item"><span class="map-num">${x._rank}</span><span>${oneWord(x.addr)} · sold ${gbp(x.price)}${psmTxt(x.perSqm)}</span></div>`).join("")}
      ${listR.slice().sort((a, b) => a._rank - b._rank).map((x) => `<div class="map-legend-item"><span class="map-num listing">${x._rank}</span><span>${oneWord(x.addr)} · ${gbp(x.askingPrice)}${psmTxt(x.perSqm)}</span></div>`).join("")}
    </div>`;
}

// Optional keyed basemap: the Worker returns a MapTiler key from its environment
// (secret MAPTILER_KEY). No key / no Worker → keep the keyless OSM tiles.
async function loadMapConfig() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    const res = await fetch("/api/map-config", { headers: { accept: "application/json" }, signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const d = await res.json();
    if (d && d.maptilerKey) {
      _mapTiles = { url: "https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}@2x.png?key=" + encodeURIComponent(d.maptilerKey),
        attr: '© <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' };
      if (_lastResult) renderMarket(_lastResult);
    }
  } catch (_) { /* not deployed or offline — keep OSM */ }
}

// ===========================================================================
// FORECAST — best window, assumptions, projected proceeds, quarterly exit, rates
// ===========================================================================
let _rateOpts = null;

function renderForecast(r) {
  const p = r.inputs.property, m = r.inputs.mortgage, cfg = r.inputs.sellingCfg;
  const cashIn = cashInvested(r).total;

  // ---- model read (best window) ----
  const vh = $("#fc-verdict");
  if (vh && r.best) {
    vh.classList.remove("loading");
    const best = r.best, sig = signalLabel(best.composite), next = r.ranked[1];
    const drivers = Object.entries(best.contributions)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2)
      .map(([k, v]) => `${FACTOR_LABELS[k] || k} ${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}`);
    vh.innerHTML = `
      <div class="verdict-kicker">Best time to sell — model read</div>
      <div class="lm-verdict-head">
        <div class="lm-verdict-window">${best.window.label}</div>
        <span class="pill pill-${sig.tone}">${sig.label} · ${signed(best.composite)}</span>
      </div>
      <p class="lm-verdict-lead">Projected sale value <strong>${gbp(best.saleValue)}</strong> → net proceeds
        <strong>${gbp(best.net)}</strong>. Top drivers: ${drivers.join(" · ")}.
        Next best: <strong>${next.window.label}</strong> (${signed(next.composite)}). Est. value today ${gbp(r.presentValue)}.</p>`;
  }

  // ---- projected net-proceeds curve (scenario band) + best window ----
  const procHost = $("#fc-proceeds-chart");
  const startIdx = ymIndex(DATA.META.asOf);
  const netAt = (gby, iso) => economicsForWindow({ property: p, mortgage: m, sellingCfg: cfg, presentValue: r.presentValue, presentISO: DATA.META.asOf, growthByYear: gby, windowDate: iso, cgtCfg: r.cgtCfg }).net;
  if (procHost && r.best) {
    const OUT = 30, labels = [], base = [], lo = [], hi = [];
    for (let k = 0; k <= OUT; k += 1) {
      const iso = ymToISO(startIdx + k);
      labels.push(monthName(iso).replace(/ 20/, " '"));
      base.push(Math.round(netAt(r.growthByYear, iso)));
      lo.push(Math.round(netAt(DATA.FORECAST.scenarios.pessimistic, iso)));
      hi.push(Math.round(netAt(DATA.FORECAST.scenarios.optimistic, iso)));
    }
    const bestIdx = Math.max(0, Math.min(OUT, ymIndex(r.best.window.date) - startIdx));
    C.lineChart(procHost, {
      series: [{ name: "Net proceeds (" + (state.custom ? "custom" : r.scenarioName) + ")", color: "#2f7d57", points: labels.map((l, i) => ({ x: l, y: base[i] })), dots: false }],
      band: { lower: lo, upper: hi, color: "#2f7d57" },
      markers: [{ x: labels[bestIdx], label: "best window" }],
      yRef: cashIn, yRefLabel: "you put in " + gbp(cashIn),
      yFormat: kFmt, height: 250, yUnit: "£ net proceeds",
    });
    const pcap = $("#fc-proceeds-cap");
    if (pcap) {
      const diff = base[bestIdx] - base[0];
      pcap.innerHTML = `Net cash by month after mortgage, ERC and selling costs; shaded band = bear→bull growth. Best window <strong>${r.best.window.label}</strong> (~${gbp(base[bestIdx])}${bestIdx > 0 ? ", " + (diff >= 0 ? "+" : "") + gbp(diff) + " vs now" : ""}).`;
    }
  }

  // ---- quarter-by-quarter economics (now → end 2028) ----
  const S = DATA.SEASONALITY;
  const sMin = S ? Math.min(...S.monthIndex) : 0, sMax = S ? Math.max(...S.monthIndex) : 1;
  const qrows = [];
  for (let idx = startIdx; idx <= ymIndex("2028-12"); idx += 3) {
    const iso = ymToISO(idx);
    const e = economicsForWindow({ property: p, mortgage: m, sellingCfg: cfg, presentValue: r.presentValue, presentISO: DATA.META.asOf,
      growthByYear: r.growthByYear, windowDate: iso, cgtCfg: r.cgtCfg });
    const mi = parseInt(iso.slice(5, 7), 10) - 1;
    qrows.push({ iso, mi, label: monthName(iso).replace(/ 20/, " '"), ...e, demand: S ? S.monthIndex[mi] : 1 });
  }
  const maxNet = Math.max(...qrows.map((q) => q.net));
  const qt = $("#fc-qtable");
  if (qt) {
    qt.classList.remove("loading");
    const dbar = (v) => {
      const w = sMax > sMin ? Math.round(((v - sMin) / (sMax - sMin)) * 100) : 50;
      const tag = v >= sMax - 0.03 ? "High" : v >= 1.0 ? "Good" : "Low";
      return `<span class="dbar-wrap"><span class="dbar" style="width:${Math.max(8, w)}%"></span></span><span class="dbar-tag">${tag}</span>`;
    };
    qt.innerHTML = `<div class="table-wrap"><table class="rank-table ol-qt">
      <thead><tr><th>Quarter</th><th>Sale value</th><th>Net proceeds</th><th>Profit</th><th>Demand</th></tr></thead>
      <tbody>${qrows.map((q) => {
        const profit = q.net - cashIn;
        const peak = q.mi >= 2 && q.mi <= 4; // spring (Mar–May)
        return `<tr class="${q.net === maxNet ? "best-row" : ""}${peak ? " peak" : ""}">
          <td>${q.label}${peak ? ' <span class="peak-tag">spring</span>' : ""}</td>
          <td>${gbp(q.saleValue)}</td><td>${gbp(q.net)}</td>
          <td class="${profit >= 0 ? "" : "neg-cell"}">${signed(profit, gbp)}</td>
          <td class="dbar-cell">${dbar(q.demand)}</td></tr>`;
      }).join("")}</tbody>
    </table></div>`;
  }
  const qcap = $("#fc-qtable-cap");
  if (qcap) qcap.innerHTML = `<strong>Profit</strong> = net proceeds − the ${gbp(cashIn)} you put in (deposit + SDLT + costs). Spring quarters carry the strongest demand.`;

  // ---- rate sensitivity: real elasticities from UK HPI + BoE + volumes ----
  const st = MKT.salesStats();
  const area = p.floorAreaSqm || 0;
  const basePrice = st.medianPerSqm && area ? Math.round(st.medianPerSqm * area) : r.presentValue;
  const baseDays = st.medianDaysOnMarket != null ? Math.round(st.medianDaysOnMarket) : 120;
  const baseRate = DATA.RATES.remortgage70Now;
  const rateGrid = [3.5, 4, 4.5, 5, 5.5, 6, 6.5];
  const PRICE_ELAST = -0.022;   // UK HPI Islington flats vs BoE 2-yr fix, 2021 peak → 2026
  const DAYS_ELAST = 0.024;     // London sales-volume fall per +1pp (turnover/liquidity proxy)
  let mIdx = 0; rateGrid.forEach((rt, i) => { if (Math.abs(rt - baseRate) < Math.abs(rateGrid[mIdx] - baseRate)) mIdx = i; });
  // 2-yr-fix path from the BoE OIS forward curve (see dataset.js RATES.oisFix2yForecast).
  const OIS = DATA.RATES.oisFix2yForecast || { asOf: "2026-06", d30: 0.2 };
  const r30 = Math.round((baseRate + OIS.d30) * 100) / 100;
  _rateOpts = {
    xLabels: rateGrid.map((rt) => rt.toFixed(1) + "%"), xValues: rateGrid, height: 260,
    left: { name: "Est. price", color: "#0e9c68", values: rateGrid.map((rt) => Math.round(basePrice * (1 + PRICE_ELAST * (rt - baseRate)))), format: (val) => "£" + Math.round(val / 1000) + "k" },
    right: { name: "Time to sell", color: "#b07d2a", values: rateGrid.map((rt) => Math.max(20, Math.round(baseDays * (1 + DAYS_ELAST * (rt - baseRate))))), format: (val) => Math.round(val) + "d" },
    marker: { index: mIdx, label: "now ~" + baseRate.toFixed(1) + "%" }, fc: [{ label: "", rate: baseRate }, { label: "'30", rate: r30 }],
  };
  const rs = $("#fc-rate-sens");
  if (rs) C.dualAxisLine(rs, { xLabels: _rateOpts.xLabels, xValues: _rateOpts.xValues, height: _rateOpts.height,
    left: _rateOpts.left, right: _rateOpts.right, marker: _rateOpts.marker, forecast: _rateOpts.fc });
  const rcap = $("#fc-rate-cap");
  if (rcap) rcap.innerHTML = `Islington flat prices moved ≈−2.2% per +1&nbsp;pt on the 2-yr fix; time-to-sell from London volumes. Dots = <a href="https://www.bankofengland.co.uk/statistics/yield-curves" target="_blank" rel="noopener">BoE OIS</a> path: fix ~${baseRate.toFixed(1)}% now → ~${r30.toFixed(1)}% by 2030.`;

  // ---- analyst forecasts (compact consensus) ----
  const fHost = $("#fc-forecasts");
  if (fHost) {
    fHost.classList.remove("loading");
    const fcRows = MKT.FORECASTS.rows;
    const consensus = MKT.median(fcRows.map((x) => x.priceYoY).filter(Number.isFinite));
    const rowsHtml = fcRows.map((x) => `<div class="statrow"><span class="sr-label">${x.url ? `<a href="${x.url}" target="_blank" rel="noopener">${x.short || x.source}</a>` : (x.short || x.source)}</span><span class="sr-value">${x.priceYoY == null ? "—" : signed(x.priceYoY, (v) => v.toFixed(1)) + "%"}</span><span class="sr-sub">${x.horizon}</span></div>`).join("");
    fHost.innerHTML = (consensus != null ? `<p class="src-line">Consensus ≈ <strong>${signed(consensus, (v) => v.toFixed(1))}% /yr</strong> price growth.</p>` : "")
      + `<div class="statrows">${rowsHtml}</div><p class="src-line asof">Analyst views · ${monthName(MKT.FORECASTS.asOf)}.</p>`;
  }
}

// ---------------------------------------------------------------------------
// Forecast assumptions — scenario, growth by year, remortgage rate, value now
// ---------------------------------------------------------------------------
function buildControls() {
  const host = $("#fc-controls");
  host.classList.remove("loading");
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
      <label class="ctrl"><span>Forecast scenario</span>
        <select id="ctrl-scenario">
          <option value="pessimistic">Pessimistic</option>
          <option value="base" selected>Base (consensus)</option>
          <option value="optimistic">Optimistic</option>
        </select></label>
      <label class="ctrl"><span>Remortgage rate after fix (%)</span>
        <input id="ctrl-remo" type="number" min="0" max="15" step="0.05" value="${state.remortgageRate}"></label>
      <label class="ctrl"><span>Est. value now (£)</span>
        <input id="ctrl-pv" type="number" min="0" step="1000"></label>
      ${yrs.map((y) => `
      <label class="ctrl"><span>${y} growth (%)</span>
        <input class="ctrl-growth" data-year="${y}" type="number" min="-20" max="20" step="0.5" value="${state.growthByYear[y]}"></label>`).join("")}
      <button id="ctrl-reset" class="btn-reset" type="button">Reset to consensus</button>
    </div>
    <p class="muted small">These drive the forecast and the Finances calculator. Defaults: Savills / Knight Frank / Zoopla consensus
      and the current rate market. Est. value now blends your purchase trended by the Islington index with sold £/m² × floor area.</p>`;

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
    rerender(true);
  });
  $("#ctrl-remo").addEventListener("input", (e) => { state.remortgageRate = num(e.target.value, state.remortgageRate); scheduleRefresh(); });
  pvInput.addEventListener("input", (e) => { state.presentValue = e.target.value === "" ? null : num(e.target.value); scheduleRefresh(); });
  document.querySelectorAll(".ctrl-growth").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const y = e.target.dataset.year;
      state.growthByYear[y] = num(e.target.value, state.growthByYear[y]);
      state.custom = true;
      scheduleRefresh();
    });
  });
  $("#ctrl-reset").addEventListener("click", () => {
    state.scenario = DATA.FORECAST.defaultScenario;
    state.custom = false;
    state.growthByYear = { ...DATA.FORECAST.scenarios[state.scenario] };
    state.remortgageRate = DATA.MORTGAGE.remortgageRatePctAssumed;
    state.presentValue = null;
    state.rentFactor = 1;
    $("#ctrl-scenario").value = state.scenario;
    $("#ctrl-remo").value = state.remortgageRate;
    pvInput.value = Math.round(derived / 1000) * 1000;
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
    $("#preset-note").textContent = "Bear / Base / Bull move growth, remortgage rate and rent together.";
    syncGrowthSliders();
    rerender(true);
  });
}

function syncGrowthSliders() {
  document.querySelectorAll(".ctrl-growth").forEach((inp) => { inp.value = state.growthByYear[inp.dataset.year]; });
}

// Apply a Bear/Base/Bull preset: growth scenario, remortgage rate and rent together.
function applyPreset(name) {
  const p = SENSITIVITY[name];
  if (!p) return;
  state.scenario = p.scenario;
  state.custom = false;
  state.growthByYear = { ...DATA.FORECAST.scenarios[p.scenario] };
  state.remortgageRate = p.remortgageRate;
  state.rentFactor = p.rentFactor;
  const sc = $("#ctrl-scenario"); if (sc) sc.value = p.scenario;
  const remo = $("#ctrl-remo"); if (remo) remo.value = p.remortgageRate;
  syncGrowthSliders();
  const note = $("#preset-note"); if (note) note.textContent = p.note;
  document.querySelectorAll(".preset-btn").forEach((b) => b.classList.toggle("active", b.dataset.preset === name));
  rerender(true);
}

// ===========================================================================
// FINANCES — calculator. Pick a calculation; its inputs default to your figures
// and the forecast assumptions, and every outcome recomputes as you type.
// ===========================================================================
const CALC_KEY = "flatForecaster.calc.v1";
function loadCalc() {
  try { const s = JSON.parse(localStorage.getItem(CALC_KEY)); if (s && CALCS[s.type]) return { type: s.type, params: s.params || {} }; } catch (_) {}
  return { type: "sell", params: {} };
}
function saveCalc() { try { localStorage.setItem(CALC_KEY, JSON.stringify(state.calc)); } catch (_) {} }

const nowYM = () => DATA.META.asOf.slice(0, 7);
const rowT = (label, val, note, cls) => `<tr${cls ? ` class="${cls}"` : ""}><td>${label}${note ? ` <span class="cnote">${note}</span>` : ""}</td><td class="num">${val}</td></tr>`;
const minus = (v) => v > 0 ? "−" + gbp(v) : gbp(0);
const headline = (kicker, big, cls, lead) => `<div class="verdict-kicker">${kicker}</div><div class="calc-big ${cls || ""}">${big}</div>${lead ? `<p class="letting-lead">${lead}</p>` : ""}`;
const yrsMo = (months) => { const y = Math.floor(months / 12), mo = months % 12; return (y ? y + " yr" + (y > 1 ? "s" : "") : "") + (y && mo ? " " : "") + (mo ? mo + " mo" : y ? "" : "0 mo"); };

// Simulate the mortgage month by month from `fromISO`, at the current fixed rate
// until the fix ends and the remortgage rate after, with an optional monthly
// overpayment and an up-front lump sum. The contractual payment is always the one
// you'd pay WITHOUT overpaying (a shadow balance sets it at the remortgage), so
// overpaying shortens the term rather than lowering the payment.
function payoffSchedule(m, fromISO, overpay, lump) {
  const purchase = m._purchaseDate;
  const io = m.repaymentType === "interest_only";
  const fixIdx = ymIndex(m.fixEndDate);
  const termMonths = Math.round(m.termYears * 12);
  const paid = Math.max(0, monthsBetween(purchase, fromISO));
  // balance at fromISO without overpayments (same path as economicsForWindow)
  const atFix = monthsBetween(purchase, m.fixEndDate);
  let shadow = io ? m.principal : (ymIndex(fromISO) < fixIdx
    ? balanceAfter(m.principal, m.ratePct, m.termYears, paid)
    : balanceAfter(balanceAfter(m.principal, m.ratePct, m.termYears, atFix), m.remortgageRatePctAssumed, (termMonths - atFix) / 12, paid - atFix));
  let bal = Math.max(0, shadow - (lump || 0));
  let idx = ymIndex(fromISO), rate = idx < fixIdx ? m.ratePct : m.remortgageRatePctAssumed;
  const payFor = (b, months) => io ? b * rate / 1200 : monthlyPayment(b, rate, Math.max(1, months) / 12);
  let pay = payFor(shadow, termMonths - paid);
  let interest = 0, k = 0;
  while (bal > 0.5 && k < 720) {
    if (idx === fixIdx && rate !== m.remortgageRatePctAssumed) {
      rate = m.remortgageRatePctAssumed;
      pay = payFor(shadow, termMonths - paid - k);
    }
    const i = bal * rate / 1200;
    interest += i;
    bal = Math.max(0, bal + i - pay - (overpay || 0));
    shadow = Math.max(0, shadow + shadow * rate / 1200 - pay);
    idx++; k++;
    if (io && k >= termMonths - paid) break; // interest-only: balance repaid at term end
  }
  return { months: k, interest };
}

// England & NI SDLT bands by buyer type (from 1 Apr 2025). Returns per-band rows.
function sdltBands(price, kind) {
  let bands = [[125000, 0], [250000, 0.02], [925000, 0.05], [1500000, 0.10], [Infinity, 0.12]];
  if (kind === "ftb" && price <= 500000) bands = [[300000, 0], [500000, 0.05]];
  const sur = kind === "additional" ? 0.05 : 0;
  const rows = []; let prev = 0, total = 0;
  for (const [cap, rate] of bands) {
    if (price <= prev) break;
    const slice = Math.min(price, cap) - prev, tax = slice * (rate + sur);
    rows.push({ from: prev, to: Math.min(price, cap), rate: rate + sur, tax });
    total += tax; prev = cap;
  }
  return { rows, total: Math.round(total) };
}

const CALCS = {
  sell: {
    label: "Sell — net proceeds & profit",
    desc: "What you'd walk away with selling at a given price and date, after the mortgage, ERC, fees and tax — and the profit on the cash you put in.",
    fields: (r) => [
      { id: "date", label: "Sale completes", type: "month", def: nowYM() },
      { id: "price", label: "Sale price (£)", type: "number", step: 5000, auto: true, hint: "auto: projected value" },
    ],
    run(r, v) {
      const date = v.date || nowYM();
      const proj = economicsForWindow({ property: r.inputs.property, mortgage: r.inputs.mortgage, sellingCfg: r.inputs.sellingCfg,
        presentValue: r.presentValue, presentISO: DATA.META.asOf, growthByYear: r.growthByYear, windowDate: date, cgtCfg: r.cgtCfg });
      const price = v.price > 0 ? v.price : Math.round(proj.saleValue / 1000) * 1000;
      const e = economicsForWindow({ property: r.inputs.property, mortgage: r.inputs.mortgage, sellingCfg: r.inputs.sellingCfg,
        presentValue: price, presentISO: date, growthByYear: r.growthByYear, windowDate: date, cgtCfg: r.cgtCfg });
      const ci = cashInvested(r);
      const interest = interestPaidToDate(r.inputs.mortgage, date);
      const profit = e.net - ci.total, allIn = profit - interest;
      const area = r.inputs.property.floorAreaSqm;
      return headline("Net proceeds · " + monthName(date), gbp(e.net), "",
        `Profit on the ${gbp(ci.total)} cash you put in: <strong class="${profit >= 0 ? "delta up" : "delta down"}">${signed(profit, gbp)}</strong>
         (${signed(profit / ci.total * 100, (x) => x.toFixed(1))}%). After ${gbp(interest)} mortgage interest paid: <strong class="${allIn >= 0 ? "delta up" : "delta down"}">${signed(allIn, gbp)}</strong>.`) + `
        <table class="calc">
          ${rowT("Sale price", gbp(price), (v.price > 0 ? "your figure" : "projected · " + (state.custom ? "custom" : r.scenarioName) + " scenario") + (area ? " · " + gbp(price / area) + "/m²" : ""))}
          ${rowT("Mortgage to repay", minus(e.outstanding), "balance at " + monthName(date))}
          ${rowT("Early-repayment charge", minus(e.erc), e.erc > 0 ? "inside a fixed period" : "none at this date")}
          ${rowT("Estate agent (incl VAT)", minus(e.costs.agent), r.inputs.sellingCfg.agentPct + "% + " + r.inputs.sellingCfg.vatPct + "% VAT")}
          ${rowT("Legal / conveyancing", minus(e.costs.legal))}
          ${rowT("EPC &amp; misc", minus(e.costs.misc))}
          ${rowT("Capital Gains Tax", minus(e.cgt), r.inputs.property.isPrimaryResidence ? "main residence — exempt" : "")}
          ${rowT("Net proceeds", gbp(e.net), "cash in hand", "sub")}
          ${rowT("Less cash put in", minus(ci.total), "deposit " + gbp(ci.deposit) + " + SDLT/costs " + gbp(ci.buyCosts))}
          ${rowT("Profit on cash", signed(profit, gbp), "", "sub")}
          ${rowT("Less interest paid to date", minus(interest))}
          ${rowT("All-in profit", signed(allIn, gbp), "", "total")}
        </table>`;
    },
  },

  breakeven: {
    label: "Break-even sale price",
    desc: "The lowest sale price that gets your cash back, for three cumulative targets — optionally crediting the rent you'd otherwise have paid.",
    fields: () => [
      { id: "date", label: "Sale completes", type: "month", def: nowYM() },
      { id: "rent", label: "Equivalent rent (£/mo, for the credit)", type: "number", step: 25, def: MKT.RENT.currentAvg2bed },
    ],
    run(r, v) {
      const date = v.date || nowYM();
      const be = breakEvenRecoupAll({ property: r.inputs.property, mortgage: r.inputs.mortgage, sellingCfg: r.inputs.sellingCfg,
        saleDateISO: date, cgtCfg: r.cgtCfg, rentCfg: { monthlyRent: v.rent, growthPct: MKT.RENT.yoYPct } });
      const val = economicsForWindow({ property: r.inputs.property, mortgage: r.inputs.mortgage, sellingCfg: r.inputs.sellingCfg,
        presentValue: r.presentValue, presentISO: DATA.META.asOf, growthByYear: r.growthByYear, windowDate: date, cgtCfg: r.cgtCfg }).saleValue;
      const ci = be.inputs, T = be.tiers;
      const tr = (name, note, t) => `<tr><td>${name} <span class="cnote">${note}</span></td><td class="num">${gbp(t.recoup.breakEvenPrice)}</td><td class="num">${gbp(t.vsRent.breakEvenPrice)}</td><td class="num ${val - t.recoup.breakEvenPrice >= 0 ? "" : "neg-cell"}">${signed(val - t.recoup.breakEvenPrice, gbp)}</td></tr>`;
      return headline("Break-even · everything back incl. interest", gbp(T.all.recoup.breakEvenPrice), "",
        `Projected value at ${monthName(date)} is <strong>${gbp(val)}</strong> — ${val >= T.all.recoup.breakEvenPrice ? "above" : "below"} the all-in break-even by <strong>${gbp(Math.abs(val - T.all.recoup.breakEvenPrice))}</strong>.`) + `
        <div class="table-wrap"><table class="rank-table kv">
          <thead><tr><th>Target</th><th>Recoup cash</th><th>Credit rent</th><th>Headroom</th></tr></thead>
          <tbody>
            ${tr("(i) Deposit", gbp(ci.deposit), T.deposit)}
            ${tr("(ii) + SDLT &amp; costs", gbp(ci.deposit + ci.sdlt + ci.buyingCosts), T.costs)}
            ${tr("(iii) + interest", gbp(ci.deposit + ci.sdlt + ci.buyingCosts + ci.interestPaid), T.all)}
          </tbody></table></div>
        <p class="muted small">Each price clears the ${gbp(ci.outstanding)} mortgage${ci.erc > 0 ? ", " + gbp(ci.erc) + " ERC" : ""}, the agent fee and legal/EPC, then returns the target.
          <strong>Credit rent</strong> nets off the ${gbp(be.rentSaved)} rent you'd have paid since purchase. Headroom = projected value − recoup price.</p>`;
    },
  },

  position: {
    label: "What we've paid so far",
    desc: "Cash out of pocket since purchase, the mortgage balance and your equity at a date.",
    fields: () => [{ id: "date", label: "As at", type: "month", def: nowYM() }],
    run(r, v) {
      const date = v.date || nowYM();
      const p = r.inputs.property, m = r.inputs.mortgage, ci = cashInvested(r);
      const io = m.repaymentType === "interest_only";
      const months = Math.max(0, monthsBetween(p.purchaseDate, date));
      const interest = interestPaidToDate(m, date);
      const bal = balanceAt(r, date);
      const principalPaid = io ? 0 : m.principal - bal;
      const payments = interest + principalPaid;
      const val = economicsForWindow({ property: p, mortgage: m, sellingCfg: r.inputs.sellingCfg, presentValue: r.presentValue,
        presentISO: DATA.META.asOf, growthByYear: r.growthByYear, windowDate: date, cgtCfg: r.cgtCfg }).saleValue;
      return headline("Total paid · " + monthName(date), gbp(ci.total + payments), "",
        `${months} months since purchase. Of the ${gbp(payments)} in mortgage payments, <strong>${gbp(interest)}</strong> was interest and <strong>${gbp(principalPaid)}</strong> paid down the loan.`) + `
        <table class="calc">
          ${rowT("Purchase price", gbp(p.purchasePrice), monthName(p.purchaseDate))}
          ${rowT("Deposit", gbp(ci.deposit), (p.purchasePrice ? (ci.deposit / p.purchasePrice * 100).toFixed(0) : 0) + "% of price")}
          ${rowT("Stamp Duty + buying costs", gbp(ci.buyCosts))}
          ${rowT("Cash in at purchase", gbp(ci.total), "", "sub")}
          ${rowT("Mortgage interest", gbp(interest), months + " months")}
          ${rowT("Capital repaid", gbp(principalPaid))}
          ${rowT("Total paid", gbp(ci.total + payments), "all cash out of pocket", "total")}
        </table>
        <table class="calc" style="margin-top:14px">
          ${rowT("Mortgage balance", gbp(bal), "outstanding at " + monthName(date))}
          ${rowT("Est. value", gbp(val), "model")}
          ${rowT("Equity", gbp(val - bal), "value − balance", "sub")}
        </table>`;
    },
  },

  remortgage: {
    label: "Remortgage — new monthly payment",
    desc: "What happens to the monthly payment when the current fix ends, at a rate and term you choose.",
    fields: (r) => [
      { id: "rate", label: "New rate (%)", type: "number", step: 0.05, def: state.remortgageRate },
      { id: "years", label: "New fix length (years)", type: "number", step: 1, def: r.inputs.mortgage.remortgageFixYears || 2 },
      { id: "term", label: "Remaining term (years)", type: "number", step: 1,
        def: Math.round(r.inputs.mortgage.termYears - monthsBetween(r.inputs.property.purchaseDate, r.inputs.mortgage.fixEndDate) / 12) },
      { id: "fee", label: "Product / arrangement fee (£)", type: "number", step: 100, def: 999 },
    ],
    run(r, v) {
      const m = r.inputs.mortgage, io = m.repaymentType === "interest_only";
      const fixMonths = monthsBetween(r.inputs.property.purchaseDate, m.fixEndDate);
      const balFix = io ? m.principal : balanceAfter(m.principal, m.ratePct, m.termYears, fixMonths);
      const payNow = io ? m.principal * m.ratePct / 1200 : monthlyPayment(m.principal, m.ratePct, m.termYears);
      const term = Math.max(1, v.term), rate = v.rate;
      const payNew = io ? balFix * rate / 1200 : monthlyPayment(balFix, rate, term);
      const n = Math.round(Math.max(0, v.years) * 12);
      const balEnd = io ? balFix : balanceAfter(balFix, rate, term, n);
      const interestFix = payNew * n - (balFix - balEnd);
      const d = payNew - payNow;
      return headline("New payment from " + monthName(m.fixEndDate), gbp(payNew) + "/mo", d > 0 ? "neg" : "pos",
        `<strong class="${d > 0 ? "delta down" : "delta up"}">${signed(d, gbp)}/mo</strong> vs today's ${gbp(payNow)} at ${pct(m.ratePct)} — ${signed(d * 12, gbp)} a year.`) + `
        <table class="calc">
          ${rowT("Balance when the fix ends", gbp(balFix), monthName(m.fixEndDate))}
          ${rowT("Payment now", gbp(payNow) + "/mo", pct(m.ratePct) + (io ? " · interest-only" : ""))}
          ${rowT("Payment after", gbp(payNew) + "/mo", pct(rate) + " · " + term + "-yr term")}
          ${rowT("Monthly change", signed(d, gbp), "", "sub")}
          ${rowT("Interest over the " + v.years + "-yr fix", gbp(interestFix))}
          ${rowT("Plus fee", gbp(v.fee))}
          ${rowT("Cost of the fix", gbp(interestFix + v.fee), "interest + fee", "sub")}
          ${rowT("Balance when it ends", gbp(balEnd), monthName(ymToISO(ymIndex(m.fixEndDate) + n)), "total")}
        </table>
        <p class="muted small">Today's quoted 2-yr fix at ~70% LTV: ${pct(DATA.RATES.remortgage70Now)} (<a href="https://www.bankofengland.co.uk/boeapps/database" target="_blank" rel="noopener">BoE</a>). Compare deals on <a href="https://www.moneysavingexpert.com/mortgages/best-buys/" target="_blank" rel="noopener">MSE best buys</a>.</p>`;
    },
  },

  overpay: {
    label: "Mortgage overpayment",
    desc: "Interest saved and time cut by overpaying each month and/or a one-off lump sum from today.",
    fields: () => [
      { id: "monthly", label: "Extra per month (£)", type: "number", step: 50, def: 500 },
      { id: "lump", label: "Lump sum now (£)", type: "number", step: 1000, def: 0 },
    ],
    run(r, v) {
      const m = r.inputs.mortgage;
      if (m.repaymentType === "interest_only" && !(v.monthly > 0) && !(v.lump > 0)) return `<p class="muted">Interest-only: add an overpayment to see the effect.</p>`;
      const base = payoffSchedule(m, DATA.META.asOf, 0, 0);
      const over = payoffSchedule(m, DATA.META.asOf, v.monthly, v.lump);
      const saved = base.interest - over.interest, cut = base.months - over.months;
      const bal = balanceAt(r, DATA.META.asOf);
      const allowance = bal * 0.10;
      const yearOver = v.monthly * 12 + v.lump;
      return headline("Interest saved", gbp(saved), "pos",
        `Mortgage-free <strong>${yrsMo(cut)}</strong> sooner (${monthName(ymToISO(ymIndex(DATA.META.asOf) + over.months))} vs ${monthName(ymToISO(ymIndex(DATA.META.asOf) + base.months))}).`) + `
        <table class="calc">
          ${rowT("Balance today", gbp(bal))}
          ${rowT("Interest — as now", gbp(base.interest), yrsMo(base.months) + " to clear")}
          ${rowT("Interest — overpaying", gbp(over.interest), yrsMo(over.months) + " to clear")}
          ${rowT("Interest saved", gbp(saved), "", "total")}
        </table>
        <p class="muted small ${yearOver > allowance ? "neg-cell" : ""}">Most fixes allow ~10% of the balance a year (≈ ${gbp(allowance)}) without an ERC; this plan is ${gbp(yearOver)} in the first year${yearOver > allowance ? " — above that, check your ERC" : ""}.
          Assumes ${pct(m.ratePct)} to ${monthName(m.fixEndDate)}, then ${pct(m.remortgageRatePctAssumed)}.</p>`;
    },
  },

  rentbuy: {
    label: "Keep owning vs sell & rent",
    desc: "Wealth at a horizon if you keep the flat vs sell now, invest the proceeds and rent an equivalent 2-bed.",
    fields: () => [
      { id: "horizon", label: "Compare over", type: "select", options: RB_HORIZONS.map((h) => [h.date, h.label]), def: "2029-06-01" },
      { id: "rent", label: "Rent for equivalent (£/mo)", type: "number", step: 25, def: Math.round(MKT.RENT.currentAvg2bed * (state.rentFactor || 1) / 25) * 25 },
      { id: "rentg", label: "Rent growth (%/yr)", type: "number", step: 0.25, def: MKT.RENT.yoYPct },
      { id: "sc", label: "Service charge + ground rent (£/yr)", type: "number", step: 50, def: DATA.LETTING.serviceChargeGroundRentPerYear },
      { id: "maint", label: "Maintenance (% of value/yr)", type: "number", step: 0.1, def: 1.0 },
      { id: "opp", label: "Return on invested cash (%/yr)", type: "number", step: 0.25, def: DATA.LETTING.opportunityRatePct },
    ],
    run(r, v) {
      const mortgage = { ...r.inputs.mortgage, _purchaseDate: r.inputs.property.purchaseDate };
      const res = rentVsBuy({
        property: r.inputs.property, mortgage, sellingCfg: r.inputs.sellingCfg,
        presentValue: r.presentValue, presentISO: DATA.META.asOf, growthByYear: r.growthByYear, horizonISO: v.horizon,
        rentCfg: { monthlyRent: v.rent, rentGrowthPct: v.rentg, serviceChargePerYear: v.sc, maintenancePctOfValue: v.maint },
        opportunityRatePct: v.opp,
      });
      const M = res.monthly, T = res.terminal, own = T.advantageOwn >= 0;
      const hl = (RB_HORIZONS.find((h) => h.date === v.horizon) || {}).label || v.horizon;
      return headline(own ? "Keep owning wins by" : "Sell & rent wins by", gbp(Math.abs(T.advantageOwn)), own ? "pos" : "neg",
        `Over ${hl}. Owning costs ~<strong>${gbp(M.ownEconomic)}/mo</strong> in economic terms vs <strong>${gbp(M.rent)}/mo</strong> rent.`) + `
        <table class="calc">
          ${rowT("Keep owning — net equity at horizon", gbp(T.equityAtH), "sale value " + gbp(T.saleValueH))}
          ${rowT("+ invested monthly savings", signed(T.surplusFV, gbp), "rent − own cash, compounded")}
          ${rowT("Wealth if you keep it", gbp(T.wealthOwn), "", "sub")}
          ${rowT("Sell now — net proceeds", gbp(res.sellNowNet))}
          ${rowT("Wealth if you sell & rent", gbp(T.wealthRent), "invested at " + pct(v.opp), "sub")}
          ${rowT("Difference", signed(T.advantageOwn, gbp), own ? "owning ahead" : "renting ahead", "total")}
        </table>
        <div class="table-wrap"><table class="rank-table kv">
          <thead><tr><th>Period</th><th>Rent</th><th>Own cash out</th><th>Rent − own</th></tr></thead>
          <tbody>${res.yearsTable.map((y) => { const d = y.rent - y.ownCash; return `<tr><td>${letPeriodLabel(y.label, y.months)}</td><td>${gbp(y.rent)}</td><td>${gbp(y.ownCash)}</td><td class="${d >= 0 ? "" : "neg-cell"}">${signed(d, gbp)}</td></tr>`; }).join("")}</tbody>
        </table></div>`;
    },
  },

  letting: {
    label: "Let it out vs sell now",
    desc: "Let the flat and sell later vs sell now and invest — with Section 24 income tax and the CGT you'd owe on a former home.",
    fields: () => [
      { id: "horizon", label: "Let until (then sell)", type: "select", options: LET_HORIZONS.map((h) => [h.date, h.label]), def: "2028-04-01" },
      { id: "rent", label: "Monthly rent (£)", type: "number", step: 25, def: Math.round(DATA.LETTING.monthlyRent * (state.rentFactor || 1) / 25) * 25 },
      { id: "band", label: "Your income tax band", type: "select", options: [["basic", "Basic (20%)"], ["higher", "Higher (40% → 42%)"], ["additional", "Additional (45% → 47%)"]], def: DATA.TAX.marginalBand },
      { id: "sc", label: "Service charge + ground rent (£/yr)", type: "number", step: 50, def: DATA.LETTING.serviceChargeGroundRentPerYear },
      { id: "opp", label: "Return on sale cash (%/yr)", type: "number", step: 0.25, def: DATA.LETTING.opportunityRatePct },
      { id: "self", label: "Self-manage (no agent fee)", type: "check", def: DATA.LETTING.selfManage },
      { id: "io", label: "Interest-only mortgage", type: "check", def: DATA.LETTING.interestOnly },
    ],
    run(r, v) {
      const letCfg = { ...DATA.LETTING, monthlyRent: v.rent, serviceChargeGroundRentPerYear: v.sc, selfManage: v.self, opportunityRatePct: v.opp, interestOnly: v.io };
      const mortgage = { ...r.inputs.mortgage, _purchaseDate: r.inputs.property.purchaseDate };
      const sellNowNet = r.windows.find((w) => w.window.id === "now").net;
      const res = rentVsSell({ property: r.inputs.property, mortgage, sellingCfg: r.inputs.sellingCfg,
        presentValue: r.presentValue, presentISO: DATA.META.asOf, growthByYear: r.growthByYear, saleDate: v.horizon,
        letCfg, TAX: { ...DATA.TAX, marginalBand: v.band }, sellNowNet });
      const wins = res.advantageLet >= 0;
      const hl = (LET_HORIZONS.find((h) => h.date === v.horizon) || {}).label || v.horizon;
      return headline(wins ? "Letting wins by" : "Selling now wins by", gbp(Math.abs(res.advantageLet)), wins ? "pos" : "neg",
        `Let until ${hl}, then sell — vs sell now and invest at ${pct(v.opp)}.`) + `
        <table class="calc">
          ${rowT("Net rent after costs, mortgage &amp; tax", signed(res.cumulativeNetRent, gbp))}
          ${rowT("Sale at horizon — net", gbp(res.sale.netSaleProceeds), "value " + gbp(res.sale.saleValue) + " · CGT " + gbp(res.sale.cgt))}
          ${rowT("Let & sell later", gbp(res.letTotal), "", "sub")}
          ${rowT("Sell now & invest", gbp(res.sellNowGrown), gbp(res.sellNowNet) + " today, CGT-exempt", "sub")}
          ${rowT("Difference", signed(res.advantageLet, gbp), "", "total")}
        </table>
        <div class="table-wrap"><table class="rank-table kv">
          <thead><tr><th>Period</th><th>Gross rent</th><th>Income tax</th><th>Net cash flow</th></tr></thead>
          <tbody>${res.yearsTable.map((y) => `<tr><td>${letPeriodLabel(y.label, y.months)}</td><td>${gbp(y.grossRent)}</td><td>${gbp(y.tax)}</td><td class="${y.netCashFlow >= 0 ? "" : "neg-cell"}">${gbp(y.netCashFlow)}</td></tr>`).join("")}</tbody>
        </table></div>
        <p class="disclaimer"><strong>Tax simplified</strong> — not advice; letting usually needs consent-to-let or a BTL mortgage. See <a href="https://www.gov.uk/renting-out-a-property/paying-tax" target="_blank" rel="noopener">GOV.UK: paying tax on rent</a>.</p>`;
    },
  },

  sdlt: {
    label: "Stamp Duty on a purchase",
    desc: "England & NI Stamp Duty Land Tax on your next purchase, band by band.",
    fields: () => [
      { id: "price", label: "Purchase price (£)", type: "number", step: 5000, def: 1000000 },
      { id: "kind", label: "Buyer", type: "select", options: [["standard", "Home mover (main residence)"], ["ftb", "First-time buyer"], ["additional", "Additional property (+5%)"]], def: "standard" },
    ],
    run(r, v) {
      const s = sdltBands(v.price, v.kind);
      return headline("Stamp Duty", gbp(s.total), "",
        `Effective rate <strong>${v.price ? (s.total / v.price * 100).toFixed(2) : "0.00"}%</strong> on ${gbp(v.price)}.${v.kind === "ftb" && v.price > 500000 ? " First-time buyer relief doesn't apply above £500k, so standard rates are used." : ""}`) + `
        <div class="table-wrap"><table class="rank-table kv">
          <thead><tr><th>Band</th><th>Rate</th><th>Tax</th></tr></thead>
          <tbody>${s.rows.map((b) => `<tr><td>${gbp(b.from)} – ${gbp(b.to)}</td><td>${(b.rate * 100).toFixed(0)}%</td><td>${gbp(b.tax)}</td></tr>`).join("")}</tbody>
        </table></div>
        <p class="muted small">Rates from 1 April 2025. Check with <a href="https://www.tax.service.gov.uk/calculate-stamp-duty-land-tax/" target="_blank" rel="noopener">HMRC's SDLT calculator</a>.</p>`;
    },
  },
};

// Current value of each field: stored param, else its default ("auto" fields stay blank).
function calcValues(r) {
  const c = CALCS[state.calc.type], stored = state.calc.params[state.calc.type] || {}, out = {};
  for (const f of c.fields(r)) {
    const s = stored[f.id];
    if (f.type === "number") out[f.id] = s === undefined || s === "" ? (f.auto ? null : f.def) : num(s, f.def);
    else if (f.type === "check") out[f.id] = s === undefined ? !!f.def : !!s;
    else out[f.id] = s === undefined || s === "" ? f.def : s;
  }
  return out;
}

function buildCalc(r) {
  const sel = $("#calc-type");
  sel.innerHTML = Object.entries(CALCS).map(([k, c]) => `<option value="${k}" ${k === state.calc.type ? "selected" : ""}>${c.label}</option>`).join("");
  if (!sel._wired) {
    sel._wired = true;
    sel.addEventListener("change", (e) => { state.calc.type = e.target.value; saveCalc(); buildCalc(runModel(effectiveData(), currentOverrides())); });
  }
  const c = CALCS[state.calc.type], v = calcValues(r);
  $("#calc-desc").textContent = c.desc;
  const fieldHtml = (f) => {
    if (f.type === "check") return `<label class="ctrl ctrl-check"><input data-f="${f.id}" type="checkbox" ${v[f.id] ? "checked" : ""}><span>${f.label}</span></label>`;
    if (f.type === "select") return `<label class="ctrl"><span>${f.label}</span><select data-f="${f.id}">${f.options.map(([val, lbl]) => `<option value="${val}" ${val === v[f.id] ? "selected" : ""}>${lbl}</option>`).join("")}</select></label>`;
    const val = v[f.id] == null ? "" : v[f.id];
    return `<label class="ctrl"><span>${f.label}</span><input data-f="${f.id}" type="${f.type}" ${f.step ? `step="${f.step}"` : ""} value="${val}" ${f.hint ? `placeholder="${f.hint}"` : ""}></label>`;
  };
  $("#calc-fields").innerHTML = `<div class="controls-grid">${c.fields(r).map(fieldHtml).join("")}
    <button id="calc-reset" class="btn-reset" type="button">Reset to defaults</button></div>`;
  $("#calc-fields").querySelectorAll("[data-f]").forEach((el) => {
    const ev = el.type === "checkbox" || el.tagName === "SELECT" || el.type === "month" ? "change" : "input";
    el.addEventListener(ev, () => {
      const P = (state.calc.params[state.calc.type] = state.calc.params[state.calc.type] || {});
      P[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value;
      saveCalc();
      scheduleCalc();
    });
  });
  $("#calc-reset").addEventListener("click", () => { delete state.calc.params[state.calc.type]; saveCalc(); buildCalc(runModel(effectiveData(), currentOverrides())); });
  renderCalc(r);
}

function renderCalc(r) {
  const host = $("#calc-out");
  if (!host) return;
  host.classList.remove("loading");
  try { host.innerHTML = CALCS[state.calc.type].run(r, calcValues(r)); }
  catch (err) { host.innerHTML = `<p class="muted">Couldn't calculate with these inputs (${err.message}).</p>`; }
  const fs = $("#figs-sum");
  if (fs) {
    const p = r.inputs.property, m = r.inputs.mortgage;
    fs.textContent = `${gbp(p.purchasePrice)} · ${monthName(p.purchaseDate)} · ${gbp(m.principal)} at ${pct(m.ratePct)} to ${monthName(m.fixEndDate)}`;
  }
}
const scheduleCalc = debounceRAF(() => renderCalc(runModel(effectiveData(), currentOverrides())));

function letPeriodLabel(startISO, months) {
  const endISO = ymToISO(ymIndex(startISO) + months - 1);
  return monthName(startISO) + " – " + monthName(endISO) + (months < 12 ? ` · ${months} mo` : "");
}

// ---------------------------------------------------------------------------
// Your figures — shared by every calculation, saved to the browser
// ---------------------------------------------------------------------------
function buildInputs() {
  const i = state.inputs;
  const host = $("#inputs-body");
  host.classList.remove("loading");
  const fld = (id, label, type, value, attrs = "") =>
    `<label class="ctrl"><span>${label}</span><input id="${id}" type="${type}" value="${value}" ${attrs}></label>`;
  const deposit = num(i.purchasePrice) - num(i.mortgageAmount);

  host.innerHTML = `
    <div class="input-group"><h3 class="panel-h">Property &amp; purchase</h3>
      <div class="controls-grid">
        ${fld("in-price", "Purchase price (£)", "number", i.purchasePrice, 'min="0" step="1000"')}
        ${fld("in-pdate", "Purchase date", "month", i.purchaseDate)}
        ${fld("in-area", "Internal floor area (m²)", "number", i.floorAreaSqm, 'min="10" step="0.01"')}
        ${fld("in-permsqm", "Comparable sold price (£/m²)", "number", i.perSqmMedian, 'min="1000" step="50"')}
        ${fld("in-sdlt", "Stamp Duty paid (£)", "number", i.sdlt, 'min="0" step="100"')}
        ${fld("in-buycosts", "Other buying costs (£)", "number", i.otherBuyCosts, 'min="0" step="50"')}
        <label class="ctrl ctrl-check"><input id="in-primary" type="checkbox" ${i.isPrimaryResidence ? "checked" : ""}>
          <span>Main residence (CGT-exempt)</span></label>
      </div>
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
        ${fld("in-remo-fix", "Next fix length (years)", "number", i.remortgageFixYears, 'min="0" max="10" step="1"')}
        ${fld("in-remo-erc", "Next fix ERC (% of balance)", "number", i.remortgageErcPct, 'min="0" max="10" step="0.1"')}
      </div>
      <p class="muted small">Deposit: <strong id="in-deposit">${gbp(deposit)}</strong> (price − borrowed). The rate after the fix is set on the Forecast tab.</p>
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
      <span class="muted small">Saved in this browser only.</span>
    </div>`;

  const bind = (sel, key, ev, parse) => $(sel).addEventListener(ev, (e) => {
    state.inputs[key] = parse(e.target);
    saveInputs();
    const dep = $("#in-deposit"); if (dep) dep.textContent = gbp(num(state.inputs.purchasePrice) - num(state.inputs.mortgageAmount));
    scheduleRefresh();
  });
  const valNum = (t) => num(t.value);
  const valStr = (t) => t.value;
  bind("#in-price", "purchasePrice", "input", valNum);
  bind("#in-pdate", "purchaseDate", "change", valStr);
  bind("#in-primary", "isPrimaryResidence", "change", (t) => t.checked);
  bind("#in-sdlt", "sdlt", "input", valNum);
  bind("#in-buycosts", "otherBuyCosts", "input", valNum);
  bind("#in-area", "floorAreaSqm", "input", valNum);
  bind("#in-permsqm", "perSqmMedian", "input", valNum);
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
    state.inputs = defaultInputs(); saveInputs(); buildInputs(); scheduleRefresh();
  });
}

document.addEventListener("DOMContentLoaded", boot);
