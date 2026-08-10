// =============================================================================
// market.js  —  Local market data layer for the 2 km radius around N1 7TX
// -----------------------------------------------------------------------------
// This module is the single source of truth for SECTION 1 (Local market). It is
// deliberately shaped as an ADAPTER TARGET: the curated constants below are the
// offline fallback, and `applyHomedata()` merges a live Homedata payload into the
// same shape when one is available (fetched once/day by the routine and committed
// as market.data.js, or served from a Worker cache — see README).
//
// Geometry: everything is filtered to a STRICT 2 km radius of the N1 7TX postcode
// centroid via a haversine distance. Each row carries lat/lng so the map, the
// £/m² scatter and the radius filter all read from the same records.
//
// Council filter: comps identified as council / ex-council / shared-ownership
// stock are EXCLUDED, because they trade at a large discount and aren't a fair
// read for a private 2-bed. Homedata exposes no tenure/council field, so this is
// a curated exclusion by block name (e.g. Bracklyn Court, Parr Court, Baring
// Court, Kingsgate Estate, and any "… Estate") plus a sub-£5k/m² sanity screen
// that catches shared-ownership resales. If a legitimate private comp is missing,
// check it wasn't caught by that screen.
//
// Provenance: as of the 2026-07-26 pull, SALES, LISTINGS, RENT (current level +
// listings) and HPI are LIVE (curated:false). SALES/LISTINGS come from the Homedata
// Comparables endpoint seeded across the 2 km ring (centroid, Wharf Road, Haggerston
// and Angel) so both sides of the Islington/Hackney border are covered; sold prices are
// HMLR-confirmed completions (spot-checked against HM Land Registry Price Paid Data)
// and £/m² uses EPC-register floor areas. RENT current listings + yoYPct are live
// (Homedata Live Listings, geocoded via postcodes.io; yoYPct from ONS PIPR). HPI is
// the official UK HPI (HM Land Registry / ONS, 2026-05, provisional). NEW_BUILDS is
// live from PlanIt planning records (completion years are estimates). Still curated
// & FLAGGED: LISTINGS_PER_MONTH (a clean monthly census isn't cheaply
// reconstructable — see its note), FORECASTS (third-party analyst forecasts), and
// RENT's pre-2026-07 series. `applyHomedata(payload)` merges a fresh same-shape
// payload and flips each block's curated flag off; see the daily routine in README.
// =============================================================================

// N1 7TX postcode centroid (City Road Basin / Wenlock, Islington).
export const CENTER = { lat: 51.5346, lng: -0.0899 };
export const RADIUS_KM = 2.0;

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

