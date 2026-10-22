/**
 * Bank & mobile-money statement ingestion.
 *
 * Supports the common columns produced by MTN MoMo Pay, Airtel Money and
 * BK / I&M / Equity / BPR CSV exports: separate debit/credit columns, signed
 * amounts, or a transaction-type column.
 */
import { readTabularFile } from "@/lib/annexure/parse-workbook";
import { normalizeHeader } from "@/lib/annexure/mapping";
import {
  isValidTin,
  normalizeInvoiceNo,
  normalizeTin,
  parseDateInput,
  parseNumber,
  sanitizeText,
} from "@/lib/annexure/normalize";
import type {
  StatementDirection,
  StatementParseResult,
  StatementSource,
  StatementTransaction,
} from "./types";

type Canonical =
  | "date"
  | "credit"
  | "debit"
  | "amount"
  | "description"
  | "reference"
  | "counterparty"
  | "tin"
  | "type";

const ALIASES: Record<Canonical, string[]> = {
  date: [
    "date",
    "transaction date",
    "txn date",
    "value date",
    "payment date",
    "paid at",
    "created at",
    "receipt date",
    "invoice date",
  ],
  credit: ["credit", "money in", "paid in", "deposit", "inflow", "amount in", "credit amount"],
  debit: ["debit", "money out", "paid out", "withdrawal", "outflow", "amount out", "debit amount"],
  amount: ["amount", "amount rwf", "transaction amount", "total amount", "amount (rwf)", "net amount"],
  description: [
    "description",
    "narrative",
    "details",
    "transaction details",
    "particulars",
    "memo",
    "reason",
    "payer message",
    "payee message",
  ],
  reference: [
    "reference",
    "ref",
    "txn id",
    "transaction id",
    "financial transaction id",
    "receipt no",
    "invoice no",
    "external ref",
    "transaction reference",
    "cheque no",
  ],
  counterparty: [
    "name",
    "payer",
    "payee",
    "sender",
    "recipient",
    "supplier",
    "customer",
    "counterparty",
    "merchant",
    "merchant name",
    "sender name",
    "recipient name",
  ],
  tin: [
    "tin",
    "supplier tin",
    "payer tin",
    "merchant tin",
    "counterparty tin",
    "sender tin",
    "recipient tin",
    "payee tin",
  ],
  type: ["type", "transaction type", "direction", "dr/cr", "credit/debit", "entry type"],
};

const TOTAL_ROW = /^(opening|closing|balance|total|totals|b\/f|c\/f)\b/i;

function scoreAlias(header: string, alias: string): number {
  if (header === alias) return 100 + alias.length;
  if (header.startsWith(alias) || alias.startsWith(header)) {
    return 60 + Math.min(header.length, alias.length);
  }
  if (alias.length >= 4 && header.includes(alias)) return 30 + alias.length;
  if (alias.length >= 3 && header.endsWith(alias)) return 55 + alias.length;
  return 0;
}

