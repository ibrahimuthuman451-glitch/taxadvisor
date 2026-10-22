/**
 * Spreadsheet ingestion (server-side only): CSV via PapaParse, XLSX/XLS via
 * SheetJS. Keeps the pure domain engine free of Node-only dependencies.
 */
import Papa from "papaparse";
import * as XLSX from "xlsx";

import { ANNEXURE_FORMATS } from "./annexure-config";
import {
  autoMapHeaders,
  buildRowsFromRecords,
  detectHeaderRowIndex,
  missingRequiredFields,
} from "./mapping";
import type {
  AnnexureParseResult,
  AnnexureType,
  ColumnMapping,
  RawRecord,
} from "./types";

export interface ParsedTabular {
  headers: string[];
  records: RawRecord[];
  sheetName: string | null;
  warnings: string[];
}

function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("\uFFFD")) {
    try {
      text = new TextDecoder("windows-1252").decode(bytes);
    } catch {
      // keep UTF-8 result
    }
  }
  return text.replace(/^\uFEFF/, "");
}

/** Dedupe headers, fill blanks, and keep a stable 1:1 header↔column mapping. */
function normalizeHeaders(rawHeaders: unknown[]): string[] {
  const seen = new Map<string, number>();
  return rawHeaders.map((header, index) => {
    const base =
      String(header ?? "")
        .replace(/\s+/g, " ")
        .trim() || `column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

function rowsToRecords(rows: unknown[][], headerRowIndex: number): ParsedTabular {
  const rawHeaders = rows[headerRowIndex] ?? [];
  const maxWidth = rows.reduce(
    (width, row) => Math.max(width, Array.isArray(row) ? row.length : 0),
    rawHeaders.length,
  );
  const padded = [...rawHeaders];
  for (let index = rawHeaders.length; index < maxWidth; index += 1) {
    padded.push(`column_${index + 1}`);
  }
  const headers = normalizeHeaders(padded);

  const records: RawRecord[] = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const record: RawRecord = {};
    let hasValue = false;
    headers.forEach((header, columnIndex) => {
      const cell = row[columnIndex];
      record[header] = cell ?? null;
      if (cell !== null && cell !== undefined && String(cell).trim() !== "") hasValue = true;
    });
    if (hasValue) records.push(record);
  }

  return { headers, records, sheetName: null, warnings: [] };
}

function parseCsv(buffer: ArrayBuffer): { rows: unknown[][]; warnings: string[] } {
  const text = decodeText(buffer);
  const result = Papa.parse<unknown[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
    dynamicTyping: false, // never turn 012345678 into 12345678
  });

  const warnings: string[] = [];
  const hardErrors = result.errors.filter((error) => error.type === "Delimiter");
  if (hardErrors.length > 0) {
    warnings.push(`CSV delimiter detection warning: ${hardErrors[0]?.message ?? "unknown"}`);
  }
  const rows = (result.data as unknown[][]).filter((row) => Array.isArray(row));
  return { rows, warnings };
}

function parseExcel(buffer: ArrayBuffer): {
  rows: unknown[][];
  sheetName: string;
  warnings: string[];
} {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    cellNF: false,
    cellText: false,
  });
  const warnings: string[] = [];
  const sheetName =
    workbook.SheetNames.find((name) => {
      const sheet = workbook.Sheets[name];
      return sheet ? sheet["!ref"] !== undefined : false;
    }) ?? workbook.SheetNames[0];

  if (!sheetName) {
    return { rows: [], sheetName: "", warnings: ["Workbook contains no sheets."] };
  }
  if (workbook.SheetNames.length > 1) {
    warnings.push(
      `Workbook has ${workbook.SheetNames.length} sheets; ingested "${sheetName}". Export one annexure per file.`,
    );
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { rows: [], sheetName, warnings };

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  return { rows, sheetName, warnings };
}

export function parseTabularFile(buffer: ArrayBuffer, fileName: string): ParsedTabular {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "csv" || extension === "txt" || extension === "tsv") {
    const { rows, warnings } = parseCsv(buffer);
    if (rows.length === 0) {
      return {
        headers: [],
        records: [],
        sheetName: null,
        warnings: [...warnings, "File is empty."],
      };
    }
    return {
      headers: normalizeHeaders(rows[0] ?? []),
      records: rowsToRecords(rows, 0).records,
      sheetName: null,
      warnings,
    };
  }

  if (["xlsx", "xlsm", "xls", "ods"].includes(extension)) {
    const { rows, sheetName, warnings } = parseExcel(buffer);
    if (rows.length === 0) {
      return { headers: [], records: [], sheetName, warnings: [...warnings, "Sheet is empty."] };
    }
    return {
      headers: normalizeHeaders(rows[0] ?? []),
      records: rowsToRecords(rows, 0).records,
      sheetName,
      warnings,
    };
  }

  throw new Error(`Unsupported file type ".${extension}". Upload an .xlsx, .xls or .csv export.`);
}

/**
 * Low-level table reader shared by the annexure and reconciliation pipelines.
 * Returns raw rows so callers can run their own header detection.
 */
export function readTabularFile(
  buffer: ArrayBuffer,
  fileName: string,
): { rows: unknown[][]; sheetName: string | null; warnings: string[] } {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "csv" || extension === "txt" || extension === "tsv") {
    const parsed = parseCsv(buffer);
    return { rows: parsed.rows, sheetName: null, warnings: parsed.warnings };
  }
  if (["xlsx", "xlsm", "xls", "ods"].includes(extension)) {
    const parsed = parseExcel(buffer);
    return { rows: parsed.rows, sheetName: parsed.sheetName, warnings: parsed.warnings };
  }
  throw new Error(`Unsupported file type ".${extension}". Upload an .xlsx, .xls or .csv export.`);
}

/** Full pipeline: bytes + type → mapped, normalized rows ready for validation. */
export function parseAnnexureFile(params: {
  buffer: ArrayBuffer;
  fileName: string;
  annexureType: AnnexureType;
  mapping?: ColumnMapping | null;
  dateOrder?: "DMY" | "MDY";
}): AnnexureParseResult {
  const { buffer, fileName, annexureType, mapping: mappingOverride, dateOrder } = params;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const warnings: string[] = [];
  let rows: unknown[][];
  let sheetName: string | null = null;

  if (extension === "csv" || extension === "txt" || extension === "tsv") {
    const parsed = parseCsv(buffer);
    rows = parsed.rows;
    warnings.push(...parsed.warnings);
  } else if (["xlsx", "xlsm", "xls", "ods"].includes(extension)) {
    const parsed = parseExcel(buffer);
    rows = parsed.rows;
    sheetName = parsed.sheetName;
    warnings.push(...parsed.warnings);
  } else {
    throw new Error(`Unsupported file type ".${extension}". Upload an .xlsx, .xls or .csv export.`);
  }

  if (rows.length === 0) {
    throw new Error("The uploaded file contains no data rows.");
  }

  const headerRowIndex = detectHeaderRowIndex(rows, annexureType);
  const tabular = rowsToRecords(rows, headerRowIndex);
  if (headerRowIndex > 0) {
    warnings.push(
      `Detected header row ${headerRowIndex + 1}; the ${headerRowIndex} title/summary row(s) above it were ignored.`,
    );
  }

  const mapping = mappingOverride ?? autoMapHeaders(tabular.headers, annexureType);
  const missing = missingRequiredFields(mapping, annexureType);
  if (missing.length > 0) {
    warnings.push(
      `Columns not detected for: ${missing.join(", ")}. Map them manually before validating.`,
    );
  }

  const { rows: annexureRows, skippedRows } = buildRowsFromRecords(
    tabular.records,
    tabular.headers,
    mapping,
    { type: annexureType, dateOrder },
  );
  if (skippedRows > 0) {
    warnings.push(`${skippedRows} empty or "Total" row(s) were skipped.`);
  }
  if (annexureRows.length === 0) {
    warnings.push("No usable invoice rows were found with the current column mapping.");
  }

  const format = ANNEXURE_FORMATS[annexureType];
  warnings.push(`Output column order: ${format.outputColumns.join(" → ")}.`);

  return {
    annexureType,
    fileName,
    sheetName,
    headers: tabular.headers,
    mapping,
    rows: annexureRows,
    skippedRows,
    warnings,
  };
}

