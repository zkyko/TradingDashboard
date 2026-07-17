"use client";

import { useMemo } from "react";
import { useCurrentLocale } from "@/locales/client";
import {
  formatClock,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { useTimezone } from "@/app/components/useTimezone";
import { useMoneyPrivacy } from "@/app/components/MoneyPrivacy";

/** Locale-aware formatters — timezone from local preference; respects money privacy when provided. */
export function useFormat() {
  const locale = useCurrentLocale();
  const { timezone } = useTimezone();
  const { hidden } = useMoneyPrivacy();
  return useMemo(() => ({
    locale,
    timezone,
    moneyHidden: hidden,
    currency: (value: number | null | undefined, options?: Parameters<typeof formatCurrency>[2]) =>
      (hidden ? "••••" : formatCurrency(value, locale, options)),
    number: (value: number | null | undefined, options?: Intl.NumberFormatOptions) =>
      formatNumber(value, locale, options),
    percent: (value: number | null | undefined, digits?: number) =>
      formatPercent(value, locale, digits),
    date: (value: string | number | Date | null | undefined, options?: Intl.DateTimeFormatOptions) =>
      formatDate(value, locale, options),
    dateTime: (value: string | number | Date | null | undefined, options?: Intl.DateTimeFormatOptions) =>
      formatDateTime(value, locale, { timeZone: timezone, ...options }),
    clock: (value: string | number | Date | null | undefined, timeZone?: string) =>
      formatClock(value, locale, timeZone || timezone),
  }), [locale, timezone, hidden]);
}
