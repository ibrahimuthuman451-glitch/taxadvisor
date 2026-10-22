/**
 * Normalization primitives shared by the grid, the API routes and the tests.
 * No Node-only imports here — this module is bundled for the browser too.
 */

const DIACRITICS = /[\u0300-\u036f]/g;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\ufeff]/g;

/**
 * Strip accents, tabs, newlines, quotes, commas and slashes from free-text
 * fields (buyer/supplier names, item descriptions).
 *
 * RRA's Excel/parser pipeline rejects files where these characters leak into
 * name columns, so sanitization is applied on ingest AND on export.
 */
export function sanitizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(ZERO_WIDTH, "")
    .replace(/[\t\r\n\v\f]+/g, " ")
    .replace(/["'`´“”‘’«»]/g, "")
    .replace(/[,/\\]+/g, " ")
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip spaces, hyphens, dots and non-breaking spaces from a TIN.
 * Letters are deliberately preserved so that malformed TINs fail validation
 * instead of silently turning into a different number.
 */
export function normalizeTin(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFKC")
    .replace(/[\s\u00a0\u2007\u202f\-–—.]/g, "")
    .trim();
}

export function isValidTin(tin: string): boolean {
  return /^[0-9]{9}$/.test(tin);
}

export function formatTin(tin: string): string {
  return isValidTin(tin) ? `${tin.slice(0, 3)} ${tin.slice(3, 6)} ${tin.slice(6)}` : tin;
}

/** Invoice/receipt numbers may legitimately contain "/" (e.g. SDC.../0001). */
export function normalizeInvoiceNo(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? String(value)
      : String(value).replace(/0+$/, "").replace(/\.$/, "");
  }
  return String(value)
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(/[\t\r\n\v\f]/g, "")
    .replace(/["'`]/g, "")
    .replace(CONTROL_CHARS, "")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * EBM Machine Registration Codes look like `SDC0010000123` and are usually
 * printed together with the receipt suffix, e.g. `SDC0010000123/0001`.
 */
export function normalizeMrc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(/[\s\u00a0]/g, "")
    .toUpperCase();
}

export function isValidMrc(mrc: string): boolean {
  return /^SDC[0-9]{6,15}(\/[0-9]{1,4})?$/.test(mrc);
}

export function normalizeCurrency(value: unknown): string {
  if (value === null || value === undefined || value === "") return "RWF";
  const raw = String(value).trim().toUpperCase();
  if (!raw) return "RWF";
  if (
    raw.includes("RWF") ||
    raw.includes("FRW") ||
    raw === "RF" ||
    raw.includes("RWANDA")
  ) {
    return "RWF";
  }
  return raw;
}

/**
 * Parse numbers that arrive with thousands separators, currency codes,
 * accounting parentheses or stray spaces. Returns null for blanks/invalid.
 */
export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let raw = String(value)
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(ZERO_WIDTH, "")
    .trim();
  if (!raw) return null;

  let negative = false;
  if (/^\(.*\)$/.test(raw)) {
    negative = true;
    raw = raw.slice(1, -1);
  }
  raw = raw
    .replace(/(RWF|FRW|USD|EUR|KES|UGX|TZS|BIF)/gi, "")
    .replace(/\s/g, "")
    .replace(/[^\d.,+-]/g, "");
  if (!raw || !/\d/.test(raw)) return null;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  if (hasComma && hasDot) {
    // Last separator wins as the decimal mark.
    const decimalMark = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : ".";
    const thousandsMark = decimalMark === "," ? "." : ",";
    raw = raw.split(thousandsMark).join("");
    raw = raw.replace(decimalMark, ".");
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(raw)) {
      raw = raw.replace(/,/g, "");
    } else if (/^-?\d+,\d{1,2}$/.test(raw)) {
      raw = raw.replace(",", ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(raw)) {
    raw = raw.replace(/\./g, "");
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

/** RWF declarations must be whole integers — no decimals reach the .txt. */
export function toRwfInteger(value: unknown): number | null {
  const parsed = parseNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

export function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

export function rwf(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-RW", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function isoFromParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (year < 1990 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function expandYear(year: number): number {
  if (year >= 100) return year;
  return year <= 69 ? 2000 + year : 1900 + year;
}

/** Excel's 1900 date system (including the historical 1900-02-29 bug). */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const wholeDays = Math.floor(serial);
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + wholeDays * 86_400_000);
  return isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, janvier: 1, janyuari: 1,
  feb: 2, february: 2, fevrier: 2, februari: 2,
  mar: 3, march: 3, mars: 3,
  apr: 4, april: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juin: 6,
  jul: 7, july: 7, juillet: 7,
  aug: 8, august: 8, aout: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12,
};

function monthFromName(name: string): number | null {
  const key = name
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/\.$/, "");
  return MONTH_NAMES[key] ?? null;
}

/**
 * Parse any date an accountant's export can throw at us:
 *   - ISO (`2026-10-15`, `2026-10-15T00:00:00Z`)
 *   - `DD/MM/YYYY`, `MM/DD/YYYY`, `DD-MM-YYYY`, `YYYY/MM/DD`
 *   - Excel serial numbers (`45000`, `45000.5`)
 *   - `15 Oct 2026`, `Oct 15, 2026`, `15 octobre 2026`
 *
 * Ambiguous slash dates follow `dateOrder` (Rwanda = DMY).
 * Returns an ISO `YYYY-MM-DD` string or null.
 */
export function parseDateInput(
  value: unknown,
  dateOrder: "DMY" | "MDY" = "DMY",
): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return isoFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  if (typeof value === "number") {
    return excelSerialToIso(value);
  }

  let raw = String(value)
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!raw) return null;

  // Slash/dot timestamps ("01/10/2026 09:12") — drop the clock before parsing.
  raw = raw.replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm)?$/i, "");

  // ISO 8601 (optionally with time component)
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(raw);
  if (isoMatch) {
    return isoFromParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  // Compact YYYYMMDD
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (compact) {
    return isoFromParts(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  }

  // Excel serial stored as text
  if (/^\d{1,6}(\.\d+)?$/.test(raw)) {
    return excelSerialToIso(Number(raw));
  }

  // 15 Oct 2026 / 15 octobre 2026
  const dmyName = /^(\d{1,2})[\s\-/.]*([A-Za-zÀ-ÿ.]+)[\s\-/,.]*(\d{2,4})$/.exec(raw);
  if (dmyName) {
    const month = monthFromName(dmyName[2] ?? "");
    if (month) {
      return isoFromParts(expandYear(Number(dmyName[3])), month, Number(dmyName[1]));
    }
  }

  // Oct 15, 2026
  const mdyName = /^([A-Za-zÀ-ÿ.]+)[\s\-/.]*(\d{1,2})[\s\-/,.]*(\d{2,4})$/.exec(raw);
  if (mdyName) {
    const month = monthFromName(mdyName[1] ?? "");
    if (month) {
      return isoFromParts(expandYear(Number(mdyName[3])), month, Number(mdyName[2]));
    }
  }

  // Numeric date with separators
  const parts = raw.split(/[\s\-/.,]+/).filter(Boolean);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (!a || !b || !c) return null;
    if (a.length === 4) {
      return isoFromParts(Number(a), Number(b), Number(c));
    }
    if (c.length === 4 || c.length === 2) {
      const year = expandYear(Number(c));
      const first = Number(a);
      const second = Number(b);
      if (!Number.isInteger(first) || !Number.isInteger(second)) return null;
      const dayFirst = first > 12 ? true : second > 12 ? false : dateOrder === "DMY";
      return dayFirst
        ? isoFromParts(year, second, first)
        : isoFromParts(year, first, second);
    }
  }

  return null;
}

/** Normalize a WHT rate: accepts 0.15, 15, "15%". */
export function normalizeWhtRate(value: unknown): number | null {
  const parsed = parseNumber(value);
  if (parsed === null) return null;
  const rate = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
  return Math.round(rate * 100) / 100;
}

