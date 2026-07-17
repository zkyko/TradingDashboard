"use client";

import { useCallback, useEffect, useState } from "react";
import { COMMON_TIMEZONES, DEFAULT_TIMEZONE, TIMEZONE_STORAGE_KEY } from "@/lib/timezone";

export function useTimezone() {
  const [timezone, setTimezoneState] = useState(DEFAULT_TIMEZONE);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(TIMEZONE_STORAGE_KEY);
      if (stored) setTimezoneState(stored);
    } catch { /* ignore */ }
  }, []);

  const setTimezone = useCallback((next: string) => {
    setTimezoneState(next);
    try {
      localStorage.setItem(TIMEZONE_STORAGE_KEY, next);
    } catch { /* ignore */ }
  }, []);

  return { timezone, setTimezone, options: COMMON_TIMEZONES };
}
