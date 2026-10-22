/**
 * Domain types for the RRA e-Tax annexure pipeline.
 *
 * These types are intentionally framework-agnostic: the same engine runs in a
 * Next.js route handler, in the browser grid (instant re-validation) and in
 * Vitest.
 */

export const ANNEXURE_TYPES = ["SALES", "PURCHASES", "IMPORTS", "WHT"] as const;
export type AnnexureType = (typeof ANNEXURE_TYPES)[number];

export const VALIDATION_STATUSES = ["VALID", "WARNING", "ERROR"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

/** Canonical fields the sanitizer understands, regardless of source template. */
export type CanonicalField =
  | "invoiceNo"
  | "invoiceDate"
  | "counterpartyTin"
  | "counterpartyName"
  | "taxableAmountRwf"
  | "vatAmountRwf"
  | "mrcCode"
  | "currency"
  | "whtRate"
  | "purchaseType";

/** A row after normalization. `invoiceDate` is ISO (YYYY-MM-DD) internally. */
export interface AnnexureRow {
  id: string;
  /** 1-based ordinal in the source file (used for reconciliation with Excel). */
  rowNumber: number;
  invoiceNo: string;
  invoiceDate: string | null;
  counterpartyTin: string;
  counterpartyName: string;
  taxableAmountRwf: number | null;
  /** VAT amount for SALES/PURCHASES/IMPORTS, WHT amount for WHT annexure. */
  vatAmountRwf: number | null;
  mrcCode: string;
  currency: string;
  whtRate: number | null;
  purchaseType: "LOCAL" | "IMPORT" | "";
}

/** Raw record as parsed from CSV/XLSX before mapping (header -> cell value). */
export type RawRecord = Record<string, unknown>;

export interface ColumnMapping {
  [header: string]: CanonicalField | null;
}

export type AnnexureIssueCode =
  | "TIN_MISSING"
  | "TIN_INVALID"
  | "NAME_MISSING"
  | "INVOICE_NO_MISSING"
  | "INVOICE_NO_DUPLICATE"
  | "DATE_MISSING"
  | "DATE_INVALID"
  | "DATE_OUTSIDE_PERIOD"
  | "MRC_MISSING"
  | "MRC_INVALID"
  | "AMOUNT_MISSING"
  | "AMOUNT_NEGATIVE"
  | "AMOUNT_NOT_INTEGER"
  | "CURRENCY_NOT_RWF"
  | "VAT_MISMATCH"
  | "VAT_ROUNDING"
  | "WHT_RATE_INVALID"
  | "WHT_MISMATCH"
  | "WHT_ROUNDING"
  | "ROW_EMPTY";

export interface AnnexureIssue {
  code: AnnexureIssueCode;
  severity: "ERROR" | "WARNING";
  field: CanonicalField | "row";
  message: string;
  /** True when "Auto-Fix Rounding" (or inline edit) can resolve the issue. */
  autoFixable?: boolean;
}

export interface ValidatedAnnexureRow extends AnnexureRow {
  issues: AnnexureIssue[];
  status: ValidationStatus;
}

export interface AnnexureValidationOptions {
  /** When false (e.g. LUMP_SUM clients) VAT math is not enforced. */
  vatRegistered: boolean;
  /** 0.18 for standard Rwandan VAT. */
  vatRate: number;
  /** Allowed absolute gap between declared VAT and computed VAT, in RWF. */
  toleranceRwf: number;
  /** 'YYYY-MM' — flags invoices dated outside the period being declared. */
  periodMonth: string | null;
  requireRwf: boolean;
  enforceVatMath: boolean;
  /** How ambiguous 03/04/2026 dates are read. Rwanda uses DMY. */
  dateOrder: "DMY" | "MDY";
  requireMrc: boolean;
}

export const DEFAULT_ANNEXURE_OPTIONS: AnnexureValidationOptions = {
  vatRegistered: true,
  vatRate: 0.18,
  toleranceRwf: 1,
  periodMonth: null,
  requireRwf: true,
  enforceVatMath: true,
  dateOrder: "DMY",
  requireMrc: true,
};

export interface ParseIssue {
  rowNumber: number;
  message: string;
}

export interface AnnexureParseResult {
  annexureType: AnnexureType;
  fileName: string;
  sheetName: string | null;
  headers: string[];
  mapping: ColumnMapping;
  rows: AnnexureRow[];
  skippedRows: number;
  warnings: string[];
}

export interface AutoFixResult {
  rows: AnnexureRow[];
  fixedCount: number;
  changes: Array<{ rowNumber: number; field: CanonicalField; from: string; to: string }>;
}

export interface AnnexureTotals {
  rowCount: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  totalTaxableRwf: number;
  totalVatRwf: number;
  expectedVatRwf: number;
  varianceRwf: number;
}

export class AnnexureExportError extends Error {
  readonly issues: Array<{ rowNumber: number; issues: AnnexureIssue[] }>;

  constructor(message: string, issues: Array<{ rowNumber: number; issues: AnnexureIssue[] }>) {
    super(message);
    this.name = "AnnexureExportError";
    this.issues = issues;
  }
}
