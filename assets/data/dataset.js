// =============================================================================
// dataset.js  —  Curated, sourced market dataset for the London Flat forecaster
// -----------------------------------------------------------------------------
// Every figure below is a snapshot researched on 2026-06-30. Each block carries a
// `source` key (an id into SOURCES) and a `note` so the UI can show provenance.
// Anything forward-looking is flagged `estimate: true`. Edit freely — the app
// recomputes everything from this file. Values such as the BoE Bank Rate are
// curated snapshots here; update them and redeploy to refresh.
// =============================================================================

export const META = {
  asOf: "2026-06-30",
  build: "v53 · 2026-07-24", // bump on each change so the footer confirms the live build
  currency: "GBP",
  disclaimer:
    "This tool is an informational model, not financial, tax, mortgage or legal advice. " +
    "Figures are curated snapshots and forward-looking estimates that will go stale. " +
    "Verify against the linked sources and a qualified adviser before acting.",
};

// -----------------------------------------------------------------------------
// Sources registry — referenced by id throughout the dataset and the UI.
// -----------------------------------------------------------------------------
export const SOURCES = {
  landRegistryHPI: {
    label: "HM Land Registry — UK House Price Index (Islington)",
    url: "https://landregistry.data.gov.uk/app/ukhpi/browse?from=2024-01-01&location=http%3A%2F%2Flandregistry.data.gov.uk%2Fid%2Fregion%2Fislington&to=2026-03-01",
    publisher: "HM Land Registry / ONS",
  },
  hpiMar2026: {
    label: "UK House Price Index for March 2026",
    url: "https://www.gov.uk/government/news/uk-house-price-index-for-march-2026",
    publisher: "GOV.UK",
  },
  onsIslington: {
    label: "ONS — Housing prices in Islington (local area)",
    url: "https://www.ons.gov.uk/visualisations/housingpriceslocal/E09000019/",
    publisher: "Office for National Statistics",
  },
  boeRate: {
    label: "Bank of England — Bank Rate (latest decision)",
    url: "https://www.bankofengland.co.uk/monetary-policy/the-interest-rate-bank-rate",
    publisher: "Bank of England",
  },
  boeJune2026: {
    label: "Monetary Policy Summary, June 2026 (Bank Rate held at 3.75%)",
    url: "https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/june-2026",
    publisher: "Bank of England",
  },
  rightmoveRates: {
    label: "Rightmove — current UK mortgage rates",
    url: "https://www.rightmove.co.uk/news/articles/property-news/current-uk-mortgage-rates/",
    publisher: "Rightmove",
  },
  savillsForecast: {
    label: "Savills — UK house price forecast revised to -2% for 2026",
    url: "https://www.savills.co.uk/insight-and-opinion/savills-news/391268/savills-revises-uk-house-price-forecast-as-higher-mortgage-costs-weigh-on-demand",
    publisher: "Savills Research",
  },
  knightFrank: {
    label: "Knight Frank — UK Housing Market Forecast, Q2 2026",
    url: "https://www.knightfrank.co.uk/research/article/2026/4/uk-housing-market-forecast-q2-2026",
    publisher: "Knight Frank Research",
  },
  zooplaHPI: {
    label: "Zoopla — House Price Index (May 2026)",
    url: "https://www.zoopla.co.uk/discover/property-news/house-price-index/",
    publisher: "Zoopla",
  },
  budgetMansionTax: {
    label: "Autumn Budget 2025 — High Value Council Tax Surcharge ('mansion tax')",
    url: "https://hoa.org.uk/news/new-property-tax/",
    publisher: "HomeOwners Alliance",
  },
  budgetZoopla: {
    label: "Zoopla — What the Autumn Budget means for the housing market",
    url: "https://www.zoopla.co.uk/discover/property-news/autumn-budget-impact-on-uk-housing-market/",
    publisher: "Zoopla",
  },
  seasonalRightmove: {
    label: "Rightmove — When is the best time to sell a house?",
    url: "https://www.rightmove.co.uk/guides/seller/preparing-to-sell/is-now-the-right-time-to-sell/",
    publisher: "Rightmove",
  },
  hoaRateForecast: {
    label: "HomeOwners Alliance — Mortgage rate predictions 2026",
    url: "https://hoa.org.uk/advice/guides-for-homeowners/for-owners/mortgage-rate-forecast/",
    publisher: "HomeOwners Alliance",
  },
  cgtPrivateResidence: {
    label: "GOV.UK — Private Residence Relief (Capital Gains Tax)",
    url: "https://www.gov.uk/tax-sell-home",
    publisher: "GOV.UK / HMRC",
  },
  cgtRates: {
    label: "GOV.UK — Capital Gains Tax rates & allowances; property income tax",
    url: "https://www.gov.uk/capital-gains-tax/rates",
    publisher: "GOV.UK / HMRC",
  },
  soldPriceData: {
    label: "HM Land Registry — Price Paid / sold-price search (N1, £/m²)",
    url: "https://www.gov.uk/search-house-prices",
    publisher: "HM Land Registry",
  },
  zooplaN17tx: {
    label: "Zoopla — sold prices & estimates for N1 7TX",
    url: "https://www.zoopla.co.uk/house-prices/n1-7tx/",
    publisher: "Zoopla",
  },
};

