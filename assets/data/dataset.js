// =============================================================================
// dataset.js  —  Curated, sourced market dataset for the London Flat forecaster
// -----------------------------------------------------------------------------
// Every figure below is a curated snapshot; each block carries its own `source`
// id (a short mnemonic label, e.g. "hpiMay2026") and a `note` so a human editor
// can see provenance at a glance.
// Anything forward-looking is flagged `estimate: true`. Edit freely — the app
// recomputes everything from this file. Values such as the BoE Bank Rate are
// curated snapshots here; update them and redeploy to refresh.
// =============================================================================

export const META = {
  asOf: "2026-09-01",
  build: "v102 · 2026-09-01", // bump on each change so the footer confirms the live build
};

// -----------------------------------------------------------------------------
// Your position — defaults from the scoping conversation. All editable in the UI.
// -----------------------------------------------------------------------------
export const PROPERTY = {
  postcode: "N1 7TX",
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
  asOf: "2026-08-04",
  note:
    "Actual SOLD prices, not asking prices or forecasts. Half of 1,931 N1 (Islington) Land " +
    "Registry sales (trailing 24 months, recalculated 4 Aug 2026) completed at £8,360–£11,850/m² " +
    "(interquartile range); the median is ~£9,930/m² (essentially flat vs the prior £8,350-£11,790 " +
    "read — a refresh, not a shift). A separate matched-sales analysis (EPC-linked, 620 sales) puts " +
    "the median higher at ~£10,600/m²; the gap is methodology (full distribution vs matched-sample), " +
    "not a contradiction. N1 flats were broadly flat in value over the year to March 2026, and the N1 " +
    "7TX postcode 12-month average sold price was ~£1.07m. Your flat is a 2020-built 2-bed/2-bath of " +
    "91.45 m², which typically sits in the upper half of the range (new-build premium, maturing with age).",
  // N1 sold price per square metre (Land Registry-derived).
  perSqm: { low: 8360, median: 9930, high: 11850 },
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
  // current ~4.75% 2yr fix with a modest easing assumption by spring 2027.
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
  source: "hpiJun2026",
  note:
    "Islington average price £673k (Mar 2025, revised) → £678k (Mar 2026, +0.7%) → £670k " +
    "(May 2026) → £673k (June 2026, latest UK HPI release, published 19 Aug 2026), as the Middle " +
    "East conflict's swap-rate shock pushed mortgage costs up over spring/summer 2026 and cooled " +
    "the market fast, before June's reading nudged back toward the purchase-month level. Islington " +
    "ALL-PROPERTY -8.1% YoY to June 2026 (a volatile mix-driven reading vs a £733k June-2025 base); " +
    "Islington FLATS -8.4% YoY (£560k avg) is the more representative read for your property type. " +
    "London-wide -2.5% YoY, easing from -3.7% in May. Index is anchored to your purchase month so " +
    "100 = £890,000.",
  anchorDate: "2025-03-01",
  // {date, islington, london} relative to Mar 2025 = 100
  series: [
    { date: "2025-03", islington: 100.0, london: 100.0 },
    { date: "2025-06", islington: 99.7, london: 99.4 },
    { date: "2025-09", islington: 99.4, london: 99.0 },
    { date: "2025-12", islington: 99.2, london: 98.4 },
    // Mar 2026 corrected to 100.7 from the confirmed £678,022 UK HPI average price
    // (673,478 base) — the prior 99.3 didn't match this dataset's own +0.9% note.
    { date: "2026-03", islington: 100.7, london: 97.9 },
    // 2026-05 was the newest published UK HPI month when added (released 22 Jul 2026),
    // since superseded by the confirmed 2026-06 point below; retained as a real reading,
    // not a placeholder. islington = confirmed £669,879 / £673,478 base. london is derived
    // by applying the same 2-month Islington % change to the last verified London point
    // (97.9) — no independently-confirmed May 2026 London £ figure was pulled this run,
    // so treat it as an estimate, not a raw index reading.
    { date: "2026-05", islington: 99.5, london: 96.7 },
    // 2026-06 is the newest published UK HPI month (released 19 Aug 2026). islington =
    // confirmed £673,384 / £673,478 base ≈ 100.0. london has no independently-confirmed
    // June 2026 London £ figure pulled this run either, so it's derived the same way as
    // the May point: apply the 1-month Islington % change to the last verified London
    // point (96.7) — an estimate, not a raw index reading.
    { date: "2026-06", islington: 100.0, london: 97.2 },
  ],
};

