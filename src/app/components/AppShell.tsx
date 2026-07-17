"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n, useCurrentLocale } from "@/locales/client";
import TerminalClock from "@/app/components/TerminalClock";
import ThemeToggle from "@/app/components/ThemeToggle";
import { localePath } from "@/lib/locale";

const NAV = [
  {
    href: "/",
    key: "nav.calendar" as const,
    group: "Review",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4.5">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    ),
  },
  {
    href: "/history",
    key: "nav.history" as const,
    group: "Review",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4.5">
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 19.5z" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </svg>
    ),
  },
  {
    href: "/growth",
    key: "nav.growth" as const,
    group: "Account",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4.5">
        <path d="M3 3v18h18" />
        <path d="m19 9-5 5-4-4-3 3" />
      </svg>
    ),
  },
  {
    href: "/practice",
    key: "nav.practice" as const,
    group: "Account",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4.5">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    href: "/journal",
    key: "nav.journal" as const,
    group: "Notes",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4.5">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
  },
] as const;

function pageMeta(pathname: string, locale: string) {
  const path = pathname.replace(/\/$/, "");
  const base = `/${locale}`;
  if (path === base || path === `${base}/`) return { title: "Dashboard", crumbs: ["Review", "Dashboard"] };
  if (path.startsWith(`${base}/growth`)) return { title: "Growth", crumbs: ["Account", "Growth"] };
  if (path.startsWith(`${base}/practice`)) return { title: "Practice", crumbs: ["Account", "Practice"] };
  if (path.startsWith(`${base}/journal`)) return { title: "Journal", crumbs: ["Notes", "Journal"] };
  if (path.startsWith(`${base}/history`)) return { title: "Weeks", crumbs: ["Review", "Weeks"] };
  if (path.startsWith(`${base}/day/`)) return { title: "Day review", crumbs: ["Review", "Day"] };
  return { title: "Dashboard", crumbs: ["Zkyko"] };
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const t = useI18n();
  const locale = useCurrentLocale();
  const pathname = usePathname() || "";
  const meta = pageMeta(pathname, locale);

  function active(href: string) {
    const full = localePath(locale, href).replace(/\/$/, "");
    const path = pathname.replace(/\/$/, "");
    if (href === "/") return path === full;
    return path === full || path.startsWith(`${full}/`);
  }

  const groups = ["Review", "Account", "Notes"] as const;

  return (
    <div className="drawer lg:drawer-open min-h-screen">
      <input id="zkyko-drawer" type="checkbox" className="drawer-toggle" />

      <div className="drawer-content flex flex-col min-h-screen bg-base-100">
        <header className="navbar sticky top-0 z-30 min-h-14 gap-2 border-b border-base-300 bg-base-100/90 px-3 backdrop-blur sm:px-5">
          <div className="flex-none lg:hidden">
            <label htmlFor="zkyko-drawer" aria-label="Open sidebar" className="btn btn-square btn-ghost btn-sm">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="inline-block size-5 stroke-current">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </label>
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-xs breadcrumbs py-0 opacity-60 hidden sm:inline-flex">
              <ul>
                {meta.crumbs.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <h1 className="text-lg font-bold tracking-tight leading-tight truncate sm:text-xl">{meta.title}</h1>
          </div>

          <div className="flex-none flex items-center gap-1 sm:gap-2">
            <label className="input input-bordered input-sm hidden md:flex items-center gap-2 w-44 lg:w-56 bg-base-200">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4 opacity-50" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3-3" />
              </svg>
              <input type="search" className="grow" placeholder="Search…" disabled title="Coming with more pages" />
            </label>
            <div className="hidden lg:block text-[11px] font-mono opacity-50 px-1">
              <TerminalClock />
            </div>
            <ThemeToggle />
            <div className="avatar placeholder">
              <div className="bg-primary text-primary-content rounded-full w-8">
                <span className="text-xs font-bold">ZK</span>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-3 sm:p-5 lg:p-6">{children}</main>
      </div>

      <div className="drawer-side z-40">
        <label htmlFor="zkyko-drawer" aria-label="Close sidebar" className="drawer-overlay" />
        <aside className="flex min-h-full w-64 flex-col border-r border-base-300 bg-base-200">
          <div className="flex items-center gap-2.5 px-4 py-4 border-b border-base-300">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-content shadow-md shadow-primary/25">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
                <path d="M3 3v18h18" />
                <path d="m7 14 4-4 3 3 5-6" />
              </svg>
            </span>
            <div className="leading-tight">
              <div className="font-extrabold tracking-tight">{t("brand.name")}</div>
              <div className="text-[10px] uppercase tracking-wider opacity-50">Trading desk</div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-3">
            {groups.map((group) => (
              <div key={group} className="mb-3">
                <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider opacity-40">{group}</div>
                <ul className="menu menu-sm gap-0.5 p-0">
                  {NAV.filter((n) => n.group === group).map((link) => (
                    <li key={link.href}>
                      <Link
                        href={localePath(locale, link.href)}
                        className={active(link.href) ? "active font-semibold" : ""}
                      >
                        {link.icon}
                        {t(link.key)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="mt-auto border-t border-base-300 p-3">
            <div className="rounded-box bg-base-100 border border-base-300 p-3 text-xs opacity-70 leading-relaxed">
              Sync with <span className="font-mono text-[11px]">npm run sync:rh</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
