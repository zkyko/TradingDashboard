import { toBcp47 } from "./locale";

type DateInput = string | number | Date | null | undefined;

/** Normalize SQLite CURRENT_TIMESTAMP (UTC, no zone) and ISO strings to a Date. */
export function asDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  // SQLite CURRENT_TIMESTAMP: "YYYY-MM-DD HH:MM:SS" (UTC)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    const date = new Date(raw.replace(" ", "T") + "Z");
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Parse broker CSV timestamps into ISO-8601 UTC. Returns null if unparseable. */
export function parseExecutedAt(raw: string): string | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const date = asDate(text);
  if (date) return date.toISOString();

  const us = text.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i,
  );
  if (us) {
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    let hour = Number(us[4] || 0);
    const minute = Number(us[5] || 0);
    const second = Number(us[6] || 0);
    const ampm = (us[7] || "").toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    const parsed = new Date(Date.UTC(year, Number(us[1]) - 1, Number(us[2]), hour, minute, second));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

export function formatCurrency(
  value: number | null | undefined,
  locale = "en",
  options?: { currency?: string; maximumFractionDigits?: number; minimumFractionDigits?: number },
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const currency = options?.currency || "USD";
  const maximumFractionDigits = options?.maximumFractionDigits ?? 2;
  const minimumFractionDigits = options?.minimumFractionDigits ?? Math.min(2, maximumFractionDigits);
  return new Intl.NumberFormat(toBcp47(locale), {
    style: "currency",
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

export function formatNumber(
  value: number | null | undefined,
  locale = "en",
  options?: Intl.NumberFormatOptions,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(toBcp47(locale), options).format(value);
}

export function formatPercent(
  value: number | null | undefined,
  locale = "en",
  digits = 1,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(toBcp47(locale), {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDate(
  value: DateInput,
  locale = "en",
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = asDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(toBcp47(locale), options ?? { dateStyle: "medium" }).format(date);
}

export function formatDateTime(
  value: DateInput,
  locale = "en",
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = asDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(
    toBcp47(locale),
    options ?? { dateStyle: "medium", timeStyle: "short" },
  ).format(date);
}

export function formatClock(
  value: DateInput,
  locale = "en",
  timeZone = "America/Chicago",
): string {
  const date = asDate(value);
  if (!date) return "—";
  const stamp = new Intl.DateTimeFormat(toBcp47(locale), {
    timeZone,
    hour12: false,
    weekday: "short",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
  const zoneShort = timeZone === "America/Chicago" ? "CT"
    : timeZone === "America/New_York" ? "ET"
    : timeZone === "America/Los_Angeles" ? "PT"
    : timeZone === "UTC" ? "UTC"
    : timeZone.split("/").pop()?.replace(/_/g, " ") || timeZone;
  return `${stamp.toUpperCase()} ${zoneShort}`;
}
