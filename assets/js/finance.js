// =============================================================================
// finance.js  —  Personal mortgage & sale economics (pure functions, no DOM)
// -----------------------------------------------------------------------------
// IMPORTANT: all month arithmetic is done on plain integers parsed from the ISO
// strings — never via the Date object's setMonth/getMonth, which mix UTC parsing
// with local-time mutation and break (loop forever) in timezones behind UTC.
// =============================================================================

// Absolute month index from a "YYYY-MM" or "YYYY-MM-DD" string (year*12 + month0).
export function ymIndex(iso) {
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10);
  return y * 12 + (m - 1);
}
// Inverse: month index -> "YYYY-MM".
export function ymToISO(index) {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return y + "-" + String(m).padStart(2, "0");
}
// Calendar year from an ISO date string.
export function yearOfISO(iso) { return parseInt(iso.slice(0, 4), 10); }

// Months between two YYYY-MM-DD (or YYYY-MM) dates (integer, timezone-safe).
export function monthsBetween(fromISO, toISO) {
  return ymIndex(toISO) - ymIndex(fromISO);
}

// Standard amortised monthly payment.
export function monthlyPayment(principal, annualRatePct, termYears) {
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

// Outstanding balance after `monthsPaid` months of an amortising loan.
export function balanceAfter(principal, annualRatePct, termYears, monthsPaid) {
  const r = annualRatePct / 100 / 12;
  const pmt = monthlyPayment(principal, annualRatePct, termYears);
  if (r === 0) return Math.max(0, principal - pmt * monthsPaid);
  const bal = principal * Math.pow(1 + r, monthsPaid) - pmt * ((Math.pow(1 + r, monthsPaid) - 1) / r);
  return Math.max(0, bal);
}

// Build a year-by-year growth path and return a value multiplier at a target date,
// relative to a base value at baseDate. growthByYear: { 2026: -2.0, 2027: 3.0, ... }.
export function valueMultiplier(baseDate, targetDate, growthByYear, presentISO) {
  // Apply monthly-compounded annual growth from the *present* forward (integer
  // month math — timezone-safe). Before the present we trust the observed index.
  const startIdx = ymIndex(presentISO);
  const endIdx = ymIndex(targetDate);
  if (endIdx <= startIdx) return 1;
  const lastYearKey = Object.keys(growthByYear).slice(-1)[0];
  let mult = 1;
  for (let idx = startIdx; idx < endIdx; idx++) {
    const yr = Math.floor(idx / 12);
    const annual = (growthByYear[yr] ?? growthByYear[lastYearKey] ?? 0) / 100;
    const monthly = Math.pow(1 + annual, 1 / 12) - 1;
    mult *= 1 + monthly;
  }
  return mult;
}

// Estimated current value of the flat from the observed index (purchase = 100).
export function currentValueFromIndex(purchasePrice, priceSeries, key) {
  const last = priceSeries[priceSeries.length - 1];
  return purchasePrice * (last[key] / 100);
}

// Selling costs given a sale price.
export function sellingCosts(salePrice, cfg) {
  const agent = salePrice * (cfg.agentPct / 100) * (1 + cfg.vatPct / 100);
  return {
    agent,
    legal: cfg.legalFixed,
    misc: cfg.epcAndMiscFixed,
    total: agent + cfg.legalFixed + cfg.epcAndMiscFixed,
  };
}

// Capital Gains Tax on a straight sale.
//   • A main residence is fully exempt (Private Residence Relief) -> CGT = 0.
//   • A non-primary residence (never lived in / BTL) owes CGT on the whole gain,
//     net of acquisition costs, selling costs and the annual exempt amount.
// (The partial-PRR case — a former home later let out — is modelled separately in
//  letting.js, which apportions the gain by residence months.) cgtCfg is
//  { rate, annualExempt }; passing null leaves CGT at 0.
function saleCGT(property, saleValue, sellingCostsTotal, cgtCfg) {
  if (property.isPrimaryResidence || !cgtCfg) return 0;
  const acquisition = property.purchasePrice + (property.sdltPaid || 0) + (property.otherBuyCosts || 0);
  const gain = Math.max(0, saleValue - acquisition - (sellingCostsTotal || 0));
  const chargeable = Math.max(0, gain - (cgtCfg.annualExempt || 0));
  return chargeable * (cgtCfg.rate || 0);
}

// Early Repayment Charge at a given month-index — applies inside EITHER the
// current fix or the new fixed deal taken once the current fix ends (you'd
// remortgage into it).
export function ercAt(mortgage, atIdx, outstanding) {
  const fixIdx = ymIndex(mortgage.fixEndDate);
  const newFixEndIdx = fixIdx + Math.round((mortgage.remortgageFixYears || 0) * 12);
  if (atIdx < fixIdx) return outstanding * (mortgage.ercPctWhileFixed / 100);
  if (atIdx < newFixEndIdx) return outstanding * ((mortgage.remortgageErcPct || 0) / 100);
  return 0;
}

// Full economics of selling in a given window.
// Returns value, outstanding balance, ERC, selling costs, CGT, and net proceeds.
export function economicsForWindow(opts) {
  const {
    property, mortgage, sellingCfg, presentValue, presentISO,
    growthByYear, windowDate,
  } = opts;

  // 1) Projected sale value: present value grown forward by the scenario.
  const mult = valueMultiplier(property.purchaseDate, windowDate, growthByYear, presentISO);
  const saleValue = presentValue * mult;

  // 2) Outstanding mortgage balance at the window date.
  const monthsPaidAtFix = monthsBetween(property.purchaseDate, mortgage.fixEndDate);
  const monthsPaidAtWindow = monthsBetween(property.purchaseDate, windowDate);
  const insideFix = ymIndex(windowDate) < ymIndex(mortgage.fixEndDate);

  const io = mortgage.repaymentType === "interest_only";
  let outstanding;
  if (io) {
    outstanding = mortgage.principal; // interest-only: balance never reduces
  } else if (insideFix) {
    outstanding = balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtWindow);
  } else {
    // Pay at the fixed rate until the fix ends, then continue amortising the
    // remaining balance/term at the assumed remortgage rate.
    const balAtFix = balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtFix);
    const remainingTermYears = mortgage.termYears - monthsPaidAtFix / 12;
    const monthsAfterFix = monthsPaidAtWindow - monthsPaidAtFix;
    outstanding = balanceAfter(balAtFix, mortgage.remortgageRatePctAssumed, remainingTermYears, monthsAfterFix);
  }

  // 3) Early Repayment Charge — applies while inside EITHER the current fix or the
  //    new fixed deal taken when the current fix ends (you'd remortgage into it).
  const erc = ercAt(mortgage, ymIndex(windowDate), outstanding);

  // 4) Selling costs.
  const costs = sellingCosts(saleValue, sellingCfg);

  // 5) CGT — exempt for a primary residence (Private Residence Relief); a
  //    non-primary residence owes it on the gain (see saleCGT).
  const cgt = saleCGT(property, saleValue, costs.total, opts.cgtCfg);

  // 6) Net proceeds (cash in hand after clearing the mortgage and all costs).
  const net = saleValue - outstanding - erc - costs.total - cgt;

  return {
    windowDate, saleValue, outstanding, erc, costs, cgt, net, insideFix,
    valueMult: mult,
    equityGainVsPurchase: saleValue - property.purchasePrice,
  };
}

