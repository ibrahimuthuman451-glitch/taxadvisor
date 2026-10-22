import { sanitizeText } from "@/lib/annexure/normalize";
import type {
  DailyComparison,
  MatchedPurchasePair,
  ReconciliationOptions,
  ReconciliationResult,
  ReconciliationRiskItem,
  StatementTransaction,
  WeeklyComparison,
} from "./types";

const MS_PER_DAY = 86_400_000;

function dayDiff(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / MS_PER_DAY,
  );
}

function sumAmounts(transactions: StatementTransaction[]): number {
  return transactions.reduce((total, transaction) => total + transaction.amountRwf, 0);
}

function inPeriod(transaction: StatementTransaction, periodMonth: string | null): boolean {
  return !periodMonth || transaction.txDate.slice(0, 7) === periodMonth;
}

function weekStartIso(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function shiftIso(dateIso: string, days: number): string {
  return new Date(Date.parse(`${dateIso}T00:00:00Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

function nameSimilarity(left: string, right: string): number {
  const tokenize = (value: string) =>
    new Set(
      sanitizeText(value)
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length >= 3),
    );
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / Math.min(a.size, b.size);
}

/** 18/118 — VAT embedded in a gross RWF payment. */
export function inputVatFromGross(amountRwf: number): number {
  return Math.round((amountRwf * 18) / 118);
}

export function compareDaily(
  sales: StatementTransaction[],
  deposits: StatementTransaction[],
  options: ReconciliationOptions,
): DailyComparison[] {
  const salesByDay = new Map<string, number>();
  const depositsByDay = new Map<string, number>();

  for (const sale of sales) {
    salesByDay.set(sale.txDate, (salesByDay.get(sale.txDate) ?? 0) + sale.amountRwf);
  }
  for (const deposit of deposits) {
    depositsByDay.set(deposit.txDate, (depositsByDay.get(deposit.txDate) ?? 0) + deposit.amountRwf);
  }

  const dates = [...new Set([...salesByDay.keys(), ...depositsByDay.keys()])].sort();
  return dates.map((date) => {
    const ebmSalesRwf = Math.round(salesByDay.get(date) ?? 0);
    const depositsRwf = Math.round(depositsByDay.get(date) ?? 0);
    const varianceRwf = depositsRwf - ebmSalesRwf;
    const status =
      Math.abs(varianceRwf) <= options.revenueVarianceToleranceRwf
        ? "BALANCED"
        : varianceRwf > 0
          ? "DEPOSITS_EXCEED_SALES"
          : "SALES_EXCEED_DEPOSITS";
    return { date, ebmSalesRwf, depositsRwf, varianceRwf, status };
  });
}

export function compareWeekly(daily: DailyComparison[]): WeeklyComparison[] {
  const weeks = new Map<string, WeeklyComparison>();
  for (const day of daily) {
    const weekStart = weekStartIso(day.date);
    const week = weeks.get(weekStart) ?? {
      weekStart,
      weekEnd: shiftIso(weekStart, 6),
      ebmSalesRwf: 0,
      depositsRwf: 0,
      varianceRwf: 0,
      status: "BALANCED" as const,
    };
    week.ebmSalesRwf += day.ebmSalesRwf;
    week.depositsRwf += day.depositsRwf;
    week.varianceRwf = week.depositsRwf - week.ebmSalesRwf;
    week.status =
      week.varianceRwf === 0
        ? "BALANCED"
        : week.varianceRwf > 0
          ? "DEPOSITS_EXCEED_SALES"
          : "SALES_EXCEED_DEPOSITS";
    weeks.set(weekStart, week);
  }
  return [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}


export interface PurchaseMatchResult {
  matched: MatchedPurchasePair[];
  unmatchedPayouts: StatementTransaction[];
  unmatchedPurchases: StatementTransaction[];
}

/**
 * Greedy best-score matching of outgoing payments to confirmed EBM purchases.
 * A pair must be anchored by TIN, supplier name or an invoice reference, and
 * must agree on amount (±tolerance) and date (±window).
 */
export function matchPurchases(
  payouts: StatementTransaction[],
  purchases: StatementTransaction[],
  options: ReconciliationOptions,
): PurchaseMatchResult {
  interface Candidate {
    payoutIndex: number;
    purchaseIndex: number;
    score: number;
    amountGapRwf: number;
    dayGap: number;
  }

  const candidates: Candidate[] = [];
  const normalizeRef = (value: string) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();

  payouts.forEach((payout, payoutIndex) => {
    const payoutRef = normalizeRef(`${payout.referenceNo} ${payout.description}`);
    purchases.forEach((purchase, purchaseIndex) => {
      const tolerance = Math.max(
        options.amountToleranceRwf,
        purchase.amountRwf * options.amountTolerancePct,
      );
      const grossGap = Math.abs(payout.amountRwf - purchase.amountRwf);
      const netAmount = purchase.amountRwf - purchase.vatRwf;
      const netGap = Math.abs(payout.amountRwf - netAmount);
      const amountGapRwf = Math.min(grossGap, netGap);
      if (amountGapRwf > tolerance) return;

      const dayGap = Math.abs(dayDiff(payout.txDate, purchase.txDate));
      if (dayGap > options.dateWindowDays) return;

      let score = 0;
      let anchored = false;

      if (
        payout.counterpartyTin &&
        purchase.counterpartyTin &&
        payout.counterpartyTin === purchase.counterpartyTin
      ) {
        score += 60;
        anchored = true;
      }

      const similarity = nameSimilarity(payout.counterparty, purchase.counterparty);
      if (similarity >= 0.5) {
        score += Math.round(similarity * 30);
        anchored = true;
      }

      const purchaseRef = normalizeRef(purchase.referenceNo);
      if (purchaseRef.length >= 4 && payoutRef.includes(purchaseRef)) {
        score += 40;
        anchored = true;
      }

      if (!anchored) return;

      if (amountGapRwf === 0) score += 20;
      else if (amountGapRwf <= tolerance / 2) score += 10;
      score += dayGap === 0 ? 10 : dayGap <= 3 ? 6 : 2;

      candidates.push({ payoutIndex, purchaseIndex, score, amountGapRwf, dayGap });
    });
  });

  candidates.sort((a, b) => b.score - a.score || a.amountGapRwf - b.amountGapRwf);

  const usedPayouts = new Set<number>();
  const usedPurchases = new Set<number>();
  const matched: MatchedPurchasePair[] = [];

  for (const candidate of candidates) {
    if (candidate.score < 50) continue;
    if (usedPayouts.has(candidate.payoutIndex) || usedPurchases.has(candidate.purchaseIndex)) {
      continue;
    }
    const payout = payouts[candidate.payoutIndex];
    const purchase = purchases[candidate.purchaseIndex];
    if (!payout || !purchase) continue;
    usedPayouts.add(candidate.payoutIndex);
    usedPurchases.add(candidate.purchaseIndex);
    matched.push({
      payout,
      purchase,
      amountGapRwf: candidate.amountGapRwf,
      dayGap: candidate.dayGap,
      score: candidate.score,
    });
  }

  return {
    matched,
    unmatchedPayouts: payouts.filter((_, index) => !usedPayouts.has(index)),
    unmatchedPurchases: purchases.filter((_, index) => !usedPurchases.has(index)),
  };
}

export interface ReconcileInput {
  ebmSales: StatementTransaction[];
  ebmPurchases: StatementTransaction[];
  momo: StatementTransaction[];
  bank: StatementTransaction[];
  options: ReconciliationOptions;
}

export function reconcile({
  ebmSales,
  ebmPurchases,
  momo,
  bank,
  options,
}: ReconcileInput): ReconciliationResult {
  const sales = ebmSales.filter(
    (transaction) => transaction.direction === "SALE" && inPeriod(transaction, options.periodMonth),
  );
  const purchases = ebmPurchases.filter(
    (transaction) =>
      transaction.direction === "PURCHASE" && inPeriod(transaction, options.periodMonth),
  );
  const deposits = [...momo, ...bank].filter(
    (transaction) => transaction.direction === "IN" && inPeriod(transaction, options.periodMonth),
  );
  const payouts = [...momo, ...bank].filter(
    (transaction) => transaction.direction === "OUT" && inPeriod(transaction, options.periodMonth),
  );

  const daily = compareDaily(sales, deposits, options);
  const weekly = compareWeekly(daily);
  const matching = matchPurchases(payouts, purchases, options);

  const ebmSalesRwf = sumAmounts(sales);
  const depositsRwf = sumAmounts(deposits);
  const ebmPurchasesRwf = sumAmounts(purchases);
  const payoutsRwf = sumAmounts(payouts);
  const matchedPayoutsRwf = matching.matched.reduce(
    (total, pair) => total + pair.payout.amountRwf,
    0,
  );
  const unclaimedInputVatRwf = matching.unmatchedPurchases.reduce(
    (total, purchase) => total + purchase.vatRwf,
    0,
  );
  const missingPurchasePaymentRwf = sumAmounts(matching.unmatchedPayouts);
  const missingInputVatRwf = matching.unmatchedPayouts.reduce(
    (total, payout) => total + inputVatFromGross(payout.amountRwf),
    0,
  );

  const risks: ReconciliationRiskItem[] = [];

  for (const day of daily) {
    if (day.status !== "DEPOSITS_EXCEED_SALES") continue;
    risks.push({
      matchStatus: "UNINVOICED_REVENUE_RISK",
      source: "BANK_STATEMENT",
      txDate: day.date,
      referenceNo: `VAR-${day.date}`,
      description: `Aggregated MoMo + bank deposits exceeded EBM sales by RWF ${day.varianceRwf.toLocaleString("en-RW")}`,
      amountRwf: day.varianceRwf,
      counterparty: "Aggregated money movements",
      counterpartyTin: null,
      notes:
        "High audit risk: potential un-invoiced sales. Issue the missing EBM receipts and re-run reconciliation before the 15th.",
    });
  }

  for (const payout of matching.unmatchedPayouts) {
    risks.push({
      matchStatus: "MISSING_EBM_PURCHASE",
      source: payout.source,
      txDate: payout.txDate,
      referenceNo: payout.referenceNo,
      description: payout.description,
      amountRwf: payout.amountRwf,
      counterparty: payout.counterparty,
      counterpartyTin: payout.counterpartyTin,
      notes:
        "Payout has no matching confirmed EBM purchase. Obtain the supplier invoice and confirm it in EBM v2.1 to claim input VAT.",
    });
  }

  for (const purchase of matching.unmatchedPurchases) {
    risks.push({
      matchStatus: "UNCLAIMED_INPUT_VAT",
      source: "EBM_PURCHASE",
      txDate: purchase.txDate,
      referenceNo: purchase.referenceNo,
      description: purchase.description,
      amountRwf: purchase.amountRwf,
      counterparty: purchase.counterparty,
      counterpartyTin: purchase.counterpartyTin,
      notes: `Confirmed purchase has no matching bank/MoMo payout. Input VAT of RWF ${purchase.vatRwf.toLocaleString("en-RW")} is claimable if the expense is genuine and paid in cash.`,
    });
  }


  const dailyRiskRwf = daily
    .filter((day) => day.status === "DEPOSITS_EXCEED_SALES")
    .reduce((total, day) => total + day.varianceRwf, 0);

  const warnings: string[] = [];
  if (purchases.length === 0 && payouts.length > 0) {
    warnings.push(
      "No EBM confirmed purchases were uploaded — every payout will be flagged as missing an EBM invoice.",
    );
  }
  if (sales.length === 0 && deposits.length > 0) {
    warnings.push("No EBM sales were uploaded — all deposits will appear as un-invoiced revenue.");
  }
  if (deposits.length === 0 && sales.length > 0) {
    warnings.push(
      "No MoMo/bank inflows were found. Upload the merchant and bank statements to detect un-invoiced sales.",
    );
  }
  if (dailyRiskRwf > 0) {
    warnings.push(
      `Deposits exceed EBM sales by RWF ${dailyRiskRwf.toLocaleString("en-RW")} across ${
        daily.filter((day) => day.status === "DEPOSITS_EXCEED_SALES").length
      } day(s).`,
    );
  }
  if (matching.matched.some((pair) => pair.amountGapRwf > 0)) {
    warnings.push(
      "Some payouts matched an EBM invoice with an amount gap (fees, partial payment or withholding). Review the matched list.",
    );
  }

  const dropped =
    ebmSales.length -
    sales.length +
    (ebmPurchases.length - purchases.length) +
    (momo.length + bank.length - deposits.length - payouts.length);
  if (options.periodMonth && dropped > 0) {
    warnings.push(
      `${dropped} transaction(s) fall outside ${options.periodMonth} and were excluded from this reconciliation.`,
    );
  }

  return {
    options,
    totals: {
      ebmSalesRwf,
      ebmSalesCount: sales.length,
      depositsRwf,
      depositCount: deposits.length,
      uninvoicedVarianceRwf: Math.max(0, depositsRwf - ebmSalesRwf),
      dailyRiskRwf,
      ebmPurchasesRwf,
      ebmPurchasesCount: purchases.length,
      payoutsRwf,
      payoutCount: payouts.length,
      matchedPayoutsRwf,
      matchedCount: matching.matched.length,
      unclaimedInputVatRwf,
      unclaimedPurchaseCount: matching.unmatchedPurchases.length,
      missingPurchasePaymentRwf,
      missingPurchaseCount: matching.unmatchedPayouts.length,
      missingInputVatRwf,
      matchRatePct:
        payouts.length === 0
          ? 0
          : Math.round((matching.matched.length / payouts.length) * 1000) / 10,
    },
    daily,
    weekly,
    matchedPurchases: matching.matched,
    missingPurchases: matching.unmatchedPayouts,
    unclaimedPurchases: matching.unmatchedPurchases,
    deposits,
    payouts,
    risks,
    warnings,
    sources: {
      ebmSales: ebmSales.length,
      ebmPurchases: ebmPurchases.length,
      momo: momo.length,
      bank: bank.length,
    },
  };
}

