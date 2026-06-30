// =============================================================================
// functions/api/boe-rate.js  —  Cloudflare Pages Function
// -----------------------------------------------------------------------------
// Returns the latest Bank of England Bank Rate as JSON: { rate, date, source }.
// Fetches the official BoE Interactive Database CSV (series IUDBEDR) server-side,
// so the browser avoids CORS. Falls back to a hardcoded snapshot if the upstream
// is unreachable. Cached at the edge for 6 hours.
// =============================================================================

const SERIES = "IUDBEDR"; // BoE official Bank Rate, daily
const FALLBACK = { rate: 3.75, date: "2026-06-17", source: "snapshot (fallback)" };
const CACHE_SECONDS = 6 * 60 * 60;

export async function onRequest(context) {
  const { request } = context;
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + "/api/boe-rate", request);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let payload = FALLBACK;
  try {
    const today = new Date();
    const from = "01/Jan/2024";
    const to = `${String(today.getUTCDate()).padStart(2, "0")}/${today.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}/${today.getUTCFullYear()}`;
    const url =
      "https://www.bankofengland.co.uk/boeapps/database/fromshowcolumns.asp" +
      "?csv.x=yes&Datefrom=" + encodeURIComponent(from) +
      "&Dateto=" + encodeURIComponent(to) +
      "&SeriesCodes=" + SERIES +
      "&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N";

    const res = await fetch(url, {
      headers: { "User-Agent": "london-flat-dashboard/1.0", accept: "text/csv,*/*" },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
    if (res.ok) {
      const csv = await res.text();
      const parsed = parseLatest(csv);
      if (parsed) payload = { ...parsed, source: "Bank of England (IUDBEDR)" };
    }
  } catch (_) {
    // keep fallback
  }

  const body = JSON.stringify(payload);
  const response = new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
    },
  });
  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// CSV is: "Title row...\nDD Mon YYYY,rate\n..." — take the last data row.
function parseLatest(csv) {
  const lines = csv.trim().split(/\r?\n/).filter((l) => l.trim().length);
  for (let i = lines.length - 1; i >= 1; i--) {
    const cols = lines[i].split(",");
    if (cols.length < 2) continue;
    const rawDate = cols[0].replace(/"/g, "").trim();
    const rate = parseFloat(cols[cols.length - 1].replace(/"/g, "").trim());
    if (!isNaN(rate) && rawDate) {
      const d = new Date(rawDate);
      const iso = isNaN(d.getTime()) ? rawDate : d.toISOString().slice(0, 10);
      return { rate, date: iso };
    }
  }
  return null;
}
