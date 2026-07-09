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

import {
  monthlyPayment, balanceAfter, monthsBetween, valueMultiplier, sellingCosts,
  ymIndex, ymToISO,
} from "./finance.js?v=36";

// Build a month-by-month mortgage schedule from `fromISO` to `toISO`, handling the
// switch from the residential fix to the post-fix (let/BTL) rate at fixEndDate.
// Uses integer month indices (timezone-safe — no Date.setMonth).
export function scheduleInterest(mortgage, letCfg, fromISO, toISO) {
  const monthsPaidAtStart = monthsBetween(mortgage._purchaseDate, fromISO);
  let balance = balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidAtStart);
  const startIdx = ymIndex(fromISO), endIdx = ymIndex(toISO), fixIdx = ymIndex(mortgage.fixEndDate);
  const purchaseIdx = ymIndex(mortgage._purchaseDate);
  const months = [];

  // payment under the current (fixed) rate, on remaining term
  const remTermYears = mortgage.termYears - monthsPaidAtStart / 12;
  let curRate = mortgage.ratePct;
  let payment = mortgage.interestOnly
    ? balance * (curRate / 100 / 12)
    : monthlyPayment(balance, curRate, remTermYears);
  let switched = false;

  for (let idx = startIdx; idx < endIdx; idx++) {
    // switch to let/BTL rate once the fix ends
    if (!switched && idx >= fixIdx) {
      curRate = letCfg.letMortgageRatePctAfterFix;
      const remYears = mortgage.termYears - (idx - purchaseIdx) / 12;
      payment = letCfg.interestOnly
        ? balance * (curRate / 100 / 12)
        : monthlyPayment(balance, curRate, Math.max(1, remYears));
      switched = true;
    }
    const interest = balance * (curRate / 100 / 12);
    const principalPaid = letCfg.interestOnly ? 0 : Math.max(0, payment - interest);
    balance = Math.max(0, balance - principalPaid);
    months.push({ monthISO: ymToISO(idx), interest, principalPaid, payment: interest + principalPaid, balance, rate: curRate });
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

  const sched = scheduleInterest({ ...mortgage, interestOnly: !!letCfg.interestOnly, _purchaseDate: property.purchaseDate },
    letCfg, presentISO, saleDate);

  // ---- monthly rental cash flow & tax, grouped into 12-month buckets ---------
  const startMonths = monthsBetween(property.purchaseDate, presentISO);
  let monthIdx = 0, rentMonthly = letCfg.monthlyRent;
  const years = [];
  let bucket = null;

  for (const m of sched.months) {
    if (monthIdx % 12 === 0) {
      if (bucket) years.push(bucket);
      bucket = { label: m.monthISO, months: 0, grossRent: 0, opex: 0, interest: 0, principal: 0,
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
    bucket.months += 1;
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
  const cumulativePrincipal = years.reduce((s, y) => s + y.principal, 0); // equity built via repayments
  const cumulativeInterest = years.reduce((s, y) => s + y.interest, 0);
  const cumulativeTax = years.reduce((s, y) => s + y.tax, 0);

  // ---- sale at the horizon (with partial-PRR CGT) ---------------------------
  const saleValue = presentValue * valueMultiplier(property.purchaseDate, saleDate, growthByYear, presentISO);
  const costs = sellingCosts(saleValue, sellingCfg);
  const outstanding = sched.endBalance;
  // ERC: applies inside the current fix OR the new remortgage fix taken after it.
  const saleIdx = ymIndex(saleDate);
  const fixIdx = ymIndex(mortgage.fixEndDate);
  const newFixEndIdx = fixIdx + Math.round((mortgage.remortgageFixYears || 0) * 12);
  let erc = 0;
  if (saleIdx < fixIdx) erc = outstanding * (mortgage.ercPctWhileFixed / 100);
  else if (saleIdx < newFixEndIdx) erc = outstanding * ((mortgage.remortgageErcPct || 0) / 100);

  // CGT — partial Private Residence Relief.
  const monthsOwned = monthsBetween(property.purchaseDate, saleDate);
  const monthsAsResidence = startMonths; // lived in it from purchase until letting begins (now)
  const exemptMonths = Math.min(monthsOwned, monthsAsResidence + TAX.finalPeriodExemptMonths);
  const chargeableFraction = Math.max(0, (monthsOwned - exemptMonths) / monthsOwned);
  // Acquisition cost base includes SDLT and other buying costs (they reduce the gain).
  const acquisitionCost = property.purchasePrice + (property.sdltPaid || 0) + (property.otherBuyCosts || 0);
  const totalGain = Math.max(0, saleValue - acquisitionCost - costs.total);
  const chargeableGain = Math.max(0, totalGain * chargeableFraction - TAX.cgtAnnualExempt);
  const cgt = chargeableGain * (TAX.cgtRates[band] || 0.24);

  const netSaleProceeds = saleValue - outstanding - erc - costs.total - cgt;

  // ---- totals & comparison --------------------------------------------------
  // Guard the horizon length so a bad date can't blow up the opportunity-cost
  // exponent (clamped to a sane 0–10 years).
  const years_f = monthsOwned > startMonths
    ? Math.max(0, Math.min(10, monthsBetween(presentISO, saleDate) / 12)) : 0;
  const letTotal = cumulativeNetRent + netSaleProceeds;
  const sellNowGrown = sellNowNet * Math.pow(1 + letCfg.opportunityRatePct / 100, years_f);

  const fin = (x) => (Number.isFinite(x) ? x : 0); // belt-and-braces against NaN/Infinity
  return {
    saleDate, years: years_f,
    yearsTable: years,
    cumulativeNetRent: fin(cumulativeNetRent), cumulativePrincipal: fin(cumulativePrincipal),
    cumulativeInterest: fin(cumulativeInterest), cumulativeTax: fin(cumulativeTax),
    interestOnly: !!letCfg.interestOnly,
    sale: { saleValue: fin(saleValue), outstanding: fin(outstanding), erc: fin(erc), costs, cgt: fin(cgt),
            chargeableFraction, netSaleProceeds: fin(netSaleProceeds),
            monthsAsResidence, monthsOwned, exemptMonths, totalGain: fin(totalGain), chargeableGain: fin(chargeableGain) },
    letTotal: fin(letTotal),
    sellNowNet: fin(sellNowNet),
    sellNowGrown: fin(sellNowGrown),
    advantageLet: fin(letTotal - sellNowGrown),
    band,
  };
}
