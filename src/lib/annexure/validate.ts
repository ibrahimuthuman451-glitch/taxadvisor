import { ANNEXURE_FORMATS, expectedVatFor } from "./annexure-config";
import { isValidMrc, isValidTin, normalizeCurrency } from "./normalize";
import type {
  AnnexureRow,
  AnnexureTotals,
  AnnexureType,
  AnnexureValidationOptions,
  AnnexureIssue,
  AutoFixResult,
  CanonicalField,
  ValidatedAnnexureRow,
  ValidationStatus,
} from "./types";

const WHT_RATES = [3, 15];

function issue(
  code: AnnexureIssue["code"],
  severity: AnnexureIssue["severity"],
  field: CanonicalField | "row",
  message: string,
  autoFixable = false,
): AnnexureIssue {
  return { code, severity, field, message, autoFixable };
}

export function statusFor(issues: AnnexureIssue[]): ValidationStatus {
  if (issues.some((entry) => entry.severity === "ERROR")) return "ERROR";
  if (issues.length > 0) return "WARNING";
  return "VALID";
}

function hasField(type: AnnexureType, field: CanonicalField): boolean {
  return ANNEXURE_FORMATS[type].fields.some((spec) => spec.key === field);
}

/**
 * Validate a single normalized row. Pure and side-effect free so it can run on
 * every keystroke in the grid and in server-side export guards.
 */
