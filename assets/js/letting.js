// =============================================================================
// letting.js  —  Rent-it-out vs sell comparison (pure functions, UK tax aware)
// -----------------------------------------------------------------------------
// Models "keep it and let it" against "sell now and hold the cash", over a chosen
// horizon. Income tax follows the UK rules that bite hardest here:
//   • Section 24: mortgage interest is NOT a deductible expense for individual
//     landlords — instead a 20% tax *credit* on the interest.
//   • Autumn Budget 2025: property-income tax rates +2pts from April 2027.
//   • Letting a former home erodes Private Residence Relief, so part of the gain
//     at eventual sale becomes chargeable to CGT (final 9 months always exempt).
// All approximate and clearly flagged in the UI — not a substitute for an adviser.
// =============================================================================

import { monthlyPayment, balanceAfter, monthsBetween, valueMultiplier, sellingCosts } from "./finance.js";

const addMonthsISO = (iso, n) => {
  const d = new Date((iso.length === 7 ? iso + "-01" : iso));
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 7);
};

// Build a month-by-month mortgage schedule from `fromISO` to `toISO`, handling the
// switch from the residential fix to the post-fix (let/BTL) rate at fixEndDate.
export function scheduleInterest(mortgage, letCfg, fromISO, toISO) {
  const monthsPaidAtStart = monthsBetween(mortgage._purchaseDate, fromISO);
  let balance = balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtStart);
  let cur = fromISO.slice(0, 7);
  const fixEnd = mortgage.fixEndDate.slice(0, 7);
  const months = [];

  // payment under the current (fixed) rate, on remaining term
  const remTermYears = mortgage.termYears - monthsPaidAtStart / 12;
  let curRate = mortgage.ratePct;
  let payment = mortgage.interestOnly
    ? balance * (curRate / 100 / 12)
    : monthlyPayment(balance, curRate, remTermYears);
  let switched = false;

  let guard = 0;
  while (cur < toISO.slice(0, 7) && guard++ < 1200) {
    // switch to let/BTL rate once the fix ends
    if (!switched && cur >= fixEnd) {
      curRate = letCfg.letMortgageRatePctAfterFix;
      const remYears = mortgage.termYears - monthsBetween(mortgage._purchaseDate, cur) / 12;
      payment = letCfg.interestOnly
        ? balance * (curRate / 100 / 12)
        : monthlyPayment(balance, curRate, Math.max(1, remYears));
      switched = true;
    }
    const interest = balance * (curRate / 100 / 12);
    const principalPaid = letCfg.interestOnly ? 0 : Math.max(0, payment - interest);
    balance = Math.max(0, balance - principalPaid);
    months.push({ monthISO: cur, interest, principalPaid, payment: interest + principalPaid, balance, rate: curRate });
    cur = addMonthsISO(cur, 1);
  }
  return { months, endBalance: balance };
}

const taxYearRate = (TAX, band, monthISO) =>
  monthISO >= TAX.raisedFrom.slice(0, 7) ? TAX.incomeRates[band].post : TAX.incomeRates[band].pre;

