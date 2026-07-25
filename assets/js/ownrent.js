// =============================================================================
// ownrent.js  —  Own-vs-rent comparator (SECTION 3), pure functions
// -----------------------------------------------------------------------------
// Answers: "should we own this flat, or would renting the equivalent 2-bed in the
// area be better?" Uses REAL local rental data (market.js RENT) for the rent path.
//
// Two complementary reads:
//   1) Monthly cost — the economic monthly cost of OWNING (mortgage interest +
//      service charge + maintenance + opportunity cost of tied-up equity − expected
//      price appreciation; principal repayments are excluded, they are forced
//      saving, not a cost) versus the monthly RENT for the same flat.
//   2) Wealth over a horizon — start both people from "you own the flat today".
//      OWN: keep it, terminal wealth = net equity if sold at the horizon.
//      RENT: sell now, invest the net proceeds at the opportunity rate, pay rent.
//      Each year the cheaper option invests the surplus at the opportunity rate.
//      advantageOwn > 0 ⇒ owning is ahead. Mirrors the sell-vs-let engine's logic.
// All approximate and clearly flagged in the UI — not a substitute for advice.
// =============================================================================

import {
  monthlyPayment, balanceAfter, monthsBetween, valueMultiplier, sellingCosts,
  ymIndex, ymToISO,
} from "./finance.js?v=44";

// Net proceeds if the flat were sold on `dateISO` (cash in hand after clearing the
// mortgage, ERC while fixed, and selling costs; CGT 0 for a primary residence).
function netProceedsAt(property, mortgage, sellingCfg, value, dateISO) {
  const monthsPaid = monthsBetween(property.purchaseDate, dateISO);
  const outstanding = mortgage.repaymentType === "interest_only"
    ? mortgage.principal
    : balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaid);
  const idx = ymIndex(dateISO), fixIdx = ymIndex(mortgage.fixEndDate);
  const newFixEndIdx = fixIdx + Math.round((mortgage.remortgageFixYears || 0) * 12);
  let erc = 0;
  if (idx < fixIdx) erc = outstanding * (mortgage.ercPctWhileFixed / 100);
  else if (idx < newFixEndIdx) erc = outstanding * ((mortgage.remortgageErcPct || 0) / 100);
  const costs = sellingCosts(value, sellingCfg);
  return { net: value - outstanding - erc - costs.total, outstanding, erc, costs };
}

