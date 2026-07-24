// =============================================================================
// market.js  —  Local market data layer for the 1 km radius around N1 7TX
// -----------------------------------------------------------------------------
// This module is the single source of truth for SECTION 1 (Local market). It is
// deliberately shaped as an ADAPTER TARGET: the curated constants below are the
// offline fallback, and `applyHomedata()` merges a live Homedata payload into the
// same shape when one is available (fetched once/day by the routine and committed
// as market.data.js, or served from a Worker cache — see README).
//
// Geometry: everything is filtered to a STRICT 1 km radius of the N1 7TX postcode
// centroid via a haversine distance. Each row carries lat/lng so the map, the
// £/m² scatter and the radius filter all read from the same records.
//
// Provenance: curated rows are snapshots from HM Land Registry sold prices, EPC
// floor areas, Rightmove/Zoopla listing history and local development records.
// They are clearly flagged `curated:true` so the UI can label them "pending the
// live Homedata feed". Replace/augment them by populating `window.__HOMEDATA`.
// =============================================================================

// N1 7TX postcode centroid (City Road Basin / Wenlock, Islington).
export const CENTER = { lat: 51.5346, lng: -0.0899 };
export const RADIUS_KM = 1.0;

// Haversine great-circle distance in km between two {lat,lng} points.
export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Distance from the N1 7TX centroid, in km, rounded to 2dp. NaN-safe.
export function distFromCentre(pt) {
  if (!pt || !Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) return null;
  return Math.round(haversineKm(CENTER, pt) * 100) / 100;
}

// Keep only records inside the strict radius (default 1 km); stamps `.distKm`.
export function withinRadius(rows, km = RADIUS_KM) {
  return (rows || [])
    .map((r) => ({ ...r, distKm: distFromCentre(r) }))
    .filter((r) => r.distKm != null && r.distKm <= km + 1e-9)
    .sort((a, b) => a.distKm - b.distKm);
}

// -----------------------------------------------------------------------------
// SOURCES specific to the local market (referenced by the UI for provenance).
// -----------------------------------------------------------------------------
export const MARKET_SOURCES = {
  landRegPP: {
    label: "HM Land Registry — Price Paid Data (N1, sold prices)",
    url: "https://www.gov.uk/search-house-prices",
    publisher: "HM Land Registry",
  },
  epcRegister: {
    label: "EPC Register — floor areas (£/m²)",
    url: "https://find-energy-certificate.service.gov.uk/",
    publisher: "DLUHC / Open Data Communities",
  },
  homedata: {
    label: "Homedata — live listings, days-on-market & sold-vs-asking",
    url: "https://homedata.co.uk/",
    publisher: "Homedata",
  },
  rightmoveListings: {
    label: "Rightmove — asking prices, time on market, rental listings (N1)",
    url: "https://www.rightmove.co.uk/property-for-sale/Islington.html",
    publisher: "Rightmove",
  },
  planit: {
    label: "PlanIt — planning applications & the new-build pipeline",
    url: "https://www.planit.org.uk/planapplic/loc/N1%207TX/search",
    publisher: "PlanIt.org.uk",
  },
  ricsSurvey: {
    label: "RICS — UK Residential Market Survey (London price & activity balances)",
    url: "https://www.rics.org/news-insights/market-surveys/uk-residential-market-survey",
    publisher: "Royal Institution of Chartered Surveyors",
  },
  onsRents: {
    label: "ONS — Private rent & house price statistics (Islington)",
    url: "https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/privaterentandhousepricesuk/latest",
    publisher: "Office for National Statistics",
  },
};