// Full rent-vs-sell comparison.
export function rentVsSell(opts) {
  const { property, mortgage, sellingCfg, presentValue, presentISO,
          growthByYear, saleDate, letCfg, TAX, sellNowNet } = opts;

  const band = TAX.marginalBand;
  const agentPct = letCfg.selfManage ? 0 : letCfg.agentFeePct * (1 + letCfg.agentVatPct / 100);

  const sched = scheduleInterest({ ...mortgage, interestOnly: false, _purchaseDate: property.purchaseDate },
    letCfg, presentISO, saleDate);

  // ---- monthly rental cash flow & tax, grouped into 12-month buckets ---------
  const startMonths = monthsBetween(property.purchaseDate, presentISO);
  let monthIdx = 0, rentMonthly = letCfg.monthlyRent;
  const years = [];
  let bucket = null;

  for (const m of sched.months) {
    if (monthIdx % 12 === 0) {
      if (bucket) years.push(bucket);
      bucket = { label: m.monthISO, grossRent: 0, opex: 0, interest: 0, principal: 0,
                 mortgagePaid: 0, taxableProfit: 0, tax: 0, netCashFlow: 0 };
      // bump rent annually
      if (monthIdx > 0) rentMonthly *= 1 + letCfg.rentGrowthPct / 100;
    }
    const voidFactor = 1 - letCfg.voidMonthsPerYear / 12;
    const effRent = rentMonthly * voidFactor;
    const agentFee = effRent * (agentPct / 100);
    const maintenance = effRent * (letCfg.maintenancePctOfRent / 100);
    const opex = agentFee + maintenance + letCfg.insurancePerYear / 12 + letCfg.serviceChargeGroundRentPerYear / 12;

    bucket.grossRent += effRent;
    bucket.opex += opex;
    bucket.interest += m.interest;
    bucket.principal += m.principalPaid;
    bucket.mortgagePaid += m.payment;
    monthIdx++;
  }
  if (bucket) years.push(bucket);

  // compute tax per year (Section 24)
  let cumNet = 0;
  for (const y of years) {
    y.taxableProfit = y.grossRent - y.opex; // interest NOT deductible
    const rate = taxYearRate(TAX, band, y.label);
    const grossTax = Math.max(0, y.taxableProfit) * rate;
    const financeCredit = y.interest * (TAX.financeCreditPct / 100);
    y.tax = Math.max(0, grossTax - financeCredit);
    y.netCashFlow = y.grossRent - y.opex - y.mortgagePaid - y.tax;
    cumNet += y.netCashFlow;
    y.cumNet = cumNet;
  }
  const cumulativeNetRent = cumNet;

  // ---- sale at the horizon (with partial-PRR CGT) ---------------------------
  const saleValue = presentValue * valueMultiplier(property.purchaseDate, saleDate, growthByYear, presentISO);
  const costs = sellingCosts(saleValue, sellingCfg);
  const outstanding = sched.endBalance;
  // ERC: only if the horizon is still inside the fix (unlikely) — reuse 1% rule.
  const insideFix = new Date(saleDate) < new Date(mortgage.fixEndDate);
  const erc = insideFix ? outstanding * (mortgage.ercPctWhileFixed / 100) : 0;

  // CGT — partial Private Residence Relief.
  const monthsOwned = monthsBetween(property.purchaseDate, saleDate);
  const monthsAsResidence = startMonths; // lived in it from purchase until letting begins (now)
  const exemptMonths = Math.min(monthsOwned, monthsAsResidence + TAX.finalPeriodExemptMonths);
  const chargeableFraction = Math.max(0, (monthsOwned - exemptMonths) / monthsOwned);
  const totalGain = Math.max(0, saleValue - property.purchasePrice - costs.total);
  const chargeableGain = Math.max(0, totalGain * chargeableFraction - TAX.cgtAnnualExempt);
  const cgt = chargeableGain * (TAX.cgtRates[band] || 0.24);

  const netSaleProceeds = saleValue - outstanding - erc - costs.total - cgt;

  // ---- totals & comparison --------------------------------------------------
  const years_f = monthsOwned > startMonths ? (monthsBetween(presentISO, saleDate) / 12) : 0;
  const letTotal = cumulativeNetRent + netSaleProceeds;
  const sellNowGrown = sellNowNet * Math.pow(1 + letCfg.opportunityRatePct / 100, years_f);

  return {
    saleDate, years: years_f,
    yearsTable: years,
    cumulativeNetRent,
    sale: { saleValue, outstanding, erc, costs, cgt, chargeableFraction, netSaleProceeds,
            monthsAsResidence, monthsOwned, exemptMonths, totalGain, chargeableGain },
    letTotal,
    sellNowNet,
    sellNowGrown,
    advantageLet: letTotal - sellNowGrown,
    band,
  };
}