// Keep only records inside the strict radius (default 2 km); stamps `.distKm`.
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
// LIVE (2026-07-26): completed 2-bed flat sales within 2 km, pulled from the
// Homedata Comparables endpoint (PostGIS spatial, EPC-matched) seeded at the
// centroid, Wharf Road, Haggerston (N1 4SN) and Angel (N1 8DX) so the whole 2 km
// ring is covered; council / ex-council / shared-ownership stock is filtered out
// (see the module header). Every `price` is
// an HMLR-confirmed completion (is_complete=true); spot-checked against HM Land
// Registry Price Paid Data (e.g. Gainsborough Studios West £865,000 / 2025-12-05
// matches HMLR txid …4804A8C09F8E). `sqm` is the EPC-register floor area, so £/m²
// is EPC-derived. `askingPrice` is omitted where Homedata held no listing price
// (so vs-asking derives as null, not a false 0). lat/lng are the Homedata records.
export const SALES = {
  asOf: "2026-07-26",
  curated: false,
  sources: ["landRegPP", "epcRegister", "homedata"],
  rows: [
    { addr: "Top Floor Flat, 30 Duncan Terrace", beds: 2, baths: 1, type: "Purpose-built", sqm: 62,
      askingPrice: 875000, price: 845000, listedDate: "2025-10-01", soldDate: "2026-03-27", lat: 51.53322, lng: -0.10366 },
    { addr: "4 Walton Villas, Downham Road", beds: 2, baths: 1, type: "Purpose-built", sqm: 55,
      askingPrice: 550000, price: 535000, listedDate: "2025-08-15", soldDate: "2026-02-06", lat: 51.53936, lng: -0.07939 },
    { addr: "Flat 12 Sledge Tower, Dalston Square", beds: 2, baths: 2, type: "New build", sqm: 74,
      price: 590000, listedDate: "2025-05-09", soldDate: "2026-01-14", lat: 51.54512, lng: -0.07486 },
    { addr: "16 Falcon Court, City Garden Row", beds: 2, baths: 1, type: "Purpose-built", sqm: 74,
      price: 671000, listedDate: "2024-10-08", soldDate: "2025-12-16", lat: 51.53078, lng: -0.09855 },
    { addr: "26 Gainsborough Studios West, Poole Street", beds: 2, baths: 2, type: "Purpose-built", sqm: 86,
      askingPrice: 895000, price: 865000, listedDate: "2024-12-28", soldDate: "2025-12-05", lat: 51.53581, lng: -0.08911 },
    { addr: "Flat 52 The Cooper Building, 36 Wharf Road", beds: 2, baths: 2, type: "New build", sqm: 67,
      askingPrice: 720000, price: 670000, listedDate: "2025-01-17", soldDate: "2025-12-03", lat: 51.53143, lng: -0.09544 },
    { addr: "Ground Floor Flat, 42 Danbury Street", beds: 2, baths: 2, type: "Purpose-built", sqm: 51,
      price: 777000, listedDate: "2024-12-12", soldDate: "2025-10-22", lat: 51.53442, lng: -0.09882 },
    { addr: "Flat 27 Dorset Court, Hertford Road", beds: 2, baths: 1, type: "Purpose-built", sqm: 75,
      price: 592000, listedDate: "2025-06-04", soldDate: "2025-10-01", lat: 51.54186, lng: -0.07768 },
    { addr: "Unit 2B Quebec Wharf, 315 Kingsland Road", beds: 2, baths: 2, type: "Purpose-built", sqm: 133,
      price: 1130000, listedDate: "2025-05-20", soldDate: "2025-09-26", lat: 51.53822, lng: -0.07746 },
    { addr: "Flat 14 Wonder House, Roseberry Place", beds: 2, baths: 2, type: "New build", sqm: 64,
      price: 615000, listedDate: "2024-02-02", soldDate: "2025-09-24", lat: 51.5442, lng: -0.07485 },
    { addr: "70 Tottenham Road", beds: 2, baths: 2, type: "Purpose-built", sqm: 84,
      askingPrice: 700000, price: 700000, listedDate: "2025-08-08", soldDate: "2025-08-21", lat: 51.54553, lng: -0.07871 },
    { addr: "30 Gainsborough Studios North, Poole Street", beds: 2, baths: 2, type: "New build", sqm: 79,
      askingPrice: 725000, price: 710000, listedDate: "2024-10-31", soldDate: "2025-03-14", lat: 51.53612, lng: -0.08881 },
    { addr: "Flat A, 225 New North Road", beds: 2, baths: 1, type: "Purpose-built", sqm: 75,
      price: 911500, soldDate: "2024-12-13", lat: 51.53609, lng: -0.09008 },
  ],
};