// -----------------------------------------------------------------------------
// Your position — defaults from the scoping conversation. All editable in the UI.
// -----------------------------------------------------------------------------
export const PROPERTY = {
  postcode: "N1 7TX",
  area: "Islington",
  propertyType: "flat",
  purchaseDate: "2025-03-01",
  purchasePrice: 890000,
  isPrimaryResidence: true, // -> CGT exempt via Private Residence Relief
  floorAreaSqm: 91.45, // ~984 sq ft
  bedrooms: 2,
  bathrooms: 2,
  buildYear: 2020, // new-build / modern
  lat: 51.5346, // N1 7TX postcode centroid (City Road Basin / Wenlock area)
  lng: -0.0899,
};

// -----------------------------------------------------------------------------
// Comparable SOLD-price evidence (actual Land Registry transactions, NOT asking
// prices or agent forecasts). Used to value the flat by £/m² for its 91.45 m².
// -----------------------------------------------------------------------------
export const COMPARABLES = {
  sources: ["soldPriceData", "hpiMar2026", "onsIslington"],
  asOf: "2026-04-11",
  note:
    "Actual SOLD prices, not asking prices or forecasts. Half of 1,923 N1 (Islington) Land " +
    "Registry sales completed at £8,350–£11,790/m² (interquartile range); the median is ~£10,000/m². " +
    "N1 flats were broadly flat in value over the year to March 2026, and the N1 7TX postcode " +
    "12-month average sold price was ~£1.07m. Your flat is a 2020-built 2-bed/2-bath of 91.45 m², " +
    "which typically sits in the upper half of the range (new-build premium, maturing with age).",
  // N1 sold price per square metre (Land Registry-derived).
  perSqm: { low: 8350, median: 9900, high: 11790 },
  n1FlatAvg12m: 665438, // all N1 flats, all sizes — skewed small/older
  n1_7txAvg12m: 1070000, // your postcode, last 12 months
};