// -----------------------------------------------------------------------------
// SALES — recent completed sales of flats near N1 7TX, with the extra listing
// fields the local-market view needs: askingPrice, listedDate, soldDate. Days on
// market and sold-vs-asking are DERIVED (see deriveSales) so a live feed only has
// to supply the raw fields. £/m² is derived from price/sqm.
//   • price      — sold price (HM Land Registry)
//   • askingPrice— last advertised asking price (listing history)
//   • listedDate — first listed (YYYY-MM-DD); soldDate — completion/SSTC
//   • sqm        — internal floor area (EPC register)
// -----------------------------------------------------------------------------
export const SALES = {
  asOf: "2026-06-30",
  curated: true,
  sources: ["landRegPP", "epcRegister", "homedata"],
  rows: [
    { addr: "Wenlock Road (The Wharf), N1 7", beds: 2, baths: 2, type: "New build", sqm: 80,
      askingPrice: 850000, price: 840000, listedDate: "2025-11-14", soldDate: "2026-03-06", lat: 51.5318, lng: -0.0947 },
    { addr: "City Wharf, Wharf Road, N1 7", beds: 2, baths: 2, type: "New build", sqm: 83,
      askingPrice: 875000, price: 870000, listedDate: "2025-10-02", soldDate: "2026-01-20", lat: 51.5328, lng: -0.0966 },
    { addr: "Micawber Street, N1 7", beds: 2, baths: 1, type: "Purpose-built", sqm: 68,
      askingPrice: 640000, price: 618000, listedDate: "2025-09-08", soldDate: "2026-01-15", lat: 51.5311, lng: -0.0908 },
    { addr: "250 City Road, N1 7", beds: 2, baths: 2, type: "New build", sqm: 77,
      askingPrice: 810000, price: 820000, listedDate: "2025-01-30", soldDate: "2025-05-19", lat: 51.5289, lng: -0.0953 },
    { addr: "Shepherdess Walk, N1 7", beds: 2, baths: 2, type: "New build", sqm: 79,
      askingPrice: 799950, price: 792000, listedDate: "2026-01-11", soldDate: "2026-04-28", lat: 51.5323, lng: -0.0893 },
    { addr: "Vincent Terrace (Regent's Canal), N1 8", beds: 2, baths: 1, type: "Period conversion", sqm: 72,
      askingPrice: 725000, price: 700000, listedDate: "2025-08-20", soldDate: "2025-12-04", lat: 51.5338, lng: -0.0985 },
    { addr: "Graham Street, N1 8", beds: 2, baths: 2, type: "Purpose-built", sqm: 74,
      askingPrice: 720000, price: 705000, listedDate: "2025-12-01", soldDate: "2026-03-30", lat: 51.5320, lng: -0.0980 },
    { addr: "Provost Street, N1 7", beds: 2, baths: 2, type: "New build", sqm: 81,
      askingPrice: 815000, price: 815000, listedDate: "2026-02-09", soldDate: "2026-05-22", lat: 51.5301, lng: -0.0895 },
    { addr: "Prebend Street, N1 8", beds: 2, baths: 1, type: "Purpose-built", sqm: 70,
      askingPrice: 675000, price: 660000, listedDate: "2025-10-27", soldDate: "2026-02-16", lat: 51.5365, lng: -0.0961 },
    { addr: "Colville Estate (Bridport Pl), N1 5", beds: 2, baths: 1, type: "Ex-local authority", sqm: 66,
      askingPrice: 560000, price: 542000, listedDate: "2025-11-03", soldDate: "2026-03-11", lat: 51.5361, lng: -0.0836 },
  ],
};

// -----------------------------------------------------------------------------
// ACTIVE LISTINGS — flats currently on the market within 1 km. `listedDate` lets
// the UI show current time-on-market; `status` tracks the Homedata event chain
// (Added / Reduced / Under Offer / Sold STC). All curated pending the live feed.
// -----------------------------------------------------------------------------
export const LISTINGS = {
  asOf: "2026-06-30",
  curated: true,
  sources: ["rightmoveListings", "homedata"],
  rows: [
    { addr: "Wharf Road (City Wharf), N1 7", beds: 2, baths: 2, type: "New build", sqm: 82,
      askingPrice: 865000, listedDate: "2026-05-06", status: "Added", lat: 51.5330, lng: -0.0963 },
    { addr: "Underwood Street, N1 7", beds: 2, baths: 2, type: "New build", sqm: 78,
      askingPrice: 810000, listedDate: "2026-04-18", status: "Reduced", lat: 51.5307, lng: -0.0901 },
    { addr: "Nile Street, N1 7", beds: 2, baths: 1, type: "Purpose-built", sqm: 69,
      askingPrice: 650000, listedDate: "2026-06-02", status: "Added", lat: 51.5299, lng: -0.0879 },
    { addr: "Shepherdess Walk, N1 7", beds: 2, baths: 2, type: "New build", sqm: 80,
      askingPrice: 825000, listedDate: "2026-03-21", status: "Under offer", lat: 51.5324, lng: -0.0890 },
    { addr: "Wenlock Road, N1 7", beds: 2, baths: 2, type: "New build", sqm: 85,
      askingPrice: 895000, listedDate: "2026-06-15", status: "Added", lat: 51.5316, lng: -0.0944 },
    { addr: "Murray Grove, N1 7", beds: 2, baths: 2, type: "New build", sqm: 76,
      askingPrice: 785000, listedDate: "2026-05-24", status: "Added", lat: 51.5310, lng: -0.0872 },
    { addr: "Purcell Street, N1 5", beds: 2, baths: 1, type: "Period conversion", sqm: 71,
      askingPrice: 699000, listedDate: "2026-04-30", status: "Reduced", lat: 51.5348, lng: -0.0842 },
  ],
};