// -----------------------------------------------------------------------------
// ACTIVE LISTINGS — flats currently on the market within 2 km. `listedDate` lets
// the UI show current time-on-market; `status` tracks the Homedata event chain
// (Added / Reduced / Under Offer / Sold STC). All curated pending the live feed.
// -----------------------------------------------------------------------------
// LIVE (2026-07-26): currently-active 2-bed flat listings within 2 km (council /
// ex-council / shared-ownership stock filtered out — see the module header), from the
// Homedata Comparables feed (rows where is_complete=false and the latest listing
// status is For sale / Under offer / Sold STC). `askingPrice` is the current
// advertised price, `listedDate` the date the listing was first added (so the UI's
// time-on-market is real), `sqm` the EPC floor area. Some rows carry old
// `listedDate`s — genuinely stale stock still on the market, a real DOM signal.
export const LISTINGS = {
  asOf: "2026-07-26",
  curated: false,
  sources: ["homedata", "rightmoveListings"],
  rows: [
    { addr: "44 Gainsborough Studios North, Poole Street", beds: 2, baths: 2, type: "Purpose-built", sqm: 101,
      askingPrice: 1150000, listedDate: "2026-07-21", status: "For sale", lat: 51.53612, lng: -0.08881 },
    { addr: "55 Midway House, Manningford Close", beds: 2, baths: 2, type: "Purpose-built", sqm: 68,
      askingPrice: 550000, listedDate: "2026-07-16", status: "For sale", lat: 51.5288, lng: -0.10182 },
    { addr: "Flat 18 Sawmill Studios, 19 Parr Street", beds: 2, baths: 2, type: "New build", sqm: 71,
      askingPrice: 690000, listedDate: "2026-07-07", status: "For sale", lat: 51.53421, lng: -0.09054 },
    { addr: "Flat 7 Dalby House, 398 City Road", beds: 2, baths: 1, type: "Purpose-built", sqm: 58,
      askingPrice: 650000, listedDate: "2026-07-01", status: "For sale", lat: 51.53124, lng: -0.10429 },
    { addr: "2 Pickfords Wharf, Wharf Road", beds: 2, baths: 1, type: "Purpose-built", sqm: 86,
      askingPrice: 775000, listedDate: "2026-06-26", status: "For sale", lat: 51.53184, lng: -0.0964 },
    { addr: "Flat 36 The Cooper Building, 36 Wharf Road", beds: 2, baths: 2, type: "New build", sqm: 64,
      askingPrice: 700000, listedDate: "2026-06-22", status: "For sale", lat: 51.53143, lng: -0.09544 },
    { addr: "Flat 8, 265 Goswell Road", beds: 2, baths: 2, type: "New build", sqm: 89,
      askingPrice: 950000, listedDate: "2026-06-19", status: "For sale", lat: 51.52995, lng: -0.10304 },
    { addr: "Flat A, 223 New North Road", beds: 2, baths: 1, type: "Purpose-built", sqm: 56,
      askingPrice: 500000, listedDate: "2026-06-02", status: "Under offer", lat: 51.53607, lng: -0.09 },
    { addr: "Unit 22 Quebec Wharf, 315 Kingsland Road", beds: 2, baths: 3, type: "Purpose-built", sqm: 91,
      askingPrice: 750000, listedDate: "2026-05-06", status: "For sale", lat: 51.53822, lng: -0.07746 },
    { addr: "Flat 604, 56 Wharf Road", beds: 2, baths: 2, type: "New build", sqm: 109,
      askingPrice: 900000, listedDate: "2026-05-01", status: "For sale", lat: 51.53276, lng: -0.0966 },
    { addr: "Flat 12 Wonder House, Roseberry Place", beds: 2, baths: 2, type: "New build", sqm: 90,
      askingPrice: 780000, listedDate: "2026-04-29", status: "For sale", lat: 51.5442, lng: -0.07485 },
    { addr: "Flat 510 Union Wharf, 23 Wenlock Road", beds: 2, baths: 2, type: "Purpose-built", sqm: 98,
      askingPrice: 1195000, listedDate: "2026-04-09", status: "For sale", lat: 51.53226, lng: -0.09505 },
    { addr: "1 Brides Place, De Beauvoir Road", beds: 2, baths: 2, type: "Purpose-built", sqm: 94,
      askingPrice: 1100000, listedDate: "2026-03-20", status: "For sale", lat: 51.53984, lng: -0.08036 },
  ],
};

