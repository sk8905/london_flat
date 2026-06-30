// =============================================================================
// finance.js  —  Personal mortgage & sale economics (pure functions, no DOM)
// =============================================================================

// Months between two YYYY-MM-DD (or YYYY-MM) dates.
export function monthsBetween(fromISO, toISO) {
  const a = new Date(fromISO.length === 7 ? fromISO + "-01" : fromISO);
  const b = new Date(toISO.length === 7 ? toISO + "-01" : toISO);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
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
  // Apply monthly-compounded annual growth from the *present* forward; before the
  // present we trust the observed index (handled by caller). Here we project from
  // `presentISO` to `targetDate`.
  const start = new Date((presentISO.length === 7 ? presentISO + "-01" : presentISO));
  const end = new Date((targetDate.length === 7 ? targetDate + "-01" : targetDate));
  if (end <= start) return 1;
  let mult = 1;
  const cur = new Date(start);
  while (cur < end) {
    const yr = cur.getFullYear();
    const annual = (growthByYear[yr] ?? growthByYear[Object.keys(growthByYear).slice(-1)[0]] ?? 0) / 100;
    const monthly = Math.pow(1 + annual, 1 / 12) - 1;
    mult *= 1 + monthly;
    cur.setMonth(cur.getMonth() + 1);
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
  const insideFix = new Date(windowDate) < new Date(mortgage.fixEndDate);

  let outstanding;
  if (insideFix) {
    outstanding = balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtWindow);
  } else {
    // Pay at the fixed rate until the fix ends, then continue amortising the
    // remaining balance/term at the assumed remortgage rate.
    const balAtFix = balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtFix);
    const remainingTermYears = mortgage.termYears - monthsPaidAtFix / 12;
    const monthsAfterFix = monthsPaidAtWindow - monthsPaidAtFix;
    outstanding = balanceAfter(balAtFix, mortgage.remortgageRatePctAssumed, remainingTermYears, monthsAfterFix);
  }

  // 3) Early Repayment Charge — only while inside the fixed period.
  const erc = insideFix ? outstanding * (mortgage.ercPctWhileFixed / 100) : 0;

  // 4) Selling costs.
  const costs = sellingCosts(saleValue, sellingCfg);

  // 5) CGT — exempt for a primary residence (Private Residence Relief).
  const cgt = property.isPrimaryResidence ? 0 : 0; // BTL handling could go here.

  // 6) Net proceeds (cash in hand after clearing the mortgage and all costs).
  const net = saleValue - outstanding - erc - costs.total - cgt;

  return {
    windowDate, saleValue, outstanding, erc, costs, cgt, net, insideFix,
    valueMult: mult,
    equityGainVsPurchase: saleValue - property.purchasePrice,
  };
}

// Monthly mortgage payment now vs. after remortgage — the "holding cost" signal.
export function holdingCostDelta(mortgage) {
  const now = monthlyPayment(mortgage.principal, mortgage.ratePct, mortgage.termYears);
  const monthsPaidAtFix = monthsBetween(
    // purchase->fix end uses dataset dates; caller passes via mortgage object owner
    mortgage._purchaseDate, mortgage.fixEndDate
  );
  const balAtFix = balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtFix);
  const remainingTermYears = mortgage.termYears - monthsPaidAtFix / 12;
  const after = monthlyPayment(balAtFix, mortgage.remortgageRatePctAssumed, remainingTermYears);
  return { now, after, deltaMonthly: after - now, deltaAnnual: (after - now) * 12 };
}
