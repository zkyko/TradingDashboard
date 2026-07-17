"use client";

import Link from "next/link";
import ExceptionCard from "@/app/components/ExceptionCard";
import ReportControls from "@/app/components/ReportControls";
import AnalyticsDashboard from "@/app/components/AnalyticsDashboard";
import PnlCalendar from "@/app/components/PnlCalendar";
import InsightsPanel from "@/app/components/InsightsPanel";
import MonitorSetups from "@/app/components/MonitorSetups";
import SetupTapeChart from "@/app/components/SetupTapeChart";
import { MoneyEyeButton, MoneyPrivacyProvider, useMoneyPrivacy } from "@/app/components/MoneyPrivacy";
import { useFormat } from "@/app/components/useFormat";
import { useI18n } from "@/locales/client";
import type { MorningScanResult } from "@/lib/morning-scan";
import type { LiveBar } from "@/lib/python-service";

type Plan = Record<string, string | number | null>;
type Exception = Record<string, string | number | null>;
type Position = { ticker: string; quantity: number; averagePrice?: number };
type Recent = Record<string, string | number | null>;
type WatchRow = Record<string, string | number | null>;

export default function MonitorDesk(props: {
  equity: number;
  plans: Plan[];
  exceptions: Exception[];
  stats: Record<string, number>;
  positions: Position[];
  recent: Recent[];
  watchlist: WatchRow[];
  morning: MorningScanResult | null;
  lastSync: string | null;
}) {
  return (
    <MoneyPrivacyProvider>
      <MonitorDeskInner {...props} />
    </MoneyPrivacyProvider>
  );
}

