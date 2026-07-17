import { asDate } from "./format";

export const DEFAULT_TIMEZONE = "America/Chicago";
export const TIMEZONE_STORAGE_KEY = "zk-timezone";

export const COMMON_TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Los_Angeles",
  "America/Denver",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
] as const;

/** Calendar day key YYYY-MM-DD in a named IANA timezone. */
export function dayKeyInZone(value: string | number | Date, timeZone = DEFAULT_TIMEZONE): string {
  const date = asDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Full local clock string for AI prompts (date + time + zone). */
export function nowContext(timeZone = DEFAULT_TIMEZONE, at: Date = new Date()) {
  const dayKey = dayKeyInZone(at, timeZone);
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(at);
  const iso = at.toISOString();
  return {
    dayKey,
    clock,
    iso,
    timeZone,
    line: `NOW ${clock} · day_key ${dayKey} · tz ${timeZone} · utc ${iso}`,
  };
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Weekday index 0=Sun … 6=Sat for a YYYY-MM-DD civil calendar date. */
export function weekdayForDateKey(dateKey: string, _timeZone = DEFAULT_TIMEZONE): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