// -----------------------------------------------------------------------------
// LISTINGS PER MONTH — count of NEW 2-bed flat listings within 2 km, by month.
// A simple activity gauge (supply coming to market). Newest last.
// FLAGGED / still curated (2026-07-24): a refresh was ATTEMPTED and can't be done
// honestly on the cheap. The Homedata Live Listings feed (newest-first, page 1 of
// both boroughs) only reaches back to 2026-05 within radius — three months — and,
// being active-only, it undercounts every month by the sold/withdrawn share. A true
// monthly new-listing census needs a date-bucketed historic aggregation (Market
// Activity / property_sale_events, event_type=Added, per-property), which is too
// call-heavy for the free tier. Left as the curated estimate rather than a
// survivorship-biased live count.
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
// Pulled from landregistry.data.gov.uk/data/ukhpi. `n17txAvg12m` is now the
// trailing-12-month MEDIAN completed flat-sale price within 2 km of the centroid
// (Homedata/HMLR completions, council-filtered, n=11) — a hyper-local anchor for a
// 2-bed flat buyer, which reads lower than the whole-postcode figure that included houses.
export const HPI = {
  asOf: "2026-05-01",
  curated: false,
  sources: ["landRegPP", "onsRents"],
  islingtonAvg: 669879,
  islingtonYoYPct: -6.4,
  islingtonFlatsAvg: 557257, // Islington flats/maisonettes (UK HPI)
  islingtonFlatsYoYPct: -7.0,
  n17txAvg12m: 671000, // 2 km trailing-12m median completed flat sale (Homedata/HMLR, council-filtered, n=11)
  londonAvg: 544814,
  londonYoYPct: -3.7,
  englandAvg: 292095,
  englandYoYPct: 2.3,
};

