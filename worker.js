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
//   • The upstream fetch is time-boxed (4s) and falls back to the snapshot
//     constants below, so a slow/blocked source never stalls the response.
//   • Responses are cached at the edge for 6 hours (Bank Rate changes ~8×/yr).
// =============================================================================

// Snapshot fallback — keep roughly in step with dataset.js RATES.
const FALLBACK = {
  baseRateNow: 3.75,
  baseRateAsOf: "2026-06-17",
  swap2yrNow: 4.06,
  swap2yrAsOf: "2026-06-26",
  remortgage70Now: 5.02,
  remortgage70AsOf: "2026-06",
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
    // HTML must revalidate every load so a new deploy's ?v= module references are
    // picked up immediately. (Cloudflare's [assets] binding ignores the Pages-only
    // _headers file, so we set this here.) Versioned JS/CSS/SVG can cache normally.
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      const h = new Headers(res.headers);
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

    const latest = parseSeries(await r.text()); // { CODE: {date, value} }
    const out = { ...FALLBACK, live: false, source: "Bank of England IADB", fetchedAt: now.toISOString() };

    const base = latest[SERIES.base];
    if (base) { out.baseRateNow = base.value; out.baseRateAsOf = base.date; out.live = true; }

    const v60 = latest[SERIES.ltv60], v75 = latest[SERIES.ltv75];
    if (v60 && v75) {
      // linear interpolation 60→75% LTV, evaluated at 70%
      out.remortgage70Now = round2(v60.value + ((70 - 60) / (75 - 60)) * (v75.value - v60.value));
      out.remortgage70AsOf = (v75.date > v60.date ? v75.date : v60.date);
      out.remortgageLive = true;
    } else if (v75 || v60) {
      const one = v75 || v60;
      out.remortgage70Now = one.value;
      out.remortgage70AsOf = one.date;
      out.remortgageLive = true;
    }
    return out;
  } catch (err) {
    return { ...FALLBACK, live: false, error: String((err && err.message) || err), fetchedAt: now.toISOString() };
  }
}

const round2 = (x) => Math.round(x * 100) / 100;

// Parse a BoE multi-series CSV. Header: "DATE,CODE1,CODE2,…"; each row a date and
// (sparsely populated) values. Returns the most recent {date,value} per column.
function parseSeries(csv) {
  const lines = csv.split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
  if (!lines.length) return {};
  const header = lines[0].map((h) => h.toUpperCase());
  const latest = {};
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    const date = row[0];
    if (!date) continue;
    for (let c = 1; c < header.length; c++) {
      const code = header[c];
      const v = parseFloat(row[c]);
      if (Number.isFinite(v)) latest[code] = { date, value: v }; // last wins = most recent
    }
  }
  return latest;
}