export function rentVsBuy(opts) {
  const {
    property, mortgage, sellingCfg, presentValue, presentISO,
    growthByYear, horizonISO, rentCfg, opportunityRatePct,
  } = opts;

  const io = mortgage.repaymentType === "interest_only";
  const opp = (opportunityRatePct || 0) / 100;

  // ---- starting positions ---------------------------------------------------
  const nowSale = netProceedsAt(property, mortgage, sellingCfg, presentValue, presentISO);
  const outstandingNow = nowSale.outstanding;
  const equityNow = presentValue - outstandingNow;

  // ---- monthly loop present -> horizon, in 12-month buckets -----------------
  const startIdx = ymIndex(presentISO);
  const endIdx = ymIndex(horizonISO);
  const fixIdx = ymIndex(mortgage.fixEndDate);
  const purchaseIdx = ymIndex(property.purchaseDate);
  const months = Math.max(0, endIdx - startIdx);

  // mortgage schedule (switch from fixed rate to remortgage rate at fix end)
  const monthsPaidStart = monthsBetween(property.purchaseDate, presentISO);
  let balance = io ? mortgage.principal
    : balanceAfter(mortgage.principal, mortgage.ratePct, mortgage.termYears, monthsPaidStart);
  const remTermYearsStart = Math.max(1, mortgage.termYears - monthsPaidStart / 12);
  let curRate = mortgage.ratePct;
  let payment = io ? balance * (curRate / 100 / 12) : monthlyPayment(balance, curRate, remTermYearsStart);
  let switched = false;

  let rentMonthly = rentCfg.monthlyRent;
  const scMonthly = (rentCfg.serviceChargePerYear || 0) / 12;
  const maintMonthly = (presentValue * (rentCfg.maintenancePctOfValue || 0) / 100) / 12;

  const years = [];
  let bucket = null;
  for (let k = 0; k < months; k++) {
    const idx = startIdx + k;
    if (k % 12 === 0) {
      if (bucket) years.push(bucket);
      bucket = { label: ymToISO(idx), months: 0, rent: 0, interest: 0, principal: 0,
                 mortgage: 0, serviceMaint: 0, ownCash: 0 };
      if (k > 0) rentMonthly *= 1 + (rentCfg.rentGrowthPct || 0) / 100;
    }
    // switch to remortgage rate once the fix ends
    if (!switched && idx >= fixIdx && !io) {
      curRate = mortgage.remortgageRatePctAssumed;
      const remYears = Math.max(1, mortgage.termYears - (idx - purchaseIdx) / 12);
      payment = monthlyPayment(balance, curRate, remYears);
      switched = true;
    } else if (!switched && idx >= fixIdx && io) {
      curRate = mortgage.remortgageRatePctAssumed;
      payment = balance * (curRate / 100 / 12);
      switched = true;
    }
    const interest = balance * (curRate / 100 / 12);
    const principalPaid = io ? 0 : Math.max(0, payment - interest);
    balance = Math.max(0, balance - principalPaid);

    bucket.rent += rentMonthly;
    bucket.interest += interest;
    bucket.principal += principalPaid;
    bucket.mortgage += interest + principalPaid;
    bucket.serviceMaint += scMonthly + maintMonthly;
    bucket.ownCash += interest + principalPaid + scMonthly + maintMonthly;
    bucket.months += 1;
  }
  if (bucket) years.push(bucket);

  // ---- terminal wealth ------------------------------------------------------
  const saleValueH = presentValue * valueMultiplier(property.purchaseDate, horizonISO, growthByYear, presentISO);
  const saleH = netProceedsAt(property, mortgage, sellingCfg, saleValueH, horizonISO);
  const equityAtH = saleH.net; // net equity if the owner sold at the horizon

  const yearsF = months / 12;
  // Each year the cheaper option invests the surplus at the opportunity rate to the
  // horizon. (rent − ownCash) accrues to the owner; a negative value accrues to renter.
  let surplusFV = 0;
  let elapsed = 0;
  for (const y of years) {
    elapsed += y.months / 12;
    const remaining = Math.max(0, yearsF - elapsed);
    surplusFV += (y.rent - y.ownCash) * Math.pow(1 + opp, remaining);
  }

  const wealthOwn = equityAtH + surplusFV;
  const wealthRent = nowSale.net * Math.pow(1 + opp, yearsF);
  const advantageOwn = wealthOwn - wealthRent;

  // ---- headline monthly economics (today) -----------------------------------
  const firstYear = years[0] || { interest: 0, months: 12 };
  const monthsIn1 = Math.max(1, firstYear.months);
  const interestMonthly = firstYear.interest / monthsIn1;
  const appreciationMonthly = presentValue * (growthAt(growthByYear, presentISO) / 100) / 12;
  const oppCostEquityMonthly = equityNow * opp / 12;
  const ownEconomicMonthly = interestMonthly + scMonthly + maintMonthly + oppCostEquityMonthly - appreciationMonthly;

  const fin = (x) => (Number.isFinite(x) ? x : 0);
  return {
    horizonISO, years: yearsF, yearsTable: years,
    equityNow: fin(equityNow), sellNowNet: fin(nowSale.net),
    monthly: {
      rent: fin(rentCfg.monthlyRent),
      interest: fin(interestMonthly),
      serviceMaint: fin(scMonthly + maintMonthly),
      oppCostEquity: fin(oppCostEquityMonthly),
      appreciation: fin(appreciationMonthly),
      ownEconomic: fin(ownEconomicMonthly),
      ownVsRent: fin(ownEconomicMonthly - rentCfg.monthlyRent),
    },
    terminal: {
      saleValueH: fin(saleValueH), equityAtH: fin(equityAtH),
      surplusFV: fin(surplusFV), wealthOwn: fin(wealthOwn), wealthRent: fin(wealthRent),
      advantageOwn: fin(advantageOwn),
    },
  };
}

// Annual growth (%) for the calendar year of an ISO date, from a scenario map.
function growthAt(growthByYear, dateISO) {
  const yr = parseInt(dateISO.slice(0, 4), 10);
  const keys = Object.keys(growthByYear);
  return growthByYear[yr] ?? growthByYear[keys[keys.length - 1]] ?? 0;
}