export function validateRow(
  row: AnnexureRow,
  type: AnnexureType,
  options: AnnexureValidationOptions,
  context: { duplicateInvoiceNumbers?: Set<string> } = {},
): ValidatedAnnexureRow {
  const issues: AnnexureIssue[] = [];
  const format = ANNEXURE_FORMATS[type];

  // --- Invoice / receipt number -------------------------------------------
  if (!row.invoiceNo) {
    issues.push(
      issue("INVOICE_NO_MISSING", "ERROR", "invoiceNo", "Invoice/receipt number is required."),
    );
  } else if (
    type === "SALES" &&
    !/^[A-Za-z0-9][A-Za-z0-9/_-]{0,63}$/.test(row.invoiceNo)
  ) {
    issues.push(
      issue(
        "INVOICE_NO_MISSING",
        "WARNING",
        "invoiceNo",
        "Receipt number contains characters RRA may reject (allowed: letters, digits, / _ -).",
      ),
    );
  }
  if (row.invoiceNo && context.duplicateInvoiceNumbers?.has(row.invoiceNo)) {
    issues.push(
      issue(
        "INVOICE_NO_DUPLICATE",
        "WARNING",
        "invoiceNo",
        `Invoice number ${row.invoiceNo} appears more than once in this file.`,
      ),
    );
  }

  // --- TIN ----------------------------------------------------------------
  if (!row.counterpartyTin) {
    issues.push(issue("TIN_MISSING", "ERROR", "counterpartyTin", "TIN is required (9 digits)."));
  } else if (!isValidTin(row.counterpartyTin)) {
    issues.push(
      issue(
        "TIN_INVALID",
        "ERROR",
        "counterpartyTin",
        `TIN "${row.counterpartyTin}" is invalid — must be exactly 9 numeric digits (e.g. 102345678).`,
      ),
    );
  }

  // --- Name ---------------------------------------------------------------
  if (!row.counterpartyName) {
    issues.push(
      issue("NAME_MISSING", "ERROR", "counterpartyName", "Counterparty name is required."),
    );
  }

  // --- Date ---------------------------------------------------------------
  if (!row.invoiceDate) {
    issues.push(
      issue(
        "DATE_INVALID",
        "ERROR",
        "invoiceDate",
        "Date is missing or not a valid calendar date (expected DD/MM/YYYY).",
      ),
    );
  } else if (options.periodMonth && row.invoiceDate.slice(0, 7) !== options.periodMonth) {
    issues.push(
      issue(
        "DATE_OUTSIDE_PERIOD",
        "WARNING",
        "invoiceDate",
        `Invoice date ${row.invoiceDate} is outside the declared period ${options.periodMonth}.`,
      ),
    );
  }

  // --- MRC ----------------------------------------------------------------
  if (hasField(type, "mrcCode") && (options.requireMrc || row.mrcCode)) {
    if (!row.mrcCode) {
      issues.push(
        issue(
          "MRC_MISSING",
          "ERROR",
          "mrcCode",
          "MRC code is required — copy it from the EBM receipt (e.g. SDC0010000123/0001).",
        ),
      );
    } else if (!isValidMrc(row.mrcCode)) {
      issues.push(
        issue(
          "MRC_INVALID",
          "ERROR",
          "mrcCode",
          `MRC "${row.mrcCode}" is not formatted like SDC0010000123/0001.`,
        ),
      );
    }
  }

  // --- Currency -----------------------------------------------------------
  if (options.requireRwf && row.currency && normalizeCurrency(row.currency) !== "RWF") {
    issues.push(
      issue(
        "CURRENCY_NOT_RWF",
        "ERROR",
        "currency",
        `Declarations must be in RWF; found ${row.currency}. Convert before exporting.`,
      ),
    );
  }

  // --- Amounts ------------------------------------------------------------
  if (row.taxableAmountRwf === null) {
    issues.push(
      issue("AMOUNT_MISSING", "ERROR", "taxableAmountRwf", "Taxable amount is required."),
    );
  } else if (row.taxableAmountRwf < 0) {
    issues.push(
      issue(
        "AMOUNT_NEGATIVE",
        "WARNING",
        "taxableAmountRwf",
        "Negative taxable amount — confirm this is a credit note before filing.",
      ),
    );
  } else if (!Number.isInteger(row.taxableAmountRwf)) {
    issues.push(
      issue(
        "AMOUNT_NOT_INTEGER",
        "WARNING",
        "taxableAmountRwf",
        "RWF amounts must be whole integers; this will be rounded on export.",
        true,
      ),
    );
  }

  if (row.vatAmountRwf === null) {
    issues.push(
      issue("AMOUNT_MISSING", "ERROR", "vatAmountRwf", `${format.taxLabel} is required.`),
    );
  } else if (row.vatAmountRwf < 0) {
    issues.push(
      issue(
        "AMOUNT_NEGATIVE",
        "WARNING",
        "vatAmountRwf",
        `Negative ${format.taxLabel.toLowerCase()} — confirm this is a credit note.`,
      ),
    );
  } else if (!Number.isInteger(row.vatAmountRwf)) {
    issues.push(
      issue(
        "AMOUNT_NOT_INTEGER",
        "WARNING",
        "vatAmountRwf",
        `RWF ${format.taxLabel.toLowerCase()} must be a whole integer.`,
        true,
      ),
    );
  }

  // --- 18% VAT math (SALES / PURCHASES / IMPORTS) -------------------------
  if (
    format.vatApplicable &&
    options.enforceVatMath &&
    options.vatRegistered &&
    row.taxableAmountRwf !== null &&
    row.vatAmountRwf !== null
  ) {
    const expected = expectedVatFor(row.taxableAmountRwf, options.vatRate);
    if (expected !== null) {
      const gap = Math.round(row.vatAmountRwf) - expected;
      if (gap !== 0 && Math.abs(gap) <= options.toleranceRwf) {
        issues.push(
          issue(
            "VAT_ROUNDING",
            "WARNING",
            "vatAmountRwf",
            `VAT differs from 18% of taxable by ${Math.abs(gap)} RWF (within ±${options.toleranceRwf} tolerance). Expected ${expected} RWF.`,
            true,
          ),
        );
      } else if (Math.abs(gap) > options.toleranceRwf) {
        issues.push(
          issue(
            "VAT_MISMATCH",
            "ERROR",
            "vatAmountRwf",
            `VAT should be ${expected} RWF at 18% but ${Math.round(row.vatAmountRwf)} RWF is declared (gap ${gap} RWF > ±${options.toleranceRwf}).`,
            true,
          ),
        );
      }
    }
  }

  // --- WHT math (15% / 3%) ------------------------------------------------
  if (type === "WHT" && row.taxableAmountRwf !== null) {
    const rate = row.whtRate;
    if (rate === null || !WHT_RATES.includes(rate)) {
      issues.push(
        issue(
          "WHT_RATE_INVALID",
          "ERROR",
          "whtRate",
          "WHT rate must be 15 (services, rent, professional fees) or 3 (goods).",
        ),
      );
    } else if (row.vatAmountRwf !== null) {
      const expected = Math.round((row.taxableAmountRwf * rate) / 100);
      const gap = Math.round(row.vatAmountRwf) - expected;
      if (gap !== 0 && Math.abs(gap) <= options.toleranceRwf) {
        issues.push(
          issue(
            "WHT_ROUNDING",
            "WARNING",
            "vatAmountRwf",
            `WHT differs from ${rate}% of base by ${Math.abs(gap)} RWF. Expected ${expected} RWF.`,
            true,
          ),
        );
      } else if (Math.abs(gap) > options.toleranceRwf) {
        issues.push(
          issue(
            "WHT_MISMATCH",
            "ERROR",
            "vatAmountRwf",
            `WHT should be ${expected} RWF at ${rate}% but ${Math.round(row.vatAmountRwf)} RWF is declared.`,
            true,
          ),
        );
      }
    }
  }

  return { ...row, issues, status: statusFor(issues) };
}

export function validateRows(
  rows: AnnexureRow[],
  type: AnnexureType,
  options: AnnexureValidationOptions,
): ValidatedAnnexureRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.invoiceNo) counts.set(row.invoiceNo, (counts.get(row.invoiceNo) ?? 0) + 1);
  }
  const duplicateInvoiceNumbers = new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([invoiceNo]) => invoiceNo),
  );

  return rows.map((row) => validateRow(row, type, options, { duplicateInvoiceNumbers }));
}