// -----------------------------------------------------------------------------
// Recent completed SALES of 2-bed flats in N1 (representative comparables).
// Compiled from HM Land Registry sold prices; floor area (m²) and bathroom count
// from EPC register and listing data. Bathrooms and exact areas aren't in core
// open data, so where not published they reflect each property's typical spec —
// verify individual transactions via the linked sources. £/m² is computed.
// -----------------------------------------------------------------------------
export const COMPS = {
  sources: ["soldPriceData", "zooplaN17tx", "onsIslington"],
  asOf: "2026-06-30",
  note:
    "Recent N1 two-bedroom flat sales — restricted to new-build and purpose-built apartments, the like-for-like " +
    "set for your 2020-built flat (period/warehouse conversions and maisonettes are excluded). Prices from HM Land " +
    "Registry; floor area and bathrooms from EPC/listing data where available. Your flat is highlighted for comparison.",
  // lat/lng geocoded from each street's postcode (checkmypostcode / streetcheck /
  // doogal) — street-level, not exact door numbers.
  rows: [
    { addr: "Wenlock Road (Wharf), N1 7", date: "2026-03", price: 840000, beds: 2, baths: 2, type: "Apartment — new build", sqm: 80, lat: 51.5318, lng: -0.0947 },
    { addr: "Prebend Street, N1 8", date: "2026-02", price: 660000, beds: 2, baths: 1, type: "Apartment — purpose-built", sqm: 70, lat: 51.5365, lng: -0.0961 },
    { addr: "City Wharf, Wharf Road, N1 7", date: "2026-01", price: 870000, beds: 2, baths: 2, type: "Apartment — new build", sqm: 83, lat: 51.5328, lng: -0.0966 },
    { addr: "Jefferson Court, Cynthia Street, N1 9", date: "2025-09", price: 950000, beds: 2, baths: 2, type: "Apartment — new build", sqm: 90, lat: 51.5317, lng: -0.1132 },
    { addr: "250 City Road, N1 7", date: "2025-05", price: 820000, beds: 2, baths: 2, type: "Apartment — new build", sqm: 77, lat: 51.5289, lng: -0.0953 },
    { addr: "Liverpool Road (Angel), N1 1", date: "2025-02", price: 560000, beds: 2, baths: 1, type: "Apartment — purpose-built", sqm: 62, lat: 51.5349, lng: -0.1070 },
  ],
};

export const MORTGAGE = {
  principal: 615000, // amount borrowed = £890k − £275k deposit
  ltv: 615000 / 890000, // ~69% loan-to-value
  ratePct: 4.38, // fixed rate on the 2-year deal
  fixEndDate: "2027-03-01",
  repaymentType: "capital_and_interest",
  termYears: 25,
  // ERC: 1% of the outstanding balance while still inside the current fixed period.
  ercPctWhileFixed: 1.0,
  // Assumed remortgage rate once the fix ends (editable). Anchored to the
  // current ~5.5% 2yr fix with a modest easing assumption by spring 2027.
  remortgageRatePctAssumed: 5.1,
  // The NEW deal taken when the current fix ends also has its own fixed term and
  // ERC — selling inside it triggers that charge too. Set the term to 0 (or the
  // ERC to 0) if you plan to remortgage onto a tracker / no-ERC product.
  remortgageFixYears: 2,
  remortgageErcPct: 1.0, // % of balance while inside the new remortgage fix
};

export const SELLING_COSTS = {
  agentPct: 1.25, // estate agent fee, excl VAT
  vatPct: 20, // applied to the agent fee
  legalFixed: 1500, // conveyancing
  epcAndMiscFixed: 500, // EPC, removals admin, misc
};

// -----------------------------------------------------------------------------
// Price history — index anchored to the purchase (Mar 2025 = 100).
// Built from Land Registry Islington series + London-wide trend. Islington FLATS
// were roughly flat year-to-March-2026 while London-wide fell ~2%; we lean to the
// flat-specific signal but keep London softness visible.
// -----------------------------------------------------------------------------
export const PRICE_HISTORY = {
  source: "landRegistryHPI",
  note:
    "Islington average price £673k (Mar 2025, revised) → £679k (Mar 2026), +0.9%. " +
    "Islington FLATS were broadly flat over the year; London-wide -2.1%. Index is " +
    "anchored to your purchase month so 100 = £890,000.",
  anchorDate: "2025-03-01",
  // {date, islingtonIndex, londonIndex} relative to Mar 2025 = 100
  series: [
    { date: "2025-03", islington: 100.0, london: 100.0 },
    { date: "2025-06", islington: 99.7, london: 99.4 },
    { date: "2025-09", islington: 99.4, london: 99.0 },
    { date: "2025-12", islington: 99.2, london: 98.4 },
    { date: "2026-03", islington: 99.3, london: 97.9 }, // Islington flats ~flat, London -2.1%
    { date: "2026-06", islington: 99.0, london: 97.6 }, // provisional / estimate
  ],
};

