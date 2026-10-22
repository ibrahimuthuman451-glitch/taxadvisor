import {
  normalizeCurrency,
  normalizeInvoiceNo,
  normalizeMrc,
  normalizeTin,
  normalizeWhtRate,
  parseDateInput,
  sanitizeText,
  toRwfInteger,
} from "./normalize";
import type { AnnexureRow, CanonicalField } from "./types";

/**
 * Apply an inline grid edit to a normalized row, using the same parsing rules
 * as file ingestion so the grid can never introduce values the exporter would
 * reject.
 */
export function applyCellEdit(
  row: AnnexureRow,
  field: CanonicalField,
  raw: string,
  dateOrder: "DMY" | "MDY" = "DMY",
): AnnexureRow {
  switch (field) {
    case "invoiceNo":
      return { ...row, invoiceNo: normalizeInvoiceNo(raw) };
    case "invoiceDate":
      return { ...row, invoiceDate: parseDateInput(raw, dateOrder) };
    case "counterpartyTin":
      return { ...row, counterpartyTin: normalizeTin(raw) };
    case "counterpartyName":
      return { ...row, counterpartyName: sanitizeText(raw) };
    case "taxableAmountRwf":
      return { ...row, taxableAmountRwf: toRwfInteger(raw) };
    case "vatAmountRwf":
      return { ...row, vatAmountRwf: toRwfInteger(raw) };
    case "mrcCode":
      return { ...row, mrcCode: normalizeMrc(raw) };
    case "currency":
      return { ...row, currency: normalizeCurrency(raw) };
    case "whtRate":
      return { ...row, whtRate: normalizeWhtRate(raw) };
    case "purchaseType":
      return { ...row, purchaseType: /import/i.test(raw) ? "IMPORT" : "LOCAL" };
    default:
      return row;
  }
}

export function createEmptyRow(index: number, currency = "RWF"): AnnexureRow {
  return {
    id: `manual-${Date.now()}-${index}`,
    rowNumber: index,
    invoiceNo: "",
    invoiceDate: null,
    counterpartyTin: "",
    counterpartyName: "",
    taxableAmountRwf: null,
    vatAmountRwf: null,
    mrcCode: "",
    currency,
    whtRate: null,
    purchaseType: "",
  };
}
