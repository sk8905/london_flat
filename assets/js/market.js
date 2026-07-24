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
// Provenance: as of the 2026-07-24 pull, SALES, LISTINGS, RENT (current level +
// listings) and HPI are LIVE (curated:false). SALES/LISTINGS come from the Homedata
// Comparables endpoint seeded at the N1 7TX centroid and at Wharf Road (City Road
// Basin) so both sides of the Islington/Hackney border are covered; sold prices are
// HMLR-confirmed completions (spot-checked against HM Land Registry Price Paid Data)
// and £/m² uses EPC-register floor areas. RENT current listings come from the
// Homedata Live Listings feed, geocoded via postcodes.io. HPI is the official UK HPI
// (HM Land Registry / ONS, 2026-05, provisional). Still curated & FLAGGED, not live:
// LISTINGS_PER_MONTH (needs a historic-listing aggregation), NEW_BUILDS (planning
// pipeline), FORECASTS (third-party analyst forecasts), and RENT's pre-2026-07 series
// / yoYPct. `applyHomedata(payload)` merges a fresh same-shape payload and flips each
// block's curated flag off; see the daily routine in the README.
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
// LIVE (2026-07-24): completed 2-bed flat sales within 1 km, pulled from the
// Homedata Comparables endpoint (PostGIS spatial, EPC-matched). Every `price` is
// an HMLR-confirmed completion (is_complete=true); spot-checked against HM Land
// Registry Price Paid Data (e.g. Gainsborough Studios West £865,000 / 2025-12-05
// matches HMLR txid …4804A8C09F8E). `sqm` is the EPC-register floor area, so £/m²
// is EPC-derived. `askingPrice` is omitted where Homedata held no listing price
// (so vs-asking derives as null, not a false 0). lat/lng are the Homedata records.
export const SALES = {
  asOf: "2026-07-24",
  curated: false,
  sources: ["landRegPP", "epcRegister", "homedata"],
  rows: [
    { addr: "26 Gainsborough Studios West, Poole Street", beds: 2, baths: 2, type: "Purpose-built", sqm: 86,
      askingPrice: 895000, price: 865000, listedDate: "2024-12-28", soldDate: "2025-12-05", lat: 51.53581, lng: -0.08911 },
    { addr: "Flat 52 The Cooper Building, 36 Wharf Road", beds: 2, baths: 2, type: "New build", sqm: 67,
      askingPrice: 720000, price: 670000, listedDate: "2025-01-17", soldDate: "2025-12-03", lat: 51.53143, lng: -0.09544 },
    { addr: "Flat 25 Bracklyn Court, Wimbourne Street", beds: 2, baths: 1, type: "Purpose-built", sqm: 60,
      askingPrice: 425000, price: 420000, listedDate: "2025-01-17", soldDate: "2025-05-30", lat: 51.53403, lng: -0.08938 },
    { addr: "Flat 147 Bracklyn Court, Wimbourne Street", beds: 2, baths: 1, type: "Purpose-built", sqm: 83,
      askingPrice: 425000, price: 425000, listedDate: "2024-08-30", soldDate: "2025-03-27", lat: 51.53473, lng: -0.08904 },
    { addr: "30 Gainsborough Studios North, Poole Street", beds: 2, baths: 2, type: "Purpose-built", sqm: 79,
      askingPrice: 725000, price: 710000, listedDate: "2024-10-31", soldDate: "2025-03-14", lat: 51.53612, lng: -0.08881 },
    { addr: "Flat A, 225 New North Road", beds: 2, baths: 1, type: "Purpose-built", sqm: 75,
      price: 911500, soldDate: "2024-12-13", lat: 51.53609, lng: -0.09008 },
    { addr: "Flat 145 Bracklyn Court, Wimbourne Street", beds: 2, baths: 1, type: "Purpose-built", sqm: 60,
      price: 418500, listedDate: "2024-06-07", soldDate: "2024-11-11", lat: 51.53473, lng: -0.08904 },
    { addr: "Flat 512, 56 Wharf Road", beds: 2, baths: 1, type: "Purpose-built", sqm: 71,
      price: 775000, listedDate: "2024-01-27", soldDate: "2024-08-16", lat: 51.53276, lng: -0.0966 },
  ],
};