function MonitorDeskInner({
  equity,
  plans,
  exceptions,
  stats,
  positions,
  recent,
  watchlist,
  morning,
  lastSync,
}: {
  equity: number;
  plans: Plan[];
  exceptions: Exception[];
  stats: Record<string, number>;
  positions: Position[];
  recent: Recent[];
  watchlist: WatchRow[];
  morning: MorningScanResult | null;
  lastSync: string | null;
}) {
  const t = useI18n();
  const format = useFormat();
  const { hidden } = useMoneyPrivacy();

  return (
    <div className="page wide monitor-page">
      <header className="monitor-hero">
        <div>
          <p className="eyebrow">{t("monitor.eyebrow")}</p>
          <h1>{t("monitor.title")}</h1>
          <p className="lede">{t("monitor.lede")}</p>
        </div>
        <div className="monitor-hero-actions">
          <MoneyEyeButton />
          <div className="command-line compact">
            <span className="prompt">TL</span>
            <span>{t("common.localOnly")}</span>
          </div>
          <Link className="ghost-btn" href="/plan">{t("common.newDecision")}</Link>
        </div>
      </header>

      <section className={`status-strip${hidden ? " money-masked" : ""}`} aria-label="Account status">
        <div>
          <span>{t("monitor.netLiq")}</span>
          <b>{equity ? format.currency(equity) : "—"}</b>
        </div>
        <div><span>{t("monitor.openPlans")}</span><b>{format.number(plans.length)}</b></div>
        <div>
          <span>{t("monitor.planChanges")}</span>
          <b className={stats.changes ? "amber" : "positive"}>{format.number(stats.changes)}</b>
        </div>
        <div>
          <span>{t("monitor.unexplained")}</span>
          <b className={exceptions.length ? "negative" : "positive"}>{format.number(exceptions.length)}</b>
        </div>
        <div>
          <span>{t("monitor.resolved")}</span>
          <b>{stats.exceptions ? `${format.number(Math.round((stats.resolved / stats.exceptions) * 100))}%` : "100%"}</b>
        </div>
        <div>
          <span>{t("monitor.lastSync")}</span>
          <b>{lastSync ? format.dateTime(lastSync, { hour: "2-digit", minute: "2-digit" }) : "—"}</b>
        </div>
      </section>

      <section className="terminal-panel">
        <div className="panel-head">
          <span>{t("monitor.watchlist")}</span>
          <Link href="/watchlist">Open Watch →</Link>
        </div>
        {watchlist.length ? (
          <div className="monitor-watch-grid">
            {watchlist.map((w) => (
              <Link key={Number(w.id)} href={`/watchlist?ticker=${encodeURIComponent(String(w.symbol))}`} className="monitor-watch-card">
                <header>
                  <b>{w.symbol}</b>
                  <span className="muted">{w.status}</span>
                </header>
                <p>{String(w.setup || w.thesis || "").slice(0, 90)}</p>
                <footer>
                  <span>{w.last_price != null ? format.currency(Number(w.last_price)) : "—"}</span>
                  <span className="muted">{w.timeframe}</span>
                </footer>
              </Link>
            ))}
          </div>
        ) : (
          <div className="terminal-empty compact">{t("monitor.noWatch")} — <Link href="/watchlist">add names</Link></div>
        )}
      </section>

      {!!morning?.setups?.length && (
        <section className="terminal-panel">
          <div className="panel-head">
            <span>{t("monitor.morning")}</span>
            <Link href="/notifications">{morning.dayKey} →</Link>
          </div>
          <p className="muted" style={{ padding: "0 14px 10px" }}>{morning.summary}</p>
          <div className="monitor-morning-grid">
            {morning.setups.slice(0, 4).map((s) => (
              <article key={s.symbol} className="monitor-morning-card">
                <header>
                  <b>{s.symbol}</b>
                  <span className="muted">{s.plays[0]?.name}</span>
                </header>
                <SetupTapeChart
                  symbol={s.symbol}
                  bars={s.bars as LiveBar[] | undefined}
                  vpLevels={s.levels.daily}
                  height={180}
                />
                <p className="muted">
                  VAL {s.levels.daily?.val != null ? format.currency(s.levels.daily.val) : "—"}
                  {" · "}POC {s.levels.daily?.poc != null ? format.currency(s.levels.daily.poc) : "—"}
                  {" · "}VAH {s.levels.daily?.vah != null ? format.currency(s.levels.daily.vah) : "—"}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      <MonitorSetups />

      <AnalyticsDashboard />

      <div className="monitor-secondary">
        <PnlCalendar />
        <InsightsPanel />
      </div>

      <div className="terminal-grid">
        <section className="terminal-panel">
          <div className="panel-head"><span>{t("monitor.positions")}</span><span>{format.number(positions.length)}</span></div>
          {positions.length ? (
            <div className="positions-table">
              <div className="position-row header"><span>Symbol</span><span>Qty</span><span>Avg cost</span><span>Plan</span></div>
              {positions.map((p, i) => (
                <div className="position-row" key={`${p.ticker}-${i}`}>
                  <b>{p.ticker}</b>
                  <span>{format.number(p.quantity)}</span>
                  <span>{p.averagePrice ? format.currency(p.averagePrice) : "—"}</span>
                  <span className={plans.some((plan) => plan.ticker === p.ticker) ? "positive" : "amber"}>
                    {plans.some((plan) => plan.ticker === p.ticker) ? "Linked" : "No plan"}
                  </span>
                </div>
              ))}
            </div>
          ) : <div className="terminal-empty">{t("monitor.noPositions")}</div>}
        </section>
        <section className="terminal-panel report-panel">
          <div className="panel-head"><span>{t("monitor.reports")}</span><span>Local</span></div>
          <p>{t("monitor.reportsHint")}</p>
          <ReportControls />
          <Link className="terminal-link" href="/reports">{t("monitor.allReports")}</Link>
        </section>
      </div>

      {exceptions.length > 0 && (
        <section className="terminal-panel">
          <div className="panel-head danger">
            <span>{t("monitor.unexplainedFills")}</span>
            <span>{format.number(exceptions.length)}</span>
          </div>
          <div className="exception-grid">{exceptions.map((e) => <ExceptionCard key={Number(e.id)} exception={e} />)}</div>
        </section>
      )}

      <section className="terminal-panel">
        <div className="panel-head"><span>{t("monitor.openPlans")}</span><Link href="/plan">+ New</Link></div>
        {plans.length === 0 ? (
          <div className="terminal-empty">{t("monitor.noOpenPlans")}</div>
        ) : (
          <div className="thesis-table">
            <div className="thesis-row header">
              <span>Symbol</span><span>Dir</span><span>Setup</span><span>Entry</span>
              <span>Invalid</span><span>Target</span><span>Planned loss</span><span>Hold until</span><span></span>
            </div>
            {plans.map((p) => (
              <Link href={`/plan?tradePlanId=${p.trade_plan_id}`} className="thesis-row" key={Number(p.trade_plan_id)}>
                <b>{p.ticker}</b>
                <span className={p.direction === "BULL" ? "positive" : "negative"}>{p.direction}</span>
                <span>{p.playbook_name}</span>
                <span>{format.currency(Number(p.entry))}</span>
                <span>{format.currency(Number(p.invalidation))}</span>
                <span>{format.currency(Number(p.target))}</span>
                <span>{format.currency(Number(p.planned_risk))}</span>
                <span>{format.dateTime(String(p.hold_until), { dateStyle: "medium" })}</span>
                <span>Edit</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="terminal-panel">
        <div className="panel-head">
          <span>{t("monitor.recentDecisions")}</span>
          <span>{format.number(recent.length)}</span>
        </div>
        <div className="decision-tape">
          {recent.length ? recent.map((r) => (
            <div key={Number(r.id)}>
              <time>{format.dateTime(`${r.created_at}Z`)}</time>
              <b>{r.ticker}</b>
              <span>{r.decision_type}</span>
              <p>{r.change_reason || r.thesis}</p>
            </div>
          )) : <div className="terminal-empty compact">{t("monitor.noneYet")}</div>}
        </div>
      </section>
    </div>
  );
}
