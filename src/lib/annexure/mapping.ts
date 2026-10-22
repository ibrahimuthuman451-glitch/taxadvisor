import { ANNEXURE_FORMATS } from "./annexure-config";
import {
  isBlankValue,
  normalizeCurrency,
  normalizeInvoiceNo,
  normalizeMrc,
  normalizeTin,
  normalizeWhtRate,
  parseDateInput,
  sanitizeText,
  toRwfInteger,
} from "./normalize";
import type {
  AnnexureRow,
  AnnexureType,
  CanonicalField,
  ColumnMapping,
  RawRecord,
} from "./types";

/** Lowercase, accent-free, punctuation-free header key. */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/n[°º]/g, " n ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TOTAL_ROW = /^(total|totaux|grand total|sub ?total|sous total|sum|totals)\b/i;

/**
 * Score how likely a row is to be the header row of an exported workbook.
 * Handles EBM/QuickBooks/Tally/Xero files that prepend title/company blocks.
 */
export function detectHeaderRowIndex(rows: unknown[][], type: AnnexureType): number {
  const fields = ANNEXURE_FORMATS[type].fields;
  const limit = Math.min(rows.length, 12);
  let bestIndex = 0;
  let bestScore = 0;

  for (let index = 0; index < limit; index += 1) {
    const row = rows[index] ?? [];
    const cells = row.filter((cell) => typeof cell === "string" && String(cell).trim() !== "");
    if (cells.length < 2) continue;

    let score = 0;
    for (const cell of cells) {
      const header = normalizeHeader(String(cell));
      if (!header) continue;
      for (const field of fields) {
        if (field.aliases.some((alias) => normalizeHeader(alias) === header)) {
          score += 10;
          break;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore >= 20 ? bestIndex : 0;
}

type FieldSpec = (typeof ANNEXURE_FORMATS)[AnnexureType]["fields"][number];

function scoreHeaderForField(header: string, field: FieldSpec): number {
  const key = normalizeHeader(field.key);
  if (header === key) return 95;

  let score = 0;
  for (const alias of field.aliases) {
    const normalized = normalizeHeader(alias);
    if (!normalized) continue;
    if (header === normalized) score = Math.max(score, 100 + normalized.length);
    else if (header.startsWith(normalized) || normalized.startsWith(header)) {
      score = Math.max(score, 60 + Math.min(header.length, normalized.length));
    } else if (normalized.length >= 4 && header.includes(normalized)) {
      score = Math.max(score, 30 + normalized.length);
    }
  }
  return score;
}

/**
 * Auto-map spreadsheet headers to canonical fields. Each canonical field is
 * assigned at most once; ties are resolved by header specificity.
 */
export function autoMapHeaders(headers: string[], type: AnnexureType): ColumnMapping {
  const fields = ANNEXURE_FORMATS[type].fields;
  const candidates: Array<{ header: string; field: CanonicalField; score: number }> = [];

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (!normalized) continue;
    for (const field of fields) {
      const score = scoreHeaderForField(normalized, field);
      if (score > 0) candidates.push({ header, field: field.key, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const mapping: ColumnMapping = {};
  const usedFields = new Set<CanonicalField>();
  for (const candidate of candidates) {
    if (usedFields.has(candidate.field)) continue;
    if (mapping[candidate.header]) continue;
    mapping[candidate.header] = candidate.field;
    usedFields.add(candidate.field);
  }
  for (const header of headers) {
    if (!(header in mapping)) mapping[header] = null;
  }
  return mapping;
}

export function missingRequiredFields(mapping: ColumnMapping, type: AnnexureType): string[] {
  const assigned = new Set(Object.values(mapping).filter(Boolean) as CanonicalField[]);
  return ANNEXURE_FORMATS[type].fields
    .filter((field) => field.required && !assigned.has(field.key))
    .map((field) => field.label);
}

export interface BuildRowsOptions {
  dateOrder?: "DMY" | "MDY";
  type: AnnexureType;
}

/**
 * Convert raw tabular records into normalized annexure rows.
 * Nothing is dropped silently except empty/`Total` rows — the skipped count is
 * surfaced in the UI and API response.
 */
export function buildRowsFromRecords(
  records: RawRecord[],
  headers: string[],
  mapping: ColumnMapping,
  options: BuildRowsOptions,
): { rows: AnnexureRow[]; skippedRows: number } {
  const rows: AnnexureRow[] = [];
  let skippedRows = 0;

  // Reverse map so we do one lookup per field instead of per cell.
  const fieldToHeader = new Map<CanonicalField, string>();
  for (const header of headers) {
    const field = mapping[header];
    if (field && !fieldToHeader.has(field)) fieldToHeader.set(field, header);
  }
  const value = (record: RawRecord, field: CanonicalField): unknown => {
    const header = fieldToHeader.get(field);
    return header === undefined ? undefined : record[header];
  };

  records.forEach((record, index) => {
    const invoiceNo = normalizeInvoiceNo(value(record, "invoiceNo"));
    const counterpartyName = sanitizeText(value(record, "counterpartyName"));
    const tin = normalizeTin(value(record, "counterpartyTin"));
    const taxable = value(record, "taxableAmountRwf");
    const tax = value(record, "vatAmountRwf");

    const allMappedBlank =
      isBlankValue(invoiceNo) &&
      isBlankValue(counterpartyName) &&
      isBlankValue(tin) &&
      isBlankValue(taxable) &&
      isBlankValue(tax);
    const looksLikeTotal = TOTAL_ROW.test(counterpartyName) || TOTAL_ROW.test(invoiceNo);

    if (allMappedBlank || (looksLikeTotal && isBlankValue(tin))) {
      skippedRows += 1;
      return;
    }

    const purchaseTypeRaw = sanitizeText(value(record, "purchaseType")).toUpperCase();
    const purchaseType: AnnexureRow["purchaseType"] =
      options.type === "PURCHASES"
        ? /IMPORT/.test(purchaseTypeRaw)
          ? "IMPORT"
          : "LOCAL"
        : "";

    rows.push({
      id: `row-${index + 1}`,
      rowNumber: index + 1,
      invoiceNo,
      invoiceDate: parseDateInput(value(record, "invoiceDate"), options.dateOrder ?? "DMY"),
      counterpartyTin: tin,
      counterpartyName,
      taxableAmountRwf: toRwfInteger(taxable),
      vatAmountRwf: toRwfInteger(tax),
      mrcCode: normalizeMrc(value(record, "mrcCode")),
      currency: normalizeCurrency(value(record, "currency")),
      whtRate: options.type === "WHT" ? normalizeWhtRate(value(record, "whtRate")) : null,
      purchaseType,
    });
  });

  return { rows, skippedRows };
}