// -----------------------------------------------------------------------------
// ACTIVE LISTINGS — flats currently on the market within 1 km. `listedDate` lets
// the UI show current time-on-market; `status` tracks the Homedata event chain
// (Added / Reduced / Under Offer / Sold STC). All curated pending the live feed.
// -----------------------------------------------------------------------------
// LIVE (2026-07-24): currently-active 2-bed flat listings within 1 km, from the
// Homedata Comparables feed (rows where is_complete=false and the latest listing
// status is For sale / Under offer / Sold STC). `askingPrice` is the current
// advertised price, `listedDate` the date the listing was first added (so the UI's
// time-on-market is real), `sqm` the EPC floor area. Some rows carry old
// `listedDate`s — genuinely stale stock still on the market, a real DOM signal.
export const LISTINGS = {
  asOf: "2026-07-24",
  curated: false,
  sources: ["homedata", "rightmoveListings"],
  rows: [
    { addr: "Flat 150 Bracklyn Court, Wimbourne Street", beds: 2, baths: 1, type: "Purpose-built", sqm: 63,
      askingPrice: 440000, listedDate: "2026-02-20", status: "Under offer", lat: 51.53473, lng: -0.08904 },
    { addr: "Flat 18 Sawmill Studios, 19 Parr Street", beds: 2, baths: 2, type: "New build", sqm: 71,
      askingPrice: 690000, listedDate: "2026-07-07", status: "Under offer", lat: 51.53421, lng: -0.09054 },
    { addr: "Flat 72 Bracklyn Court, Wimbourne Street", beds: 2, baths: 1, type: "Purpose-built", sqm: 61,
      askingPrice: 435000, listedDate: "2025-12-05", status: "Under offer", lat: 51.53385, lng: -0.08983 },
    { addr: "Flat 24 Parr Court, New North Road", beds: 2, baths: 1, type: "Purpose-built", sqm: 56,
      askingPrice: 400000, listedDate: "2025-10-13", status: "For sale", lat: 51.53414, lng: -0.08869 },
    { addr: "2A Gainsborough Studios West, Poole Street", beds: 2, baths: 2, type: "Purpose-built", sqm: 85,
      askingPrice: 900000, listedDate: "2026-04-24", status: "For sale", lat: 51.53581, lng: -0.08911 },
    { addr: "39 Gainsborough Studios West, Poole Street", beds: 2, baths: 1, type: "Purpose-built", sqm: 66,
      askingPrice: 700000, listedDate: "2025-01-23", status: "For sale", lat: 51.53581, lng: -0.08911 },
    { addr: "11 Niagara Close", beds: 2, baths: 1, type: "Purpose-built", sqm: 58,
      askingPrice: 475000, listedDate: "2024-07-04", status: "For sale", lat: 51.53374, lng: -0.09145 },
    { addr: "Flat A, 223 New North Road", beds: 2, baths: 1, type: "Purpose-built", sqm: 56,
      askingPrice: 500000, listedDate: "2026-06-02", status: "Under offer", lat: 51.53607, lng: -0.09 },
    { addr: "Flat A, 231 New North Road", beds: 2, baths: 1, type: "Purpose-built", sqm: 63,
      askingPrice: 700000, listedDate: "2025-12-23", status: "For sale", lat: 51.53637, lng: -0.09036 },
    { addr: "26 Baring Court, 1 Baring Street", beds: 2, baths: 1, type: "Purpose-built", sqm: 79,
      askingPrice: 450000, listedDate: "2026-05-03", status: "For sale", lat: 51.53648, lng: -0.08936 },
  ],
};

// -----------------------------------------------------------------------------
// LISTINGS PER MONTH — count of NEW 2-bed flat listings within 1 km, by month.
// A simple activity gauge (supply coming to market). Newest last.
// FLAGGED / still curated (2026-07-24): a true monthly new-listing count within
// 1 km needs an aggregated historic-listings query (Homedata Market Activity /
// property_sale_events, event_type=Added, date-bucketed). That can't be built from
// the single cheap daily pull without survivorship bias (live listings only show
// stock still on the market, undercounting older months), so this remains the
// curated estimate rather than a fabricated live count. Refresh when the routine
// is allowed a dedicated aggregation call.
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
// LIVE (UK HPI, month 2026-05, HM Land Registry / ONS — published ~2 months in
// arrears; the newest month is PROVISIONAL and gets revised, so YoY can be volatile).
// Pulled from landregistry.data.gov.uk/data/ukhpi. `n1_7txAvg12m` is now the
// trailing-12-month MEDIAN completed flat-sale price within 1 km of the centroid
// (Homedata/HMLR completions, n=6) — a hyper-local anchor for a 2-bed flat buyer,
// which reads lower than the old whole-postcode figure that included houses.
export const HPI = {
  asOf: "2026-05-01",
  curated: false,
  sources: ["landRegPP", "onsRents"],
  islingtonAvg: 669879,
  islingtonYoYPct: -6.4,
  islingtonFlatsAvg: 557257, // Islington flats/maisonettes (UK HPI)
  islingtonFlatsYoYPct: -7.0,
  n1_7txAvg12m: 697500, // 1 km trailing-12m median completed flat sale (Homedata/HMLR, small sample)
  londonAvg: 544814,
  londonYoYPct: -3.7,
  englandAvg: 292095,
  englandYoYPct: 2.3,
};

