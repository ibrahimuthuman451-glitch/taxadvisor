/**
 * Reconciliation domain contracts (Module 2).
 *
 * All amounts are positive magnitudes in RWF; direction captures the sign.
 * Dates are ISO (YYYY-MM-DD), same as the annexure engine.
 */

export type StatementSource = "EBM_SALE" | "EBM_PURCHASE" | "MOMO_STATEMENT" | "BANK_STATEMENT";

export type StatementDirection = "IN" | "OUT" | "SALE" | "PURCHASE";

export type MatchStatus =
  | "MATCHED"
  | "UNINVOICED_REVENUE_RISK"
  | "MISSING_EBM_PURCHASE"
  | "UNCLAIMED_INPUT_VAT"
  | "UNMATCHED";

export interface StatementTransaction {
  id: string;
  source: StatementSource;
  direction: StatementDirection;
  txDate: string; // ISO YYYY-MM-DD
  referenceNo: string;
  description: string;
  counterparty: string;
  counterpartyTin: string | null;
  amountRwf: number;
  /** VAT contained in an EBM purchase (0 when unknown). */
  vatRwf: number;
}

export interface StatementParseIssue {
  rowNumber: number;
  message: string;
}

export interface StatementParseResult {
  source: StatementSource;
  fileName: string;
  headers: string[];
  transactions: StatementTransaction[];
  skippedRows: number;
  issues: StatementParseIssue[];
  warnings: string[];
}

export interface ReconciliationOptions {
  /** Only reconcile transactions inside this 'YYYY-MM' period (null = all). */
  periodMonth: string | null;
  /** Bank/MoMo payout → EBM purchase date window, in days. */
  dateWindowDays: number;
  /** Relative amount tolerance for purchase matching (0.01 = 1%). */
  amountTolerancePct: number;
  /** Absolute amount tolerance floor in RWF. */
  amountToleranceRwf: number;
  /** Deposits must exceed EBM sales by more than this to be a risk. */
  revenueVarianceToleranceRwf: number;
}

export const DEFAULT_RECONCILIATION_OPTIONS: ReconciliationOptions = {
  periodMonth: null,
  dateWindowDays: 7,
  amountTolerancePct: 0.01,
  amountToleranceRwf: 500,
  revenueVarianceToleranceRwf: 0,
};

export interface DailyComparison {
  date: string;
  ebmSalesRwf: number;
  depositsRwf: number;
  varianceRwf: number;
  status: "BALANCED" | "DEPOSITS_EXCEED_SALES" | "SALES_EXCEED_DEPOSITS";
}

export interface WeeklyComparison {
  weekStart: string;
  weekEnd: string;
  ebmSalesRwf: number;
  depositsRwf: number;
  varianceRwf: number;
  status: "BALANCED" | "DEPOSITS_EXCEED_SALES" | "SALES_EXCEED_DEPOSITS";
}

export interface MatchedPurchasePair {
  payout: StatementTransaction;
  purchase: StatementTransaction;
  amountGapRwf: number;
  dayGap: number;
  score: number;
}

export interface ReconciliationTotals {
  ebmSalesRwf: number;
  ebmSalesCount: number;
  depositsRwf: number;
  depositCount: number;
  /** Aggregate un-invoiced revenue risk (deposits above EBM sales). */
  uninvoicedVarianceRwf: number;
  /** Sum of positive day-level gaps — what to chase before month close. */
  dailyRiskRwf: number;
  ebmPurchasesRwf: number;
  ebmPurchasesCount: number;
  payoutsRwf: number;
  payoutCount: number;
  matchedPayoutsRwf: number;
  matchedCount: number;
  /** EBM purchases never matched to a payment (still claimable). */
  unclaimedInputVatRwf: number;
  unclaimedPurchaseCount: number;
  /** Payments with no confirmed EBM invoice. */
  missingPurchasePaymentRwf: number;
  missingPurchaseCount: number;
  /** 18/118 estimate of input VAT locked in unmatched payouts. */
  missingInputVatRwf: number;
  matchRatePct: number;
}

export interface ReconciliationRiskItem {
  matchStatus: Extract<
    MatchStatus,
    "UNINVOICED_REVENUE_RISK" | "MISSING_EBM_PURCHASE" | "UNCLAIMED_INPUT_VAT"
  >;
  source: StatementSource;
  txDate: string;
  referenceNo: string;
  description: string;
  amountRwf: number;
  counterparty: string;
  counterpartyTin: string | null;
  notes: string;
}

export interface ReconciliationResult {
  options: ReconciliationOptions;
  totals: ReconciliationTotals;
  daily: DailyComparison[];
  weekly: WeeklyComparison[];
  matchedPurchases: MatchedPurchasePair[];
  missingPurchases: StatementTransaction[];
  unclaimedPurchases: StatementTransaction[];
  deposits: StatementTransaction[];
  payouts: StatementTransaction[];
  risks: ReconciliationRiskItem[];
  warnings: string[];
  sources: {
    ebmSales: number;
    ebmPurchases: number;
    momo: number;
    bank: number;
  };
}