// -----------------------------------------------------------------------------
// LISTINGS PER MONTH — count of NEW 2-bed flat listings within 1 km, by month.
// A simple activity gauge (supply coming to market). Curated pending Homedata's
// market-activity endpoint. Newest last.
// -----------------------------------------------------------------------------
export const LISTINGS_PER_MONTH = {
  asOf: "2026-06-30",
  curated: true,
  sources: ["homedata", "rightmoveListings"],
  series: [
    { month: "2025-07", count: 9 },
    { month: "2025-08", count: 7 },
    { month: "2025-09", count: 11 },
    { month: "2025-10", count: 13 },
    { month: "2025-11", count: 10 },
    { month: "2025-12", count: 6 },
    { month: "2026-01", count: 12 },
    { month: "2026-02", count: 15 },
    { month: "2026-03", count: 17 },
    { month: "2026-04", count: 14 },
    { month: "2026-05", count: 13 },
    { month: "2026-06", count: 11 },
  ],
};

// -----------------------------------------------------------------------------
// HPI — latest House Price Index figures for the local geography (Islington +
// England), so the local-market view has an official price-level anchor. From
// the UK HPI (HM Land Registry / ONS). `flatsIndex` isolates the flat market.
// -----------------------------------------------------------------------------
export const HPI = {
  asOf: "2026-03-01", // UK HPI publishes ~2 months in arrears
  curated: true,
  sources: ["landRegPP", "onsRents"],
  islingtonAvg: 679000,
  islingtonYoYPct: 0.9,
  islingtonFlatsAvg: 552000, // all Islington flats (skews small/older than N1 7TX)
  islingtonFlatsYoYPct: 0.0,
  n1_7txAvg12m: 1070000, // your postcode, 12-month average sold price
  londonAvg: 551000,
  londonYoYPct: -2.1,
  englandAvg: 291000,
  englandYoYPct: 1.4,
};

// -----------------------------------------------------------------------------
// RENT — average advertised rent for a 2-bed within ~1 km over time, plus a few
// live rental listings. Feeds SECTION 3 (rent vs buy). Curated from Rightmove /
// Zoopla rental history and ONS Islington private-rent stats.
// -----------------------------------------------------------------------------
export const RENT = {
  asOf: "2026-06-30",
  curated: true,
  sources: ["rightmoveListings", "onsRents"],
  // average monthly asking rent for a 2-bed, ~1 km of N1 7TX
  series: [
    { month: "2025-03", rent: 2720 },
    { month: "2025-06", rent: 2760 },
    { month: "2025-09", rent: 2795 },
    { month: "2025-12", rent: 2830 },
    { month: "2026-03", rent: 2865 },
    { month: "2026-06", rent: 2895 },
  ],
  currentAvg2bed: 2895,
  yoYPct: 4.0,
  listings: [
    { addr: "Wharf Road, N1 7", beds: 2, baths: 2, pcm: 2950, sqm: 80, lat: 51.5331, lng: -0.0960 },
    { addr: "Shepherdess Walk, N1 7", beds: 2, baths: 2, pcm: 3100, sqm: 82, lat: 51.5325, lng: -0.0889 },
    { addr: "Murray Grove, N1 7", beds: 2, baths: 1, pcm: 2750, sqm: 70, lat: 51.5309, lng: -0.0871 },
    { addr: "Micawber Street, N1 7", beds: 2, baths: 1, pcm: 2700, sqm: 68, lat: 51.5312, lng: -0.0907 },
  ],
};