// -----------------------------------------------------------------------------
// Interest-rate history & the user's rate.
// -----------------------------------------------------------------------------
export const RATES = {
  source: "boeJuly2026",
  baseRateNow: 3.75, // BoE Bank Rate, held 30 Jul 2026 (6-3 vote); live-refreshable
  baseRateAsOf: "2026-07-30",
  // 2-year GBP interest-rate swap (SONIA) — the wholesale rate UK lenders price
  // fixed-rate mortgages and real-estate lending off. Sits above Bank Rate when
  // the market expects cuts to be slow; the key driver of fixed mortgage pricing.
  // Re-verified this run against bluegamma.io's 31 Aug 2026 17:00 London close:
  // 4.25%, up ~6bps from the prior 4.19% reading — a small, sub-threshold move (the
  // in-app alert fires at 10bps), consistent with the fresh 30 Aug US-Iran escalation
  // (see POLICY_FACTORS.macroRisk) nudging swaps back up after several weeks of
  // gradual easing. Note: investing.com's GBP 2yr IRS series is quoting ~30bps
  // higher over the same days (e.g. 4.54% on 31 Aug) — kept on bluegamma.io for
  // continuity with prior snapshots since that gap looks like a quoting-basis/staleness
  // issue on investing.com's side, not a real market split; flag for a closer look
  // if it persists.
  swap2yrNow: 4.25,
  swap2yrAsOf: "2026-08-31",
  // Current average 2-year fixed REMORTGAGE rate at ~70% LTV (the band that fits
  // this flat). Live-refreshed from Bank of England quoted mortgage rates,
  // interpolated between the published 60% and 75% LTV series. Snapshot fallback:
  // re-verified this run against the newly-published BoE IADB month (IUMBV37 60%
  // LTV = 4.68%, IUMBV34 75% LTV = 4.79%, both 2026-07-31, vs the prior 2026-06-30
  // reading of 4.76%/4.81%) — interpolated 70% LTV = 4.75%, down from 4.79%.
  remortgage70Now: 4.75,
  remortgage70AsOf: "2026-07",
  // Forecast 2-yr-fix path from the Bank of England OIS instantaneous forward
  // curve (month-end 2026-06, statistics/yield-curves). Change vs the current fix,
  // in percentage points, at ~2028 and ~2030: the 2-yr swap forward starting in T
  // years (avg instantaneous fwd over [T,T+2]) moves 4.02% (now) → 4.02% (2028) →
  // 4.24% (2030), i.e. broadly flat then edging up — so the fix holds ~4.75% now,
  // ~4.95% by 2030. Refresh from the monthly OIS spreadsheet. NOT re-pulled this run —
  // still June 2026 vintage; flag for next refresh.
  oisFix2yForecast: { asOf: "BoE OIS, Jun 2026", d30: 0.2 },
  // Previous CALENDAR-DAY values, so each badge can show a day-over-day % change.
  // The daily 08:00 routine rolls "*Now" into "*Prev" before writing the new value;
  // the Worker also supplies the prior day's figure for the live series.
  baseRatePrev: 3.75,
  remortgage70Prev: 4.79,
  swap2yrPrev: 4.19,
};

