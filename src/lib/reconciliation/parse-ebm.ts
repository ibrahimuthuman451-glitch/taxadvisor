import { parseAnnexureFile } from "@/lib/annexure/parse-workbook";
import type { AnnexureType } from "@/lib/annexure/types";
import type { StatementParseIssue, StatementSource, StatementTransaction } from "./types";

export interface ParseEbmParams {
  buffer: ArrayBuffer;
  fileName: string;
  kind: "SALES" | "PURCHASES";
}

export interface ParseEbmResult {
  transactions: StatementTransaction[];
  skippedRows: number;
  issues: StatementParseIssue[];
  warnings: string[];
  headers: string[];
}

/**
 * EBM sales/purchases adapter: reuses the annexure column auto-mapping so an
 * accountant uploads the same EBM v2.1 export they file with, not a new format.
 * Amounts are gross (taxable + VAT) to compare against bank/MoMo deposits.
 */
export function parseEbmFile({ buffer, fileName, kind }: ParseEbmParams): ParseEbmResult {
  const type: AnnexureType = kind === "SALES" ? "SALES" : "PURCHASES";
  const parsed = parseAnnexureFile({
    buffer,
    fileName,
    annexureType: type,
  });

  const source: StatementSource = kind === "SALES" ? "EBM_SALE" : "EBM_PURCHASE";
  const issues: StatementParseIssue[] = [];
  const transactions: StatementTransaction[] = [];
  let skippedRows = 0;
  let missingVat = 0;

  for (const row of parsed.rows) {
    if (!row.invoiceDate) {
      skippedRows += 1;
      issues.push({
        rowNumber: row.rowNumber,
        message: `${row.invoiceNo || "Row"} has no valid invoice date — excluded from reconciliation.`,
      });
      continue;
    }
    if (row.vatAmountRwf === null) missingVat += 1;

    const taxable = row.taxableAmountRwf ?? 0;
    const vat = row.vatAmountRwf ?? 0;

    transactions.push({
      id: `${source.toLowerCase()}-${row.id}`,
      source,
      direction: kind === "SALES" ? "SALE" : "PURCHASE",
      txDate: row.invoiceDate,
      referenceNo: row.invoiceNo || `EBM-${row.rowNumber}`,
      description: row.counterpartyName || (kind === "SALES" ? "EBM sale" : "EBM purchase"),
      counterparty: row.counterpartyName,
      counterpartyTin: /^[0-9]{9}$/.test(row.counterpartyTin) ? row.counterpartyTin : null,
      amountRwf: Math.round(taxable + vat),
      vatRwf: Math.round(vat),
    });
  }

  const warnings = [...parsed.warnings];
  if (missingVat > 0) {
    warnings.push(`${missingVat} EBM row(s) have no VAT amount; input/output VAT totals may understate.`);
  }

  return {
    transactions,
    skippedRows: parsed.skippedRows + skippedRows,
    issues,
    warnings,
    headers: parsed.headers,
  };
}