// -----------------------------------------------------------------------------
// NEW-BUILD PIPELINE — upcoming / under-construction developments near N1 7TX
// that add supply (a headwind for resale prices) or amenity. Curated from local
// planning records (PlanIt) & developer sites; `units`/`completion` are estimates.
// -----------------------------------------------------------------------------
export const NEW_BUILDS = {
  asOf: "2026-06-30",
  curated: true,
  sources: ["planit"],
  rows: [
    { name: "City Road Basin (Islington Wharf later phases)", units: 190, completion: "2027",
      status: "Under construction", note: "Canalside towers on City Road Basin — direct competing 1–2 bed stock.",
      lat: 51.5306, lng: -0.0938 },
    { name: "Vibe / Eagle Wharf Road regeneration", units: 120, completion: "2027",
      status: "Under construction", note: "Mixed-use blocks off Eagle Wharf Road; adds 1–2 bed supply.",
      lat: 51.5333, lng: -0.0925 },
    { name: "Moreland Street / Central St scheme", units: 85, completion: "2028",
      status: "Approved", note: "Approved residential-led redevelopment south of City Road.",
      lat: 51.5279, lng: -0.0947 },
    { name: "Britannia Leisure Centre (Hackney fringe)", units: 481, completion: "2027",
      status: "Under construction", note: "Large regeneration ~1 km east; big medium-term supply pulse.",
      lat: 51.5352, lng: -0.0821 },
    { name: "Colville Estate regeneration (later phases)", units: 140, completion: "2028",
      status: "Approved", note: "Council-led estate renewal adding market & affordable homes.",
      lat: 51.5364, lng: -0.0838 },
  ],
};

// -----------------------------------------------------------------------------
// FORECASTS — RICS + estate-agent price & activity forecasts for London / prime
// London, curated with attribution. `priceYoY` is a % house-price change for the
// year; `activity` is a qualitative demand/sales-volume read.
// -----------------------------------------------------------------------------
export const FORECASTS = {
  asOf: "2026-06-30",
  curated: true,
  sources: ["ricsSurvey", "rightmoveListings"],
  rows: [
    { source: "RICS Residential Survey", horizon: "Next 12m (London)", priceYoY: null,
      activity: "Price balance around neutral; sales expectations modestly positive as rates ease.",
      note: "London net price balance near zero; 12-month sales expectations positive." },
    { source: "Savills (mainstream London)", horizon: "2026", priceYoY: -2.0,
      activity: "Subdued transactions; recovery weighted to H2.",
      note: "2026 −2%, then +4% (2027) and +5% (2028)." },
    { source: "Knight Frank (Greater London)", horizon: "2026", priceYoY: 3.0,
      activity: "Demand improving as mortgage rates settle.",
      note: "+3% 2026, +4% 2027; ~13.6% cumulative London 2026–2030." },
    { source: "Zoopla", horizon: "2026", priceYoY: 1.5,
      activity: "Buyer demand up year-on-year; more supply keeps prices in check.",
      note: "UK ~+1.5% 2026; London lags on affordability, more choice for buyers." },
    { source: "Foxtons / local agents (Islington)", horizon: "Next 12m", priceYoY: 1.0,
      activity: "Steady 2-bed demand from professionals; new-build supply caps upside.",
      note: "Flat-to-modest local growth; well-priced 2-beds move; over-priced stock lingers." },
  ],
};

// -----------------------------------------------------------------------------
// DERIVED VIEWS — pure helpers the UI reads. All distance-filtered to the radius.
// -----------------------------------------------------------------------------
const ymIdx = (iso) => parseInt(iso.slice(0, 4), 10) * 12 + (parseInt(iso.slice(5, 7), 10) - 1);
const daysBetween = (aISO, bISO) => {
  const a = Date.parse(aISO + "T00:00:00Z");
  const b = Date.parse(bISO + "T00:00:00Z");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null;
};
const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  if (!n) return null;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
};