function mapHeaders(headers: string[]): Partial<Record<Canonical, string>> {
  const mapping: Partial<Record<Canonical, string>> = {};
  const used = new Set<string>();

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (!normalized) continue;
    const candidates: Array<{ canonical: Canonical; score: number }> = [];
    for (const canonical of Object.keys(ALIASES) as Canonical[]) {
      for (const alias of ALIASES[canonical]) {
        const score = scoreAlias(normalized, normalizeHeader(alias));
        if (score > 0) candidates.push({ canonical, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates.find((candidate) => !used.has(candidate.canonical));
    if (chosen) {
      mapping[chosen.canonical] = header;
      used.add(chosen.canonical);
    }
  }
  return mapping;
}

function detectHeaderRow(rows: unknown[][]): number {
  let bestIndex = 0;
  let bestScore = 0;
  const limit = Math.min(rows.length, 12);
  for (let index = 0; index < limit; index += 1) {
    const cells = (rows[index] ?? []).filter(
      (cell) => typeof cell === "string" && String(cell).trim() !== "",
    );
    let score = 0;
    for (const cell of cells) {
      const header = normalizeHeader(String(cell));
      if (!header) continue;
      for (const canonical of Object.keys(ALIASES) as Canonical[]) {
        if (ALIASES[canonical].some((alias) => normalizeHeader(alias) === header)) {
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

function inferDirection(
  source: StatementSource,
  typeText: string,
  amount: number | null,
  credit: number | null,
  debit: number | null,
): { direction: StatementDirection; amountRwf: number } | null {
  if (debit !== null && debit > 0) return { direction: "OUT", amountRwf: debit };
  if (credit !== null && credit > 0) return { direction: "IN", amountRwf: credit };
  if (amount === null || amount === 0) return null;

  const normalizedType = typeText.toLowerCase();
  const outWords = /(debit|withdraw|payout|payment|disburse|transfer out|money out|cash out|sent)/;
  const inWords = /(credit|deposit|collection|receive|money in|cash in|inflow|refund)/;
  if (outWords.test(normalizedType)) return { direction: "OUT", amountRwf: Math.abs(amount) };
  if (inWords.test(normalizedType)) return { direction: "IN", amountRwf: Math.abs(amount) };
  if (amount < 0) return { direction: "OUT", amountRwf: Math.abs(amount) };

  // No explicit direction: treat positive values as inflows and warn downstream.
  return { direction: "IN", amountRwf: Math.abs(amount) };
}

export interface ParseStatementParams {
  buffer: ArrayBuffer;
  fileName: string;
  source: Extract<StatementSource, "MOMO_STATEMENT" | "BANK_STATEMENT">;
  dateOrder?: "DMY" | "MDY";
}

export function parseStatementFile({
  buffer,
  fileName,
  source,
  dateOrder = "DMY",
}: ParseStatementParams): StatementParseResult {
  const { rows, warnings } = readTabularFile(buffer, fileName);
  if (rows.length === 0) {
    return {
      source,
      fileName,
      headers: [],
      transactions: [],
      skippedRows: 0,
      issues: [],
      warnings: [...warnings, "File is empty."],
    };
  }

  const headerRowIndex = detectHeaderRow(rows);
  const rawHeaders = (rows[headerRowIndex] ?? []).map(
    (header, index) => String(header ?? "").trim() || `column_${index + 1}`,
  );
  const headers = rawHeaders.filter(
    (value, index) => rawHeaders.indexOf(value) === index || value.startsWith("column_"),
  );
  const mapping = mapHeaders(headers);
  const issues: StatementParseResult["issues"] = [];
  const transactions: StatementTransaction[] = [];
  let skippedRows = 0;

  const readCell = (row: unknown[], canonical: Canonical): unknown => {
    const header = mapping[canonical];
    if (!header) return undefined;
    return row[rawHeaders.indexOf(header)];
  };

  if (!mapping.date) {
    warnings.push("No date column was detected — upload a statement with a date/value-date column.");
  }
  if (!mapping.amount && !mapping.credit && !mapping.debit) {
    warnings.push("No amount/credit/debit column was detected.");
  }
  if (headerRowIndex > 0) {
    warnings.push(`Detected header row ${headerRowIndex + 1}; title rows above it were skipped.`);
  }

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const description = sanitizeText(readCell(row, "description"));
    if (TOTAL_ROW.test(description) && !readCell(row, "reference")) {
      skippedRows += 1;
      continue;
    }

    const txDate = parseDateInput(readCell(row, "date"), dateOrder);
    const credit = parseNumber(readCell(row, "credit"));
    const debit = parseNumber(readCell(row, "debit"));
    const amount = parseNumber(readCell(row, "amount"));
    const inferred = inferDirection(
      source,
      sanitizeText(readCell(row, "type")),
      amount,
      credit,
      debit,
    );

    if (!txDate || !inferred) {
      if (row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "")) {
        skippedRows += 1;
        issues.push({
          rowNumber: index + 1,
          message: !txDate
            ? "Unparseable or missing transaction date — row skipped."
            : "No amount/credit/debit value — row skipped.",
        });
      }
      continue;
    }

    const tin = normalizeTin(readCell(row, "tin"));
    const reference = normalizeInvoiceNo(readCell(row, "reference")) || `ROW-${index + 1}`;
    const counterparty = sanitizeText(readCell(row, "counterparty")) || description;

    transactions.push({
      id: `${source.toLowerCase()}-${transactions.length + 1}`,
      source,
      direction: inferred.direction,
      txDate,
      referenceNo: reference,
      description:
        description ||
        (inferred.direction === "IN" ? "Deposit / collection" : "Supplier payout"),
      counterparty,
      counterpartyTin: isValidTin(tin) ? tin : null,
      amountRwf: Math.round(inferred.amountRwf),
      vatRwf: 0,
    });
  }

  if (transactions.length === 0) {
    warnings.push("No usable transactions were found with the detected columns.");
  }

  return { source, fileName, headers, transactions, skippedRows, issues, warnings };
}