// -----------------------------------------------------------------------------
// Forward price forecast — annual % growth assumptions (London-leaning).
// Three scenarios; "base" drives the headline numbers. All editable via sliders.
// -----------------------------------------------------------------------------
export const FORECAST = {
  sources: ["savillsForecast", "savillsJune2026", "knightFrank", "zooplaHPI"],
  note:
    "Consensus: a soft 2026 (Savills -2%, Knight Frank +1.5%) then recovery from 2027. Savills' " +
    "June 2026 revision cut its 5-year cumulative forecast to 18.5% (from 22.2%): -2% (2026), " +
    "+2.5% (2027), +5% (2028), +6% (2029), +6% (2030). Knight Frank: +1.5% (2026), +3% (2027), " +
    "+4% (2028). 'Base' blends the two; London lags the UK near-term.",
  // Annual growth (%) applied from each calendar year.
  scenarios: {
    pessimistic: { 2026: -4.0, 2027: 0.0, 2028: 1.5, 2029: 2.5 },
    base: { 2026: -2.0, 2027: 2.75, 2028: 4.5, 2029: 5.5 },
    optimistic: { 2026: -1.0, 2027: 4.5, 2028: 5.5, 2029: 6.5 },
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
    "Islington average private rent was £2,854/mo in July 2026 (+5.9% YoY, ONS Price Index of " +
    "Private Rents borough breakdown, released 19 Aug 2026, up from £2,694 in July 2025) — the " +
    "latest borough-specific reading, up from £2,843/+5.4% the prior month. Section 24 means " +
    "mortgage interest is NOT a deductible expense for individual landlords — instead you get a 20% tax credit on " +
    "the interest. From April 2027 the Budget raised property-income tax rates by 2 points " +
    "(to 22/42/47%). Letting your former home also erodes Private Residence Relief, so part of " +
    "the eventual gain becomes liable to CGT.",
  monthlyRent: 2854, // Islington average (Jul 2026, ONS PIPR); editable for your specific flat
  rentGrowthPct: 5.9, // annual; Islington rent YoY to Jul 2026 (ONS)
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
    source: "boeJuly2026",
    direction: -1,
    weightHint: "medium",
    summary:
      "The conflict escalated again right at month-end. After a lull since late July, on 30 Aug " +
      "US forces struck two Iranian missile launchers on Larak Island (Strait of Hormuz), citing " +
      "IRGC preparations to fire sea-mine-carrying rockets into the strait; Iran retaliated hours " +
      "later with a missile/drone barrage ('Punishment of the Aggressor') on the Jordanian King " +
      "Hussein and Al Azraq air bases (Jordan's air defences say they intercepted the missiles) " +
      "and a claimed strike near a US-linked UAE base (UAE denies it was hit) — the first " +
      "US-Iran kinetic exchange in about a month. Brent crude jumped ~3% to ~$90.6-90.9/bbl and " +
      "European wholesale gas broke above €69/MWh, its highest since Jan 2023, on fears of " +
      "renewed LNG-export delays from the Gulf; both remain above the pre-conflict baseline. " +
      "CENTCOM says it has since de-mined the strait for safe commercial transit, a partial " +
      "de-escalation on the shipping side even as the direct-strike risk just resurfaced. This " +
      "sits on top of the 24 Aug 'Operation Economic Outcast' Iran-sanctions campaign (Treasury), " +
      "which markets had read as less severe than feared. The Bank called the conflict 'the " +
      "dominant source of uncertainty' for inflation at its 30 Jul hold (3 of 9 MPC members voted " +
      "to hike); the next decision is 17 Sep. It has pushed mortgage swap and fixed rates up " +
      "through summer 2026 (the 2yr swap ticked back up to 4.25% on the 30 Aug news — see " +
      "RATES.swap2yrNow) and cooled Islington prices sharply — a real downside risk that hasn't " +
      "resolved, with this week's events a reminder it can still flare without warning.",
    effective: "2026-08-30",
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