export function computeTotals(
  rows: ValidatedAnnexureRow[],
  type: AnnexureType,
  options: AnnexureValidationOptions,
): AnnexureTotals {
  const totals = rows.reduce(
    (acc, row) => {
      acc.totalTaxableRwf += row.taxableAmountRwf ?? 0;
      acc.totalVatRwf += row.vatAmountRwf ?? 0;
      acc.validCount += row.status === "VALID" ? 1 : 0;
      acc.warningCount += row.status === "WARNING" ? 1 : 0;
      acc.errorCount += row.status === "ERROR" ? 1 : 0;
      return acc;
    },
    {
      rowCount: rows.length,
      validCount: 0,
      warningCount: 0,
      errorCount: 0,
      totalTaxableRwf: 0,
      totalVatRwf: 0,
      expectedVatRwf: 0,
      varianceRwf: 0,
    },
  );

  const format = ANNEXURE_FORMATS[type];
  totals.expectedVatRwf = format.vatApplicable
    ? Math.round(totals.totalTaxableRwf * options.vatRate)
    : totals.totalVatRwf;
  totals.varianceRwf = Math.round(totals.totalVatRwf) - totals.expectedVatRwf;
  return totals;
}


export type AutoFixMode = "rounding" | "recalculate";

/**
 * Auto-fix pass.
 *  - "rounding": only aligns gaps inside the ±tolerance band and rounds decimals.
 *  - "recalculate": recomputes every VAT/WHT amount from the taxable base
 *    (use when the source export has a systematically wrong tax column).
 */
export function autoFixRows(
  rows: AnnexureRow[],
  type: AnnexureType,
  options: AnnexureValidationOptions,
  mode: AutoFixMode = "rounding",
): AutoFixResult {
  const format = ANNEXURE_FORMATS[type];
  const changes: AutoFixResult["changes"] = [];
  let fixedCount = 0;

  const nextRows = rows.map((row) => {
    const next: AnnexureRow = { ...row };
    let rowChanged = false;

    if (next.taxableAmountRwf !== null && !Number.isInteger(next.taxableAmountRwf)) {
      changes.push({
        rowNumber: next.rowNumber,
        field: "taxableAmountRwf",
        from: String(next.taxableAmountRwf),
        to: String(Math.round(next.taxableAmountRwf)),
      });
      next.taxableAmountRwf = Math.round(next.taxableAmountRwf);
      rowChanged = true;
    }

    if (next.vatAmountRwf !== null && !Number.isInteger(next.vatAmountRwf)) {
      changes.push({
        rowNumber: next.rowNumber,
        field: "vatAmountRwf",
        from: String(next.vatAmountRwf),
        to: String(Math.round(next.vatAmountRwf)),
      });
      next.vatAmountRwf = Math.round(next.vatAmountRwf);
      rowChanged = true;
    }

    const base = next.taxableAmountRwf;
    const current = next.vatAmountRwf;

    if (
      format.vatApplicable &&
      options.enforceVatMath &&
      options.vatRegistered &&
      base !== null
    ) {
      const expected = expectedVatFor(base, options.vatRate);
      if (expected !== null) {
        const gap = current === null ? Number.POSITIVE_INFINITY : Math.abs(current - expected);
        const shouldFix =
          current === null ||
          (mode === "recalculate" ? gap > 0 : gap > 0 && gap <= options.toleranceRwf);
        if (shouldFix && next.vatAmountRwf !== expected) {
          changes.push({
            rowNumber: next.rowNumber,
            field: "vatAmountRwf",
            from: current === null ? "" : String(current),
            to: String(expected),
          });
          next.vatAmountRwf = expected;
          rowChanged = true;
        }
      }
    }

    if (
      type === "WHT" &&
      base !== null &&
      next.whtRate !== null &&
      WHT_RATES.includes(next.whtRate)
    ) {
      const expected = Math.round((base * next.whtRate) / 100);
      const gap = current === null ? Number.POSITIVE_INFINITY : Math.abs(current - expected);
      const shouldFix =
        current === null ||
        (mode === "recalculate" ? gap > 0 : gap > 0 && gap <= options.toleranceRwf);
      if (shouldFix && next.vatAmountRwf !== expected) {
        changes.push({
          rowNumber: next.rowNumber,
          field: "vatAmountRwf",
          from: current === null ? "" : String(current),
          to: String(expected),
        });
        next.vatAmountRwf = expected;
        rowChanged = true;
      }
    }

    if (rowChanged) fixedCount += 1;
    return next;
  });

  return { rows: nextRows, fixedCount, changes };
}

export function issueSummary(rows: ValidatedAnnexureRow[]): Map<string, number> {
  const summary = new Map<string, number>();
  for (const row of rows) {
    for (const entry of row.issues) {
      if (entry.severity !== "ERROR") continue;
      summary.set(entry.code, (summary.get(entry.code) ?? 0) + 1);
    }
  }
  return summary;
}

