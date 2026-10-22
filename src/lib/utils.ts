import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRwf(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `RWF ${new Intl.NumberFormat("en-RW", { maximumFractionDigits: 0 }).format(
    Math.round(value),
  )}`;
}

export function formatRwfCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `RWF ${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `RWF ${(value / 1_000).toFixed(1)}K`;
  return formatRwf(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-RW").format(Math.round(value));
}

export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatPeriodMonth(periodMonth: string | null | undefined): string {
  if (!periodMonth) return "—";
  const match = /^(\d{4})-(\d{2})$/.exec(periodMonth);
  if (!match) return periodMonth;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat("en-RW", { month: "long", year: "numeric" }).format(date);
}

/** 15th of the month following the period (Rwanda VAT/WHT/PAYE deadline). */
export function declarationDeadline(periodMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodMonth);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]), 15));
  return date.toISOString().slice(0, 10);
}

export function daysUntil(iso: string): number {
  const target = new Date(`${iso}T00:00:00Z`).getTime();
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - todayUtc) / 86_400_000);
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("250")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+250${digits.slice(1)}`;
  return digits ? `+${digits}` : "";
}

export function truncate(value: string, length = 48): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