// Sales enriched with derived days-on-market, sold-vs-asking (£ and %), and £/m².
export function deriveSales(km = RADIUS_KM) {
  const rows = withinRadius(SALES.rows, km).map((r) => {
    const daysOnMarket = r.listedDate && r.soldDate ? daysBetween(r.listedDate, r.soldDate) : null;
    const vsAsking = Number.isFinite(r.askingPrice) ? r.price - r.askingPrice : null;
    const vsAskingPct = Number.isFinite(r.askingPrice) && r.askingPrice ? (vsAsking / r.askingPrice) * 100 : null;
    const perSqm = r.sqm ? Math.round(r.price / r.sqm) : null;
    return { ...r, daysOnMarket, vsAsking, vsAskingPct, perSqm };
  });
  return rows.sort((a, b) => (a.soldDate < b.soldDate ? 1 : a.soldDate > b.soldDate ? -1 : 0));
}

// Active listings enriched with days-on-market-so-far and £/m² asking.
export function deriveListings(km = RADIUS_KM, todayISO) {
  const today = todayISO || SALES.asOf;
  return withinRadius(LISTINGS.rows, km).map((r) => ({
    ...r,
    daysListed: r.listedDate ? daysBetween(r.listedDate, today) : null,
    perSqm: r.sqm ? Math.round(r.askingPrice / r.sqm) : null,
  }));
}

// Summary statistics for the sold set: counts, median £/m², DOM, sold-vs-asking.
export function salesStats(km = RADIUS_KM) {
  const rows = deriveSales(km);
  const psm = rows.map((r) => r.perSqm).filter(Number.isFinite);
  const dom = rows.map((r) => r.daysOnMarket).filter(Number.isFinite);
  const vap = rows.map((r) => r.vsAskingPct).filter(Number.isFinite);
  const belowAsking = rows.filter((r) => Number.isFinite(r.vsAsking) && r.vsAsking < 0).length;
  const withAsking = rows.filter((r) => Number.isFinite(r.vsAsking)).length;
  return {
    count: rows.length,
    medianPerSqm: median(psm),
    medianDaysOnMarket: median(dom),
    medianVsAskingPct: median(vap),
    belowAsking,
    aboveAsking: withAsking - belowAsking - rows.filter((r) => r.vsAsking === 0).length,
    withAsking,
    pctBelowAsking: withAsking ? Math.round((belowAsking / withAsking) * 100) : null,
    rows,
  };
}

// New-build unit supply within the radius (a resale-price headwind indicator).
export function pipelineWithinRadius(km = RADIUS_KM) {
  const rows = withinRadius(NEW_BUILDS.rows, km);
  return { rows, totalUnits: rows.reduce((s, r) => s + (r.units || 0), 0) };
}

// -----------------------------------------------------------------------------
// HOMEDATA ADAPTER — merge a live payload (same shape as the constants above)
// into the exported datasets, so the rest of the app keeps reading `market.js`.
// Call once at boot with whatever the daily routine / Worker cache provides.
// Shape (all optional): { sales:{rows,asOf}, listings:{rows,asOf}, listingsPerMonth,
//   hpi, rent, newBuilds, forecasts }. Live rows should carry curated:false.
// -----------------------------------------------------------------------------
export function applyHomedata(payload) {
  if (!payload || typeof payload !== "object") return false;
  const merge = (target, patch) => {
    if (!patch) return;
    Object.assign(target, patch);
    if (patch.rows || patch.series || patch.currentAvg2bed != null) target.curated = false;
  };
  merge(SALES, payload.sales);
  merge(LISTINGS, payload.listings);
  merge(LISTINGS_PER_MONTH, payload.listingsPerMonth);
  merge(HPI, payload.hpi);
  merge(RENT, payload.rent);
  merge(NEW_BUILDS, payload.newBuilds);
  merge(FORECASTS, payload.forecasts);
  return true;
}

// True if any local-market dataset is still the curated fallback (for UI badges).
export function isCurated() {
  return [SALES, LISTINGS, LISTINGS_PER_MONTH, HPI, RENT, NEW_BUILDS, FORECASTS].some((d) => d.curated);
}