// Islington context figures (for callouts).
export const ISLINGTON_FACTS = {
  source: "hpiMar2026",
  avgPriceMar2025: 673000,
  avgPriceMar2026: 679000,
  yoyPct: 0.9,
  flatsYoY: 0.0,
  homeMoverAvgMar2026: 850000,
  homeMoverAvgMar2025: 833000,
  avgRentApr2026: 2811,
  avgRentApr2025: 2704,
  rentYoYPct: 4.0,
};

// -----------------------------------------------------------------------------
// Interest-rate history & the user's rate.
// -----------------------------------------------------------------------------
export const RATES = {
  source: "boeJune2026",
  rateSource: "rightmoveRates",
  baseRateNow: 3.75, // BoE Bank Rate, held June 2026 (live-refreshable)
  baseRateAsOf: "2026-06-17",
  // 2-year GBP interest-rate swap (SONIA) — the wholesale rate UK lenders price
  // fixed-rate mortgages and real-estate lending off. Sits above Bank Rate when
  // the market expects cuts to be slow; the key driver of fixed mortgage pricing.
  swap2yrNow: 4.06,
  swap2yrAsOf: "2026-06-26",
  // Current average 2-year fixed REMORTGAGE rate at ~70% LTV (the band that fits
  // this flat). Live-refreshed from Bank of England quoted mortgage rates,
  // interpolated between the published 60% and 75% LTV series. Snapshot fallback:
  remortgage70Now: 5.02,
  remortgage70AsOf: "2026-06",
  // Forecast 2-yr-fix path from the Bank of England OIS instantaneous forward
  // curve (month-end 2026-06, statistics/yield-curves). Change vs the current fix,
  // in percentage points, at ~2028 and ~2030: the 2-yr swap forward starting in T
  // years (avg instantaneous fwd over [T,T+2]) moves 4.02% (now) → 4.02% (2028) →
  // 4.24% (2030), i.e. broadly flat then edging up — so the fix holds ~5%, ~5.2%
  // by 2030. Refresh from the monthly OIS spreadsheet.
  oisFix2yForecast: { asOf: "BoE OIS, Jun 2026", d28: 0.0, d30: 0.2 },
  // Previous CALENDAR-DAY values, so each badge can show a day-over-day % change.
  // The daily 08:00 routine rolls "*Now" into "*Prev" before writing the new value;
  // the Worker also supplies the prior day's figure for the live series.
  baseRatePrev: 3.75,
  remortgage70Prev: 5.02,
  swap2yrPrev: 4.09,
  cpiPct: 2.8, // CPI to May 2026
  nextDecision: "2026-07-30",
  // Bank Rate path (history + light forward estimate)
  baseSeries: [
    { date: "2024-08", rate: 5.0 },
    { date: "2024-11", rate: 4.75 },
    { date: "2025-02", rate: 4.5 },
    { date: "2025-05", rate: 4.25 },
    { date: "2025-08", rate: 4.0 },
    { date: "2025-11", rate: 3.75 },
    { date: "2026-06", rate: 3.75 },
  ],
  // Average market fixes, June 2026 (Rightmove/Moneyfacts-style averages)
  avg2yrFix: 5.55,
  avg5yrFix: 5.54,
  fix2yrSeries: [
    { date: "2025-09", rate: 5.05 },
    { date: "2025-12", rate: 5.20 },
    { date: "2026-03", rate: 5.78 }, // Middle East shock pushed swaps up
    { date: "2026-05", rate: 5.78 },
    { date: "2026-06", rate: 5.55 }, // easing back
  ],
  yourRate: MORTGAGE.ratePct,
};

