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
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=21600", // 6h
  "access-control-allow-origin": "*",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/rates") return handleRates(request, ctx);
    // everything else → static assets
    if (env && env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};

async function handleRates(request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/rates", request.url).toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const data = await fetchBankRate();
  const resp = new Response(JSON.stringify(data), { headers: JSON_HEADERS });
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

// Pull the latest Bank Rate from the Bank of England's Interactive Database
// (series IUDBEDR) as CSV. Defensive: any failure returns the snapshot fallback.
async function fetchBankRate() {
  try {
    const now = new Date();
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][now.getUTCMonth()];
    const yyyy = now.getUTCFullYear();
    const dateTo = `${dd}/${mon}/${yyyy}`;
    const endpoint =
      "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp" +
      "?csv.x=yes&Datefrom=01/Jan/2024&Dateto=" + encodeURIComponent(dateTo) +
      "&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N";

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(endpoint, {
      signal: ctl.signal,
      headers: { accept: "text/csv,*/*" },
      cf: { cacheTtl: 21600, cacheEverything: true },
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error("HTTP " + r.status);

    const csv = await r.text();
    // Rows look like:  DD Mon YYYY,<rate>  — keep only those with a numeric value,
    // and take the last (most recent) one. Robust to header-line variations.
    const parsed = csv.split(/\r?\n/)
      .map((line) => line.split(","))
      .map((cols) => ({ date: (cols[0] || "").trim().replace(/^"|"$/g, ""), rate: parseFloat((cols[1] || "").trim()) }))
      .filter((row) => row.date && Number.isFinite(row.rate));
    if (!parsed.length) throw new Error("no data rows");

    const latest = parsed[parsed.length - 1];
    return {
      ...FALLBACK,
      baseRateNow: latest.rate,
      baseRateAsOf: latest.date,
      live: true,
      source: "Bank of England IADB (series IUDBEDR)",
      fetchedAt: now.toISOString(),
    };
  } catch (err) {
    return { ...FALLBACK, live: false, error: String((err && err.message) || err) };
  }
}