// Total mortgage INTEREST paid from purchase up to a sale date, accounting for the
// switch from the fixed rate to the assumed remortgage rate when the fix ends.
// interest = payments made − principal repaid, computed per rate phase so it stays
// consistent with economicsForWindow's outstanding-balance figure.
export function interestPaidToDate(mortgage, saleDateISO) {
  const io = mortgage.repaymentType === "interest_only";
  const monthsPaidAtFix = monthsBetween(mortgage._purchaseDate || mortgage.purchaseDate, mortgage.fixEndDate);
  const monthsPaidAtSale = monthsBetween(mortgage._purchaseDate || mortgage.purchaseDate, saleDateISO);
  if (monthsPaidAtSale <= 0) return 0;

  // Phase 1: purchase -> min(sale, fix end), at the fixed rate.
  const m1 = Math.min(monthsPaidAtSale, Math.max(0, monthsPaidAtFix));
  let interest = 0;
  if (io) {
    interest += mortgage.principal * (mortgage.ratePct / 100 / 12) * m1;
  } else if (m1 > 0) {
    const pay1 = monthlyPayment(mortgage.principal, mortgage.ratePct, mortgage.termYears);
    const bal1 = balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, m1);
    interest += pay1 * m1 - (mortgage.principal - bal1);
  }

  // Phase 2: fix end -> sale, at the assumed remortgage rate (only if held past the fix).
  const m2 = Math.max(0, monthsPaidAtSale - monthsPaidAtFix);
  if (m2 > 0) {
    const balAtFix = io
      ? mortgage.principal
      : balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtFix);
    const remRate = mortgage.remortgageRatePctAssumed;
    if (io) {
      interest += balAtFix * (remRate / 100 / 12) * m2;
    } else {
      const remTermYears = Math.max(1, mortgage.termYears - monthsPaidAtFix / 12);
      const pay2 = monthlyPayment(balAtFix, remRate, remTermYears);
      const bal2 = balanceAfter(balAtFix, remRate, remTermYears, m2);
      interest += pay2 * m2 - (balAtFix - bal2);
    }
  }
  return Math.max(0, interest);
}