// -----------------------------------------------------------------------------
// Forward price forecast — annual % growth assumptions (London-leaning).
// Three scenarios; "base" drives the headline numbers. All editable via sliders.
// -----------------------------------------------------------------------------
export const FORECAST = {
  sources: ["savillsForecast", "knightFrank", "zooplaHPI"],
  note:
    "Consensus: a soft 2026 (Savills revised to -2%) then recovery from 2027 " +
    "(Knight Frank +3% 2027, +4% 2028; Savills +4% then +5%). London lags the UK " +
    "near-term but Knight Frank models ~13.6% cumulative London growth 2026–2030.",
  // Annual growth (%) applied from each calendar year.
  scenarios: {
    pessimistic: { 2026: -4.0, 2027: 0.0, 2028: 1.5, 2029: 2.5 },
    base: { 2026: -2.0, 2027: 3.0, 2028: 4.0, 2029: 5.0 },
    optimistic: { 2026: -1.0, 2027: 4.5, 2028: 5.5, 2029: 6.0 },
  },
  defaultScenario: "base",
};

// -----------------------------------------------------------------------------
// Letting (rent-it-out instead of selling) assumptions & tax treatment.
// Defaults are sourced; all are editable in the UI. Income tax matters a lot here.
// -----------------------------------------------------------------------------
export const LETTING = {
  sources: ["hpiMar2026", "budgetZoopla", "cgtRates"],
  note:
    "Islington average private rent was £2,811/mo in April 2026 (+4.0% YoY). Section 24 " +
    "means mortgage interest is NOT a deductible expense for individual landlords — instead " +
    "you get a 20% tax credit on the interest. From April 2027 the Budget raised property- " +
    "income tax rates by 2 points (to 22/42/47%). Letting your former home also erodes " +
    "Private Residence Relief, so part of the eventual gain becomes liable to CGT.",
  monthlyRent: 2811, // Islington average (Apr 2026); editable for your specific flat
  rentGrowthPct: 4.0, // annual; Islington rent YoY to Apr 2026
  voidMonthsPerYear: 1, // assume ~1 month vacant per year
  agentFeePct: 10, // full-management letting agent fee (% of rent), excl VAT
  agentVatPct: 20,
  maintenancePctOfRent: 5, // repairs/maintenance allowance
  insurancePerYear: 300, // landlord buildings/contents
  serviceChargeGroundRentPerYear: 3000, // LEASEHOLD FLAT estimate — please verify your bill
  selfManage: false, // if true, agentFee = 0
  // Letting usually needs consent-to-let or a buy-to-let remortgage (rates higher
  // than residential). Applied only after the current fix ends (Mar 2027).
  letMortgageRatePctAfterFix: 5.6,
  interestOnly: false, // BTL is often interest-only; false keeps capital & interest
  // Opportunity cost: if you sell now instead, what return do you assume on the cash?
  opportunityRatePct: 4.0,
};

// Income tax & CGT settings. Marginal band drives both rental-profit tax and the
// residential CGT rate. Default: higher-rate taxpayer.
export const TAX = {
  source: "cgtRates",
  marginalBand: "higher", // "basic" | "higher" | "additional"
  // Property-income tax rates by band (pre-April-2027 / post-April-2027 +2pts).
  incomeRates: {
    basic: { pre: 0.20, post: 0.22 },
    higher: { pre: 0.40, post: 0.42 },
    additional: { pre: 0.45, post: 0.47 },
  },
  raisedFrom: "2027-04-01", // landlord rate rise (Autumn Budget 2025)
  financeCreditPct: 20, // Section 24: 20% tax credit on mortgage interest
  // Residential-property CGT rates (2024/25+): basic 18%, higher/additional 24%.
  cgtRates: { basic: 0.18, higher: 0.24, additional: 0.24 },
  cgtAnnualExempt: 3000, // 2025/26 annual exempt amount
  finalPeriodExemptMonths: 9, // last 9 months of ownership always PRR-exempt
};

