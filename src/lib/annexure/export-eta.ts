import { ANNEXURE_FORMATS, formatOutputValue } from "./annexure-config";
import { isValidTin, sanitizeText } from "./normalize";
import type { AnnexureType, ValidatedAnnexureRow } from "./types";
import { AnnexureExportError } from "./types";

/**
 * Final safety net: even if a cell was pasted directly into an editable field,
 * no tab, CR/LF or quote ever reaches the RRA parser.
 */
function wireSafe(value: string): string {
  return value.replace(/[\t\r\n\v\f]/g, " ").trim();
}

export interface BuildEtaOptions {
  /** Throw when any row still has an ERROR (default true). */
  blockOnErrors?: boolean;
}

/**
 * Build the headerless, tab-delimited `.txt` accepted by etax.rra.gov.rw.
 *
 * - No header row (the portal maps columns by position).
 * - CRLF line endings, one invoice per line.
 * - RWF integers, DD/MM/YYYY dates.
 * - No trailing tab.
 */
export function buildEtaText(
  rows: ValidatedAnnexureRow[],
  type: AnnexureType,
  options: BuildEtaOptions = {},
): string {
  const blockOnErrors = options.blockOnErrors ?? true;
  if (blockOnErrors) assertExportable(rows);

  const format = ANNEXURE_FORMATS[type];
  const lines = rows.map((row) =>
    format.outputColumns
      .map((field) => {
        const raw = formatOutputValue(field, row);
        return wireSafe(field === "counterpartyName" ? sanitizeText(raw) : raw);
      })
      .join("\t"),
  );

  // Trailing newline is expected by RRA's bulk upload parser.
  return lines.length > 0 ? `${lines.join("\r\n")}\r\n` : "";
}

export function assertExportable(rows: ValidatedAnnexureRow[]): void {
  const failing = rows
    .filter((row) => row.status === "ERROR" || row.issues.some((issue) => issue.severity === "ERROR"))
    .map((row) => ({
      rowNumber: row.rowNumber,
      issues: row.issues.filter((issue) => issue.severity === "ERROR"),
    }));

  if (failing.length > 0) {
    throw new AnnexureExportError(
      `${failing.length} row(s) still have blocking errors. Fix or exclude them before generating the RRA .txt.`,
      failing,
    );
  }
}

export function buildEtaFileName(params: {
  clientTin?: string | null;
  periodMonth?: string | null;
  type: AnnexureType;
}): string {
  const prefix = ANNEXURE_FORMATS[params.type].filePrefix;
  const tin = params.clientTin && isValidTin(params.clientTin) ? params.clientTin : "NO-TIN";
  const period = params.periodMonth && /^\d{4}-\d{2}$/.test(params.periodMonth)
    ? params.periodMonth
    : new Date().toISOString().slice(0, 7);
  return `${prefix}_${tin}_${period}.txt`;
}

export function etaLineCount(text: string): number {
  if (!text) return 0;
  return text.replace(/\r\n$/, "").split("\r\n").length;
}
