"use client";

import { useEffect } from "react";
import { useCurrentLocale } from "@/locales/client";
import { getLocaleDir } from "@/lib/locale";

/** Keeps <html lang/dir> in sync for screen readers and future RTL locales. */
export default function LocaleDocumentSync() {
  const locale = useCurrentLocale();
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = getLocaleDir(locale);
    root.dataset.locale = locale;
  }, [locale]);
  return null;
}