// -----------------------------------------------------------------------------
// Political / policy factors. Each has a `direction` for the user's situation
// (sub-£2m primary residence): +1 favourable, -1 unfavourable, 0 neutral.
// -----------------------------------------------------------------------------
export const POLICY_FACTORS = [
  {
    id: "mansionTax",
    title: "‘Mansion tax’ (High Value Council Tax Surcharge)",
    source: "budgetMansionTax",
    direction: +1,
    weightHint: "low",
    summary:
      "From April 2028, an annual surcharge (£2,500–£7,500) applies to homes valued over £2m. " +
      "Your flat (~£0.89m) is well below the threshold, so it is unaffected — but the policy " +
      "cools demand at the very top of the London market, which can ripple down over time.",
    effective: "2028-04-01",
  },
  {
    id: "landlordTax",
    title: "Landlord income tax rising +2% (from April 2027)",
    source: "budgetZoopla",
    direction: 0,
    weightHint: "low",
    summary:
      "Property-income tax rates rise by 2 points (to 22/42/47%) from April 2027. It does not " +
      "touch you as an owner-occupier, but it discourages buy-to-let investors — softening " +
      "investor demand for flats like yours while tightening rental supply.",
    effective: "2027-04-01",
  },
  {
    id: "stampDuty",
    title: "Stamp duty unchanged; nil-rate band back to £125k",
    source: "budgetZoopla",
    direction: 0,
    weightHint: "low",
    summary:
      "SDLT reform was ruled out for now, but the nil-rate band reverted to £125,000 in 2025, " +
      "raising buyers’ upfront costs versus 2024 and modestly dampening demand.",
    effective: "2025-04-01",
  },
  {
    id: "cgtExempt",
    title: "Primary residence — Capital Gains Tax exempt",
    source: "cgtPrivateResidence",
    direction: +1,
    weightHint: "high",
    summary:
      "As your only/main home, a sale qualifies for Private Residence Relief, so any gain is " +
      "normally free of Capital Gains Tax. This is the single biggest tax lever and it works in " +
      "your favour at any sale date — there is no CGT timing penalty for you.",
    effective: PROPERTY.purchaseDate,
  },
  {
    id: "macroRisk",
    title: "Middle East conflict — energy & swap-rate volatility",
    source: "boeJune2026",
    direction: -1,
    weightHint: "medium",
    summary:
      "The Bank flags the Middle East conflict and energy prices as the dominant risk to the " +
      "inflation outlook. It pushed mortgage swap rates up in spring 2026 and keeps the rate-cut " +
      "path uncertain — a downside risk to a near-term price recovery.",
    effective: "2026-06-01",
  },
];

// -----------------------------------------------------------------------------
// Seasonality — relative selling strength by month (1.0 = average). Flats peak in
// late spring / early summer. Used as a small timing tilt, not a price claim.
// -----------------------------------------------------------------------------
export const SEASONALITY = {
  source: "seasonalRightmove",
  note:
    "Feb–May are the strongest listing months (Rightmove: ~66% of Feb/Mar listings complete); " +
    "flats sell especially well in late spring / early summer as graduates and young " +
    "professionals enter the market. Index reflects buyer demand strength, not a price guarantee.",
  // Jan..Dec
  monthIndex: [0.92, 1.02, 1.10, 1.12, 1.10, 1.05, 0.98, 0.92, 1.00, 1.02, 0.95, 0.85],
};

// -----------------------------------------------------------------------------
// Candidate sell windows the model scores and ranks.
// -----------------------------------------------------------------------------
export const WINDOWS = [
  { id: "now", label: "Now (H2 2026)", date: "2026-09-01", peakMonth: 9 },
  { id: "spring2027", label: "Spring 2027", date: "2027-04-01", peakMonth: 4 },
  { id: "h2_2027", label: "H2 2027", date: "2027-10-01", peakMonth: 10 },
  { id: "spring2028", label: "Spring 2028", date: "2028-04-01", peakMonth: 4 },
];

// -----------------------------------------------------------------------------
// Factor weights for the composite sell-timing signal (must sum to 1.0).
// -----------------------------------------------------------------------------
export const FACTOR_WEIGHTS = {
  priceTrajectory: 0.30, // where is the flat's value heading by that window
  financingCost: 0.25, // your mortgage cost / ERC / remortgage exposure
  netProceeds: 0.20, // personal cash-in-hand after costs
  seasonality: 0.10, // demand strength in that window's month
  policyMacro: 0.15, // political / macro tailwinds & risks
};