// -----------------------------------------------------------------------------
// RENT — average advertised rent for a 2-bed within ~2 km over time, plus a few
// live rental listings. Feeds SECTION 3 (rent vs buy). Curated from Rightmove /
// Zoopla rental history and ONS Islington private-rent stats.
// -----------------------------------------------------------------------------
// PARTLY LIVE (2026-07-26). `currentAvg2bed` and `listings` are LIVE: the median
// and a spread of currently-advertised 2-bed asking rents within 2 km, from the
// Homedata Live Listings feed (transaction_type=Rental, 205 council-filtered listings
// in radius, geocoded via postcodes.io). The live median (£3,600) runs well
// above the old curated series — the City Road Basin is dominated by premium
// new-build towers, and portal ASKING rents sit above ONS achieved rents.
// `yoYPct` is LIVE: ONS Price Index of Private Rents (PIPR), London, +2.2% in the
// 12 months to June 2026 (the bulletin doesn't break out Islington; London is the
// closest verified figure). The historical quarterly `series` before 2026-07 is
// still retained estimates — there is no allow-listed source for a 2 km 2-bed rent
// history — so only the final `2026-07` point is a live measurement.
export const RENT = {
  asOf: "2026-07-26",
  curated: false,
  sources: ["homedata", "onsRents"],
  // average monthly asking rent for a 2-bed, ~2 km of N1 7TX
  series: [
    { month: "2025-03", rent: 2720 }, // retained estimate (pre-live)
    { month: "2025-06", rent: 2760 }, // retained estimate (pre-live)
    { month: "2025-09", rent: 2795 }, // retained estimate (pre-live)
    { month: "2025-12", rent: 2830 }, // retained estimate (pre-live)
    { month: "2026-03", rent: 2865 }, // retained estimate (pre-live)
    { month: "2026-06", rent: 2895 }, // retained estimate (pre-live)
    { month: "2026-07", rent: 3600 }, // LIVE — Homedata live-listings median (n=205, 2 km, council-filtered)
  ],
  currentAvg2bed: 3600, // LIVE — median of 205 in-radius 2-bed asking rents (2 km, council-filtered)
  yoYPct: 2.2, // LIVE — ONS PIPR, London private rents, 12 months to June 2026
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
// -----------------------------------------------------------------------------
// LIVE (2026-07-24): active residential pipeline within 2 km, from PlanIt planning
// records (www.planit.org.uk). Each row links to its planning application. `units`
// is used only where the decision notice states a clear figure; `completion` is an
// ESTIMATE from the permission date + typical build-out (PlanIt does not publish
// completion dates), so treat the year as indicative. `status` maps the PlanIt
// application state (Permitted / discharging Conditions ≈ under construction).
export const NEW_BUILDS = {
  asOf: "2026-07-24",
  curated: false,
  sources: ["planit"],
  rows: [
    { name: "Land on Wimbourne Street", short: "Wimbourne Street", units: 59, completion: "~2025", status: "Under construction",
      note: "6–8 storey residential building, 59 units. Permitted 2021 (Hackney 2020/1667). ~80 m — direct competing stock.",
      url: "https://www.planit.org.uk/planapplic/Hackney/2020/1667/", lat: 51.53442, lng: -0.08875 },
    { name: "Holborn Studios, 49–50 Eagle Wharf Road", short: "Holborn Studios", units: 50, completion: "~2026", status: "Under construction",
      note: "Mixed-use redevelopment retaining the industrial chimney. Conditions stage 2022 (Islington P2021/3239).",
      url: "https://www.planit.org.uk/planapplic/Islington/P2021/3239/OBS/", lat: 51.53419, lng: -0.093 },
    { name: "48–48a Eagle Wharf Road", short: "48 Eagle Wharf Rd", units: 139, completion: "~2027", status: "Approved",
      note: "Self-storage site redeveloped to mixed-use, 2–7 storeys. Conditions stage 2022 (Hackney 2021/0680).",
      url: "https://www.planit.org.uk/planapplic/Hackney/2021/0680/", lat: 51.53407, lng: -0.09263 },
    { name: "Colville Estate (Penn Street, later phases)", short: "Colville Estate", units: 209, completion: "~2027", status: "Under construction",
      note: "Council-led estate regeneration, later phases. Permitted (Hackney 2019/0038). Adds market & affordable homes.",
      url: "https://www.planit.org.uk/planapplic/Hackney/2019/0038/", lat: 51.53622, lng: -0.08536 },
    { name: "Britannia Leisure Centre / Bridge Academy", short: "Britannia Leisure", units: 481, completion: "~2027", status: "Under construction",
      note: "Hybrid scheme — 481 homes plus a school and leisure centre. Permitted (Hackney 2019/3143). Big supply pulse ~450 m E.",
      url: "https://www.planit.org.uk/planapplic/Hackney/2019/3143/", lat: 51.5353, lng: -0.08363 },
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
  asOf: "2026-08-02",
  curated: true,
  sources: ["ricsSurvey", "rightmoveListings"],
  rows: [
    { source: "RICS Residential Survey", short: "RICS", horizon: "Next 12m (London)", priceYoY: null,
      activity: "Price balance around neutral; sales expectations modestly positive as rates ease.",
      url: "https://www.rics.org/news-insights/market-surveys/uk-residential-market-survey",
      note: "London net price balance near zero; 12-month sales expectations positive." },
    { source: "Savills (mainstream London)", short: "Savills", horizon: "2026", priceYoY: -2.0,
      activity: "Subdued transactions; recovery weighted to H2.",
      url: "https://www.savills.co.uk/research_articles/229130/391249-0",
      note: "Revised Jun 2026: 2026 −2%, 2027 +2.5%, 2028 +5%, 2029 +6%, 2030 +6% — 18.5% cumulative " +
        "to 2030, down from the prior 22.2% forecast." },
    { source: "Knight Frank (Greater London)", short: "Knight Frank", horizon: "2026", priceYoY: 1.5,
      activity: "Downgraded on higher mortgage rates and weaker sentiment; demand cooling near-term.",
      url: "https://www.knightfrank.co.uk/research/article/2026/4/uk-housing-market-forecast-q2-2026",
      note: "UK national revised down to +1.5% 2026 (from +3%), +3% 2027, +4% 2028; Greater London " +
        "specifically also cut from +3% but the exact revised GL figure wasn't published — flagged, not verified." },
    { source: "Zoopla", short: "Zoopla", horizon: "2026", priceYoY: 1.5,
      activity: "Buyer demand up year-on-year; more supply keeps prices in check.",
      url: "https://www.zoopla.co.uk/discover/property-news/house-price-index/",
      note: "UK ~+1.5% 2026; London lags on affordability, more choice for buyers." },
    { source: "Foxtons / local agents (Islington)", short: "Foxtons", horizon: "Next 12m", priceYoY: 1.0,
      activity: "Steady 2-bed demand from professionals; new-build supply caps upside.",
      url: "https://www.foxtons.co.uk/discover/house-price-index",
      note: "Flat-to-modest local growth; well-priced 2-beds move; over-priced stock lingers." },
  ],
};

// -----------------------------------------------------------------------------
// DERIVED VIEWS — pure helpers the UI reads. All distance-filtered to the radius.
// -----------------------------------------------------------------------------
const daysBetween = (aISO, bISO) => {
  const a = Date.parse(aISO + "T00:00:00Z");
  const b = Date.parse(bISO + "T00:00:00Z");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null;
};
export const median = (arr) => {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
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

// Quarterly trend series from the SOLD set: median £/m², days-on-market and
// sold-vs-asking %, oldest → newest, plus the latest-minus-first direction for a
// trend arrow. Small local sample, so it's a direction hint, not a precise index.
export function salesTrends(km = RADIUS_KM) {
  const rows = deriveSales(km).filter((r) => r.soldDate);
  const qkey = (iso) => iso.slice(0, 4) + "Q" + (Math.floor((parseInt(iso.slice(5, 7), 10) - 1) / 3) + 1);
  const buckets = new Map();
  for (const r of rows) {
    const k = qkey(r.soldDate);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  const keys = [...buckets.keys()].sort();
  const seriesFor = (fn) =>
    keys.map((k) => ({ q: k, v: median(buckets.get(k).map(fn).filter(Number.isFinite)), n: buckets.get(k).length }))
      .filter((p) => Number.isFinite(p.v));
  const psm = seriesFor((r) => r.perSqm);
  const dom = seriesFor((r) => r.daysOnMarket);
  const vsAsk = seriesFor((r) => r.vsAskingPct);
  const dir = (s) => (s.length < 2 ? 0 : s[s.length - 1].v - s[0].v);
  return { psm, dom, vsAsk, dir: { psm: dir(psm), dom: dir(dom), vsAsk: dir(vsAsk) } };
}

// Months-of-supply (absorption) = active listings ÷ monthly sales rate. Both come
// from the SAME 2 km council-filtered feed, so the sampling fraction largely
// cancels and the ratio is meaningful even though the absolute counts are partial.
// A balanced market is ~5–6 months; higher = slower / more of a buyer's market.
export function monthsOfSupply(km = RADIUS_KM, todayISO) {
  const today = todayISO || SALES.asOf;
  const active = withinRadius(LISTINGS.rows, km).length;
  const cutoff = String(parseInt(today.slice(0, 4), 10) - 1) + today.slice(4); // one year back
  const trailing = deriveSales(km).filter((r) => r.soldDate && r.soldDate >= cutoff).length;
  const perMonth = trailing / 12;
  return { active, trailing12mSold: trailing, salesPerMonth: perMonth, months: perMonth > 0 ? active / perMonth : null };
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
