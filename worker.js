// =============================================================================
// worker.js — Cloudflare Worker entry for the Flat Forecaster
// -----------------------------------------------------------------------------
// The site is 99% static assets (served by the [assets] binding). This Worker
// adds ONE small dynamic route — GET /api/rates — that fetches the live Bank of
// England Bank Rate so the dashboard's "as of" data can refresh itself, while
// every other request is served straight from the static assets.
//
// Design notes:
//   • The page renders fully from the curated snapshot in dataset.js FIRST and
//     only upgrades the rate badges if /api/rates resolves — so if this Worker
//     isn't deployed (pure static hosting), nothing breaks and nothing hangs.
//   • The upstream fetch is time-boxed (4.5s) and falls back to the snapshot
//     constants below, so a slow/blocked source never stalls the response.
//   • Responses are cached at the edge for 6 hours (Bank Rate changes ~8×/yr).
// =============================================================================

// Snapshot fallback — keep roughly in step with dataset.js RATES.
const FALLBACK = {
  baseRateNow: 3.75,
  baseRateAsOf: "2026-07-30",
  baseRatePrev: 3.75,
  swap2yrNow: 4.08,
  swap2yrAsOf: "2026-08-05",
  swap2yrPrev: 4.15,
  remortgage70Now: 4.75,
  remortgage70AsOf: "2026-07",
  remortgage70Prev: 4.79,
};

// Bank of England Interactive Database (IADB) series we pull, all in one request:
//   IUDBEDR — official Bank Rate (updates on MPC decisions)
//   IUMBV37 — quoted 2-year fixed mortgage, 60% LTV (monthly)
//   IUMBV34 — quoted 2-year fixed mortgage, 75% LTV (monthly)
// The 70% LTV remortgage rate is linearly interpolated between the 60% and 75%
// series. If a series returns nothing, we fall back to the snapshot for it.
const SERIES = { base: "IUDBEDR", ltv60: "IUMBV37", ltv75: "IUMBV34" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=21600", // 6h
  "access-control-allow-origin": "*",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/rates") return handleRates(request, ctx);
    if (!env || !env.ASSETS) return new Response("Not found", { status: 404 });

    const res = await env.ASSETS.fetch(request);
    // Never serve a stale HTML/CSS/JS after a deploy — this is what bites iOS
    // "Add to Home Screen" web apps, which pin old files hard. `no-cache` lets the
    // browser keep the file but forces it to revalidate with the origin on every
    // load; paired with the ETag the assets binding sets automatically, the common
    // case is a cheap 304 (no re-download). This is automatic — it does NOT depend
    // on manual ?v= query bumps. Images, fonts, SVG and the manifest keep their
    // default caching. (Cloudflare's [assets] binding ignores the Pages-only
    // _headers file, so we set this here.)
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const mustRevalidate =
      ct.includes("text/html") || ct.includes("text/css") || ct.includes("javascript");
    if (mustRevalidate) {
      const h = new Headers(res.headers); // preserves the ETag for 304s
      h.set("Cache-Control", "no-cache, must-revalidate");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }
    return res;
  },
};

async function handleRates(request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/rates", request.url).toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const data = await fetchRates();
  const resp = new Response(JSON.stringify(data), { headers: JSON_HEADERS });
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

// Fetch the Bank Rate + quoted 2yr mortgage rates (60% & 75% LTV) from the BoE
// IADB in a single multi-series CSV request; interpolate the 70% LTV remortgage
// rate. Defensive: any missing series falls back to its snapshot value.
async function fetchRates() {
  const now = new Date();
  try {
    const dateTo = `${String(now.getUTCDate()).padStart(2, "0")}/${MON[now.getUTCMonth()]}/${now.getUTCFullYear()}`;
    const yISO = isoOf(new Date(now.getTime() - 86400000)); // yesterday (UTC)
    const codes = [SERIES.base, SERIES.ltv60, SERIES.ltv75].join(",");
    const endpoint =
      "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp" +
      "?csv.x=yes&Datefrom=01/Jan/2024&Dateto=" + encodeURIComponent(dateTo) +
      "&SeriesCodes=" + codes + "&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N";

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4500);
    const r = await fetch(endpoint, {
      signal: ctl.signal, headers: { accept: "text/csv,*/*" },
      cf: { cacheTtl: 21600, cacheEverything: true },
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error("HTTP " + r.status);

    // { CODE: {date, value, prev} } where prev = value effective yesterday
    const s = parseSeries(await r.text(), yISO);
    const out = { ...FALLBACK, live: false, source: "Bank of England IADB", fetchedAt: now.toISOString() };

    const base = s[SERIES.base];
    if (base) {
      out.baseRateNow = base.value; out.baseRateAsOf = base.date; out.live = true;
      if (base.prev != null) out.baseRatePrev = base.prev;
    }

    const v60 = s[SERIES.ltv60], v75 = s[SERIES.ltv75];
    const interp = (a, b) => round2(a + ((70 - 60) / (75 - 60)) * (b - a));
    if (v60 && v75) {
      out.remortgage70Now = interp(v60.value, v75.value);
      out.remortgage70AsOf = (v75.date > v60.date ? v75.date : v60.date);
      out.remortgageLive = true;
      if (v60.prev != null && v75.prev != null) out.remortgage70Prev = interp(v60.prev, v75.prev);
    } else if (v75 || v60) {
      const one = v75 || v60;
      out.remortgage70Now = one.value; out.remortgage70AsOf = one.date; out.remortgageLive = true;
      if (one.prev != null) out.remortgage70Prev = one.prev;
    }
    return out;
  } catch (err) {
    return { ...FALLBACK, live: false, error: String((err && err.message) || err), fetchedAt: now.toISOString() };
  }
}

const round2 = (x) => Math.round(x * 100) / 100;
const isoOf = (d) => d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
// "17 Jun 2026" -> "2026-06-17" (for date comparison); "" if unparseable.
function boeISO(s) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec((s || "").trim());
  if (!m) return "";
  const mi = MON.indexOf(m[2]);
  return mi < 0 ? "" : m[3] + "-" + String(mi + 1).padStart(2, "0") + "-" + m[1].padStart(2, "0");
}

// Parse a BoE multi-series CSV. Header: "DATE,CODE1,CODE2,…". Returns, per column,
// the latest {date, value} and `prev` = the value effective on `yesterdayISO`
// (the last point dated on/before yesterday) — for a day-over-day comparison.
function parseSeries(csv, yesterdayISO) {
  const lines = csv.split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
  if (!lines.length) return {};
  const header = lines[0].map((h) => h.toUpperCase());
  const points = {}; // code -> [{iso, value, date}] in file (chronological) order
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    const date = row[0];
    if (!date) continue;
    const iso = boeISO(date);
    for (let c = 1; c < header.length; c++) {
      const code = header[c];
      const v = parseFloat(row[c]);
      if (Number.isFinite(v)) (points[code] = points[code] || []).push({ iso, value: v, date });
    }
  }
  const out = {};
  for (const code in points) {
    const arr = points[code];
    const latest = arr[arr.length - 1];
    let prev = null;
    for (let k = arr.length - 1; k >= 0; k--) {
      if (!arr[k].iso || arr[k].iso <= yesterdayISO) { prev = arr[k].value; break; }
    }
    out[code] = { date: latest.date, value: latest.value, prev };
  }
  return out;
}
