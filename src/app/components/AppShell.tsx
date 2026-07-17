"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n, useCurrentLocale } from "@/locales/client";
import TerminalClock from "@/app/components/TerminalClock";
import ThemeToggle from "@/app/components/ThemeToggle";
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
  const pathname = usePathname() || "";

  function active(href: string) {
    const full = localePath(locale, href).replace(/\/$/, "");
    const path = pathname.replace(/\/$/, "");
    if (href === "/") return path === full;
    return path === full || path.startsWith(`${full}/`);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="navbar sticky top-0 z-40 bg-base-100/90 backdrop-blur border-b border-base-300 px-3 sm:px-5 min-h-14">
        <div className="navbar-start gap-2">
          <Link href={localePath(locale, "/")} className="btn btn-ghost px-2 gap-2">
            <span className="inline-block size-7 rounded-lg bg-primary shadow-md shadow-primary/30" aria-hidden />
            <span className="font-extrabold tracking-tight text-lg">{t("brand.name")}</span>
          </Link>
        </div>
        <div className="navbar-center hidden sm:flex">
          <ul className="menu menu-horizontal gap-1 px-1">
            {NAV.map((link) => (
              <li key={link.href}>
                <Link
                  href={localePath(locale, link.href)}
                  className={active(link.href) ? "active font-semibold" : ""}
                >
                  {t(link.key)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="navbar-end gap-1 sm:gap-2">
          <div className="app-clock hidden md:block text-xs font-mono opacity-60">
            <TerminalClock />
          </div>
          <ThemeToggle />
          <div className="dropdown dropdown-end sm:hidden">
            <div tabIndex={0} role="button" className="btn btn-ghost btn-sm">
              Menu
            </div>
            <ul tabIndex={0} className="dropdown-content menu bg-base-200 rounded-box z-50 w-44 p-2 shadow-lg border border-base-300">
              {NAV.map((link) => (
                <li key={link.href}>
                  <Link href={localePath(locale, link.href)}>{t(link.key)}</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <main className="flex-1">{children}</main>
    </div>
  );
}