// Cumulative market rent you would have paid to live in an equivalent flat from
// `fromISO` to `toISO` — the "rent saved" by owning instead of renting. Anchored so
// the most recent month equals `monthlyRent` (a current market level) and grown /
// discounted at `growthPct`/yr for earlier months. Timezone-safe integer month math.
export function rentPaidToDate(monthlyRent, growthPct, fromISO, toISO) {
  const months = monthsBetween(fromISO, toISO);
  if (months <= 0 || !(monthlyRent > 0)) return 0;
  const g = (growthPct || 0) / 100;
  const base = monthlyRent / Math.pow(1 + g, months / 12); // rent level at the first month
  let total = 0;
  for (let k = 0; k < months; k++) total += base * Math.pow(1 + g, k / 12);
  return total;
}

// Break-even sale price by a given sale date, for three cumulative recoup targets:
//   (i)   deposit only,
//   (ii)  deposit + SDLT + other buying costs,
//   (iii) deposit + SDLT + buying costs + mortgage interest paid to date.
// Each is the price at which net proceeds exactly return that cash after clearing
// the mortgage, ERC, agent fee (+VAT), legal, EPC and any CGT. Solving
// net(P*) = cashToRecoup for P*:
//   P*(1 − agentRate) = outstanding + ERC + legal + EPC + CGT + cashToRecoup
// where agentRate = agentPct·(1 + VAT/100). CGT is 0 for a primary residence; for
// a non-primary residence it depends on P* itself (the gain net of the agent fee),
// so we solve the fixed point by a few iterations.
// Each tier carries TWO scenarios: `recoup` (the pure cash-back price) and `vsRent`
// (the same target credited with the rent you'd otherwise have paid — a lower price,
// since owning has already saved you that rent). Returns all three tiers, the shared
// rentSaved figure, plus back-compat top-level fields for tier (iii)'s recoup price.
export function breakEvenRecoupAll(opts) {
  const { property, mortgage, sellingCfg, saleDateISO, cgtCfg, rentCfg } = opts;

  const deposit = Math.max(0, property.purchasePrice - mortgage.principal);
  const sdlt = property.sdltPaid || 0;
  const buyingCosts = property.otherBuyCosts || 0;
  const interestPaid = interestPaidToDate(mortgage, saleDateISO);

  // Rent you'd have paid renting an equivalent flat since purchase — a saving that
  // owning has already banked, so it lowers each break-even in the "vs renting" view.
  const purchaseISO = mortgage._purchaseDate || mortgage.purchaseDate || property.purchaseDate;
  const rentSaved = rentCfg ? rentPaidToDate(rentCfg.monthlyRent, rentCfg.growthPct, purchaseISO, saleDateISO) : 0;

  // Outstanding balance and ERC at the sale date (mirrors economicsForWindow).
  const io = mortgage.repaymentType === "interest_only";
  const purchaseDate = mortgage._purchaseDate || mortgage.purchaseDate;
  const monthsPaidAtFix = monthsBetween(purchaseDate, mortgage.fixEndDate);
  const monthsPaidAtSale = monthsBetween(purchaseDate, saleDateISO);
  const saleIdx = ymIndex(saleDateISO);
  const fixIdx = ymIndex(mortgage.fixEndDate);
  let outstanding;
  if (io) {
    outstanding = mortgage.principal;
  } else if (saleIdx < fixIdx) {
    outstanding = balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtSale);
  } else {
    const balAtFix = balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtFix);
    const remTermYears = Math.max(1, mortgage.termYears - monthsPaidAtFix / 12);
    outstanding = balanceAfter(balAtFix, mortgage.remortgageRatePctAssumed, remTermYears, monthsPaidAtSale - monthsPaidAtFix);
  }
  const erc = ercAt(mortgage, saleIdx, outstanding);

  const agentRate = (sellingCfg.agentPct / 100) * (1 + sellingCfg.vatPct / 100);
  const legal = sellingCfg.legalFixed || 0;
  const epc = sellingCfg.epcAndMiscFixed || 0;

  // Solve the break-even price for a given cash-recoup target. Every tier shares the
  // same sale-side costs (outstanding, ERC, agent fee, legal, EPC); only the cash to
  // return changes. CGT (0 for a main residence) depends on the price, which depends
  // on CGT, so we settle the fixed point in a few iterations.
  const solve = (cashToRecoup) => {
    let cgt = 0, price = 0;
    for (let it = 0; it < 6; it++) {
      price = (outstanding + erc + legal + epc + cgt + cashToRecoup) / (1 - agentRate);
      cgt = saleCGT(property, price, price * agentRate + legal + epc, cgtCfg);
    }
    const agentFee = price * agentRate;
    return {
      cashToRecoup, breakEvenPrice: price, cgt, agentFee,
      // sanity: net proceeds at this price should equal cashToRecoup
      netAtBreakEven: price - outstanding - erc - agentFee - legal - epc - cgt,
    };
  };

  // Each tier = a cash-recoup target solved two ways: the pure recoup, and the same
  // target credited with rent saved (floored at 0 so a break-even never dips below
  // what the sale must clear anyway). Three cumulative targets, cheapest first.
  const tier = (target) => ({
    target,
    recoup: solve(target),
    vsRent: solve(Math.max(0, target - rentSaved)),
  });
  const tiers = {
    deposit: tier(deposit),                                   // (i)   deposit only
    costs:   tier(deposit + sdlt + buyingCosts),              // (ii)  + SDLT + buying costs
    all:     tier(deposit + sdlt + buyingCosts + interestPaid), // (iii) + interest paid to date
  };
  const allTier = tiers.all.recoup;

  return {
    saleDateISO,
    tiers,
    rentSaved,
    inputs: { deposit, sdlt, buyingCosts, interestPaid, outstanding, erc, legal, epc, agentRate },
    // Back-compat: top-level fields describe the full recoup-all tier (iii), recoup scenario.
    breakEvenPrice: allTier.breakEvenPrice,
    cashToRecoup: allTier.cashToRecoup,
    components: { deposit, sdlt, buyingCosts, interestPaid, outstanding, erc, agentFee: allTier.agentFee, legal, epc, cgt: allTier.cgt },
    netAtBreakEven: allTier.netAtBreakEven,
  };
}

// Belt-and-braces against NaN/Infinity leaking into a result object.
export const fin = (x) => (Number.isFinite(x) ? x : 0);

// Monthly mortgage payment now vs. after remortgage — the "holding cost" signal.
export function holdingCostDelta(mortgage) {
  const io = mortgage.repaymentType === "interest_only";
  const now = io
    ? mortgage.principal * (mortgage.ratePct / 100 / 12)
    : monthlyPayment(mortgage.principal, mortgage.ratePct, mortgage.termYears);
  const monthsPaidAtFix = monthsBetween(mortgage._purchaseDate, mortgage.fixEndDate);
  const balAtFix = io
    ? mortgage.principal
    : balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtFix);
  const remainingTermYears = mortgage.termYears - monthsPaidAtFix / 12;
  const after = io
    ? balAtFix * (mortgage.remortgageRatePctAssumed / 100 / 12)
    : monthlyPayment(balAtFix, mortgage.remortgageRatePctAssumed, remainingTermYears);
  return { now, after, deltaMonthly: after - now, deltaAnnual: (after - now) * 12 };
}