// -----------------------------------------------------------------------------
// RENT — average advertised rent for a 2-bed within ~1 km over time, plus a few
// live rental listings. Feeds SECTION 3 (rent vs buy). Curated from Rightmove /
// Zoopla rental history and ONS Islington private-rent stats.
// -----------------------------------------------------------------------------
// PARTLY LIVE (2026-07-24). `currentAvg2bed` and `listings` are LIVE: the median
// and a spread of currently-advertised 2-bed asking rents within 1 km, from the
// Homedata Live Listings feed (transaction_type=Rental, 106 listings in radius,
// geocoded to the centroid via postcodes.io). The live median (£3,722) runs well
// above the old curated series — the City Road Basin 1 km is dominated by premium
// new-build towers, and portal ASKING rents sit above ONS achieved rents.
// FLAGGED: the historical quarterly `series` and `yoYPct` are NOT re-derived this
// pull — there is no allow-listed rent-history source (ONS PIPR sits on
// api.beta.ons.gov.uk, which is off the allow-list). The pre-2026-07 quarters are
// retained estimates; only the final `2026-07` point is live. `yoYPct` is kept as
// the rent-vs-buy forward-growth assumption, not a measured live figure.
export const RENT = {
  asOf: "2026-07-24",
  curated: false,
  sources: ["homedata", "onsRents"],
  // average monthly asking rent for a 2-bed, ~1 km of N1 7TX
  series: [
    { month: "2025-03", rent: 2720 }, // retained estimate (pre-live)
    { month: "2025-06", rent: 2760 }, // retained estimate (pre-live)
    { month: "2025-09", rent: 2795 }, // retained estimate (pre-live)
    { month: "2025-12", rent: 2830 }, // retained estimate (pre-live)
    { month: "2026-03", rent: 2865 }, // retained estimate (pre-live)
    { month: "2026-06", rent: 2895 }, // retained estimate (pre-live)
    { month: "2026-07", rent: 3722 }, // LIVE — Homedata live-listings median (n=106)
  ],
  currentAvg2bed: 3722, // LIVE — median of 106 in-radius 2-bed asking rents
  yoYPct: 4.0, // FLAGGED — forward assumption, not re-derived this pull
  listings: [
    { addr: "New North Road, N1 7BH", beds: 2, baths: 1, pcm: 2750, lat: 51.53656, lng: -0.08998 },
    { addr: "Angel Wharf, N1 7ER", beds: 2, baths: 2, pcm: 3950, lat: 51.53363, lng: -0.09323 },
    { addr: "Arlington Avenue, N1 7AY", beds: 2, baths: 1, pcm: 3350, lat: 51.53471, lng: -0.09383 },
    { addr: "Mono Tower, N1 5FE", beds: 2, baths: 2, pcm: 4250, lat: 51.53644, lng: -0.08629 },
    { addr: "Canalside Square, N1 7FN", beds: 2, baths: 1, pcm: 3500, lat: 51.5341, lng: -0.09487 },
    { addr: "Island Apartments, N1 8PN", beds: 2, baths: 1, pcm: 2750, lat: 51.53795, lng: -0.09277 },
  ],
};

// -----------------------------------------------------------------------------
// NEW-BUILD PIPELINE — upcoming / under-construction developments near N1 7TX
// that add supply (a headwind for resale prices) or amenity.
// FLAGGED / still curated (2026-07-24): these are real, named local schemes, but
// their `units`/`completion` are not verifiable from the single daily Homedata
// pull. A refresh would cross-reference the Homedata Planning endpoint
// (/planning/search) and PlanIt per scheme; until then the pipeline is left as the
// curated estimate rather than guessed live.
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
// London, with attribution. `priceYoY` is a % house-price change for the year;
// `activity` is a qualitative demand/sales-volume read.
// FLAGGED / inherently curated: these are third-party analyst forecasts (RICS,
// Savills, Knight Frank, Zoopla, local agents), not a Homedata product — they are
// editorial and cannot be refreshed from the local-market feed. Kept curated with
// attribution; update by re-reading each publisher's latest release.
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
    // A live payload block is authoritative. Honour an explicit patch.curated;
    // otherwise flip curated off whenever the patch carries any data field (not
    // just rows/series — this also covers scalar blocks like HPI, whose live
    // payload is islingtonAvg/… rather than a rows array).
    if (patch.curated === undefined) {
      const dataKeys = Object.keys(patch).filter((k) => k !== "asOf" && k !== "curated");
      if (dataKeys.length) target.curated = false;
    }
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
