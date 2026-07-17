"use client";

import Link from "next/link";
import { useI18n, useCurrentLocale } from "@/locales/client";
import TerminalClock from "@/app/components/TerminalClock";
import { localePath } from "@/lib/locale";

const NAV = [
  { href: "/", key: "nav.calendar" },
  { href: "/growth", key: "nav.growth" },
  { href: "/journal", key: "nav.journal" },
  { href: "/history", key: "nav.history" },
] as const;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const t = useI18n();
  const locale = useCurrentLocale();

  return (
    <div className="app-frame">
      <header className="app-nav">
        <Link href={localePath(locale, "/")} className="app-logo">
          <span className="logo-mark" aria-hidden="true" />
          <span>{t("brand.name")}</span>
        </Link>
        <nav className="app-links">
          {NAV.map((link) => (
            <Link key={link.href} href={localePath(locale, link.href)}>{t(link.key)}</Link>
          ))}
        </nav>
        <div className="app-nav-end">
          <div className="app-clock">
            <TerminalClock />
          </div>
        </div>
      </header>
      <main className="app-body">{children}</main>
    </div>
  );
}
