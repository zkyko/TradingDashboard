"use client";

import { useEffect, useId, useMemo, useState } from "react";
import OptionsPnlCalendar from "@/app/components/OptionsPnlCalendar";
import { useFormat } from "@/app/components/useFormat";
import type { OptionsDeepDive, OptionsProcessBrief } from "@/lib/insights";
import type { OptionsReflection } from "@/lib/options-reflection";
import type { OptionsHistoryMl } from "@/lib/python-service";

const PRIVACY_KEY = "zk-options-privacy";
const TAPE_KEY = "zk-options-tape-open";

export default function OptionsDesk({ data }: { data: OptionsReflection }) {
  const format = useFormat();
  const [privacy, setPrivacy] = useState(true);
  const [tapeOpen, setTapeOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [brief, setBrief] = useState<OptionsProcessBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState("");
  const [ml, setMl] = useState<OptionsHistoryMl | null>(null);
  const [mlBusy, setMlBusy] = useState(false);
  const [mlError, setMlError] = useState("");
  const [dive, setDive] = useState<OptionsDeepDive | null>(null);
  const [diveBusy, setDiveBusy] = useState(false);
  const [diveError, setDiveError] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  useEffect(() => {
    try {
      const p = localStorage.getItem(PRIVACY_KEY);
      const t = localStorage.getItem(TAPE_KEY);
      if (p != null) setPrivacy(p === "1");
      if (t != null) setTapeOpen(t === "1");
    } catch {
      /* defaults */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(PRIVACY_KEY, privacy ? "1" : "0");
  }, [privacy, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(TAPE_KEY, tapeOpen ? "1" : "0");
  }, [tapeOpen, hydrated]);

  async function loadBrief(force = false) {
    setBriefBusy(true);
    setBriefError("");
    try {
      const response = await fetch(`/api/options/brief${force ? "?force=1" : ""}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Brief failed.");
      setBrief(body as OptionsProcessBrief);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : "Brief failed.");
    } finally {
      setBriefBusy(false);
    }
  }

  async function loadMl() {
    setMlBusy(true);
    setMlError("");
    try {
      const response = await fetch("/api/options/ml");
      const body = await response.json();
      if (!response.ok || body.ok === false) throw new Error(body.error || "ML failed.");
      setMl(body as OptionsHistoryMl);
      return body as OptionsHistoryMl;
    } catch (err) {
      setMlError(err instanceof Error ? err.message : "ML failed.");
      return null;
    } finally {
      setMlBusy(false);
    }
  }

  async function loadDive(force = false, mlPayload?: OptionsHistoryMl | null) {
    setDiveBusy(true);
    setDiveError("");
    try {
      const response = await fetch(`/api/options/deepdive${force ? "?force=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ml: mlPayload || ml || undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Deep dive failed.");
      setDive(body as OptionsDeepDive);
      if (body.ml && typeof body.ml === "object" && body.ml.ok) setMl(body.ml as OptionsHistoryMl);
    } catch (err) {
      setDiveError(err instanceof Error ? err.message : "Deep dive failed.");
    } finally {
      setDiveBusy(false);
    }
  }

  async function pullFullHistory() {
    setSyncBusy(true);
    setSyncMsg("");
    try {
      const response = await fetch("/api/options/sync", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Sync failed.");
      setSyncMsg(
        `Pulled ${body.optionOrdersInSnapshot ?? "?"} orders · stored ${body.stored?.total ?? "?"} (${body.stored?.earliest?.slice(0, 10) || "?"} → ${body.stored?.latest?.slice(0, 10) || "?"}). Refresh the page.`,
      );
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      await loadBrief(false);
      const mlResult = await loadMl();
      await loadDive(false, mlResult);
    })();
  }, []);

  const money = (n: number) => (privacy ? "••••" : format.currency(n));
  const signed = (n: number) => {
    if (privacy) return "••••";
    return `${n > 0 ? "+" : ""}${format.currency(n)}`;
  };
  const preview = useMemo(() => data.orders.slice(0, tapeOpen ? 120 : 0), [data.orders, tapeOpen]);
  const maxMonth = Math.max(...data.byMonth.map((m) => Math.abs(m.netCashflow)), 1);
  const maxUnd = Math.max(...data.byUnderlying.map((u) => Math.abs(u.netCashflow)), 1);
  const maxHour = Math.max(...data.byHour.map((h) => h.orders), 1);
  const maxImp = Math.max(...(ml?.cancelModel?.featureImportance.map((f) => f.importance) || [1]), 1);
  const cfUp = data.netCashflow >= 0;
  const rtUp = data.roundTripPnl >= 0;

  return (
    <div className="opts">
      <div className="acct-toolbar">
        <label className="acct-toggle">
          <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
          Privacy mode
        </label>
        <button type="button" disabled={syncBusy} onClick={() => void pullFullHistory()}>
          {syncBusy ? "Pulling…" : "Pull full history"}
        </button>
        <span className="muted">
          {format.number(data.orderCount)} orders · {data.since}
          {data.latest ? ` → ${data.latest.slice(0, 10)}` : ""}
          {data.cancelRate != null ? ` · ${Math.round(data.cancelRate * 100)}% cancel` : ""}
        </span>
      </div>
      {syncMsg && <p className="muted" style={{ marginBottom: 12 }}>{syncMsg}</p>}

      <div className="opts-kpis">
        <div>
          <span>Orders</span>
          <b>{format.number(data.orderCount)}</b>
          <small>{data.filledCount} filled · {data.canceledCount} canceled</small>
        </div>
        <div>
          <span>Premium CF</span>
          <b className={cfUp ? "positive" : "negative"}>{signed(data.netCashflow)}</b>
          <small>{data.uniqueUnderlyings} underlyings</small>
        </div>
        <div>
          <span>Round trips</span>
          <b className={rtUp ? "positive" : "negative"}>{signed(data.roundTripPnl)}</b>
          <small>
            {data.roundTripCount} matched
            {data.avgHoldHours != null ? ` · avg ${data.avgHoldHours.toFixed(1)}h` : ""}
          </small>
        </div>
        <div>
          <span>Debit / credit</span>
          <b>{privacy ? "••••" : `${format.currency(data.debitSpend)} / ${format.currency(data.creditReceive)}`}</b>
          <small>paid · received</small>
        </div>
      </div>

      <section className="terminal-panel acct-brief opts-deepdive">
        <div className="panel-head">
          <span>ML → AI deep dive · what to do</span>
          <button
            type="button"
            disabled={diveBusy || mlBusy}
            onClick={async () => {
              const mlResult = await loadMl();
              await loadDive(true, mlResult);
            }}
          >
            {diveBusy || mlBusy ? "Running…" : "Re-run deep dive"}
          </button>
        </div>
        {diveError && <div className="error-box">{diveError}</div>}
        {diveBusy && !dive && <div className="terminal-empty compact">Running Python ML, then AI rewrite…</div>}
        {dive && (
          <div className="acct-brief-body">
            <h3>{dive.headline}</h3>
            <p className="acct-brief-story">{dive.verdict}</p>
            <div className="acct-brief-cols">
              <div>
                <h4>What worked</h4>
                <ul>{dive.whatWorked.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <div>
                <h4>What hurt</h4>
                <ul>{dive.whatHurt.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </div>
            <div className="acct-brief-cols">
              <div>
                <h4>Do next</h4>
                <ul>{dive.doNext.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <div>
                <h4>Avoid</h4>
                <ul>{dive.avoid.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </div>
            {dive.mlRead && (
              <p className="acct-brief-months"><span>ML read</span> {dive.mlRead}</p>
            )}
            {dive.calendarRead && (
              <p className="acct-brief-months"><span>Calendar</span> {dive.calendarRead}</p>
            )}
            <p className="muted acct-brief-meta">
              {dive.offline ? "Offline local dive" : "AI rewrite of Python ML"}
              {dive.cached ? " · cached for today" : " · fresh"}
              {" · "}{format.dateTime(dive.updatedAt)}
              {" · "}process only — not trade advice
            </p>
          </div>
        )}
      </section>

      <OptionsPnlCalendar privacy={privacy} />

      <section className="terminal-panel acct-brief">
        <div className="panel-head">
          <span>AI options reflection</span>
          <button type="button" disabled={briefBusy} onClick={() => void loadBrief(true)}>
            {briefBusy ? "Updating…" : "Refresh brief"}
          </button>
        </div>
        {briefError && <div className="error-box">{briefError}</div>}
        {!brief && briefBusy && <div className="terminal-empty compact">Writing options exit brief…</div>}
        {brief && (
          <div className="acct-brief-body">
            <h3>{brief.headline}</h3>
            <p className="acct-brief-story">{brief.story}</p>
            <div className="acct-brief-cols">
              <div>
                <h4>Patterns</h4>
                <ul>{brief.patterns.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <div>
                <h4>Retire</h4>
                <ul>{brief.retire.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </div>
            <div className="acct-brief-cols">
              <div>
                <h4>Keep</h4>
                <ul>{brief.keep.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <div>
                <h4>Ask yourself</h4>
                <ul>{brief.questions.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </div>
            {!!brief.commitments.length && (
              <div className="acct-brief-commit">
                <h4>Commitments</h4>
                <ul>{brief.commitments.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            <p className="muted acct-brief-meta">
              {brief.offline ? "Offline local brief" : "AI process brief"}
              {brief.cached ? " · cached for today" : " · fresh"}
              {" · "}{format.dateTime(brief.updatedAt)}
              {" · "}not trade advice
            </p>
          </div>
        )}
      </section>

      <section className="terminal-panel">
        <div className="panel-head">
          <span>Python ML on your order history</span>
          <button type="button" disabled={mlBusy} onClick={() => void loadMl()}>
            {mlBusy ? "Running…" : "Re-run ML"}
          </button>
        </div>
        {mlError && <div className="error-box">{mlError}</div>}
        {mlBusy && !ml && <div className="terminal-empty compact">Fitting cancel model + clusters…</div>}
        {ml?.ok && (
          <div className="opts-ml">
            <p className="muted opts-ml-note">{ml.cancelModel?.note || ml.disclaimer}</p>
            <div className="opts-ml-grid">
              <div>
                <h4>Cancel model</h4>
                <div className="opts-ml-scores">
                  <span>Train {ml.cancelModel?.trainAccuracy == null ? "—" : `${Math.round(ml.cancelModel.trainAccuracy * 100)}%`}</span>
                  <span>Test {ml.cancelModel?.testAccuracy == null ? "—" : `${Math.round(ml.cancelModel.testAccuracy * 100)}%`}</span>
                  <span>Cancel base {ml.summary ? `${Math.round(ml.summary.overallCancelRate * 100)}%` : "—"}</span>
                </div>
                <div className="acct-tickers">
                  {(ml.cancelModel?.featureImportance || []).map((f) => (
                    <div key={f.feature} className="acct-ticker-row">
                      <b>{f.feature}</b>
                      <div className="acct-ticker-track">
                        <i className="up" style={{ width: `${(f.importance / maxImp) * 100}%` }} />
                      </div>
                      <span className="muted">{f.importance.toFixed(2)}</span>
                      <small className="muted" />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4>Behavior clusters</h4>
                <ul className="opts-cluster-list">
                  {(ml.clusters || []).map((c) => (
                    <li key={c.id}>
                      <b>{c.blurb}</b>
                      <span className="muted">{c.size} orders · {Math.round(c.share * 100)}%</span>
                      <span className={c.netCashflow >= 0 ? "positive" : "negative"}>{signed(c.netCashflow)}</span>
                    </li>
                  ))}
                  {!ml.clusters?.length && <li className="muted">Not enough structure for clusters.</li>}
                </ul>
              </div>
            </div>
            {!!ml.regime?.length && (
              <div className="opts-regime">
                <h4>Regime · rolling cancel + cumulative CF</h4>
                <RegimeChart points={ml.regime} privacy={privacy} money={format.currency} />
              </div>
            )}
          </div>
        )}
      </section>

      <ul className="acct-activity-bullets opts-bullets">
        {data.bullets.map((b) => <li key={b}>{b}</li>)}
      </ul>

      <div className="acct-viz-grid">
        <section className="terminal-panel acct-viz">
          <div className="panel-head">
            <span>Cumulative premium CF</span>
            <span className={cfUp ? "positive" : "negative"}>{signed(data.netCashflow)}</span>
          </div>
          <PnlCurve points={data.cashflowCurve} money={money} />
        </section>
        <section className="terminal-panel acct-viz">
          <div className="panel-head">
            <span>Daily premium CF</span>
            <span className="muted">{data.dailyBars.length} sessions</span>
          </div>
          <DailyBars bars={data.dailyBars} money={signed} />
        </section>
        <section className="terminal-panel acct-viz">
          <div className="panel-head">
            <span>Hour-of-day activity</span>
            <span className="muted">orders</span>
          </div>
          <HourBars bars={data.byHour} max={maxHour} />
        </section>
        <section className="terminal-panel acct-viz">
          <div className="panel-head">
            <span>Weekday</span>
            <span className="muted">orders · CF</span>
          </div>
          <DowBars bars={data.byDow} money={signed} />
        </section>
      </div>

      <section className="terminal-panel">
        <div className="panel-head">
          <span>Month by month</span>
          <span className="muted">since {data.since}</span>
        </div>
        <div className="acct-months">
          {data.byMonth.map((month) => {
            const up = month.netCashflow >= 0;
            const width = Math.max(8, (Math.abs(month.netCashflow) / maxMonth) * 100);
            return (
              <article key={month.key} className={`acct-month ${up ? "up" : "down"}`}>
                <header>
                  <b>{month.label}</b>
                  <span className={up ? "positive" : "negative"}>{signed(month.netCashflow)}</span>
                </header>
                <div className="acct-month-bar"><i style={{ width: `${width}%` }} /></div>
                <div className="acct-month-meta">
                  <span>{month.orders} orders</span>
                  <span>{month.filled} filled</span>
                  <span>{month.canceled} cancel</span>
                  {month.topUnderlying && <span>{month.topUnderlying}</span>}
                </div>
              </article>
            );
          })}
          {!data.byMonth.length && <div className="terminal-empty compact">No months yet.</div>}
        </div>
      </section>

      <div className="opts-split">
        <section className="terminal-panel">
          <div className="panel-head"><span>By underlying</span><span className="muted">top activity</span></div>
          <div className="acct-tickers" style={{ padding: 14 }}>
            {data.byUnderlying.map((row) => {
              const pct = (Math.abs(row.netCashflow) / maxUnd) * 100;
              const up = row.netCashflow >= 0;
              return (
                <div key={row.underlying} className="acct-ticker-row">
                  <b>{row.underlying}</b>
                  <div className="acct-ticker-track">
                    <i className={up ? "up" : "down"} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={up ? "positive" : "negative"}>{signed(row.netCashflow)}</span>
                  <small className="muted">{row.orders}</small>
                </div>
              );
            })}
          </div>
        </section>
        <section className="terminal-panel">
          <div className="panel-head"><span>Structures · DTE</span></div>
          <div className="opts-side-lists">
            <ul className="acct-strategy-list">
              {data.byStrategy.map((s) => (
                <li key={s.strategy}>
                  <b>{s.strategy}</b>
                  <span className="muted">{s.count}</span>
                  <span className={s.netCashflow >= 0 ? "positive" : "negative"}>{signed(s.netCashflow)}</span>
                </li>
              ))}
            </ul>
            <ul className="acct-strategy-list">
              {data.byDte.map((s) => (
                <li key={s.bucket}>
                  <b>{s.bucket}</b>
                  <span className="muted">{s.orders}</span>
                  <span className={s.netCashflow >= 0 ? "positive" : "negative"}>{signed(s.netCashflow)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <section className="terminal-panel">
        <div className="panel-head">
          <span>Matched round trips</span>
          <span className={rtUp ? "positive" : "negative"}>
            {data.roundTripCount} · {signed(data.roundTripPnl)}
          </span>
        </div>
        <div className="orders-table opts-rt-table">
          <div className="order-row header opts-rt-row">
            <span>Closed</span>
            <span>Contract</span>
            <span>Hold</span>
            <span>Open</span>
            <span>Close</span>
            <span>PnL</span>
          </div>
          {data.roundTrips.slice(0, 40).map((t) => (
            <div className="order-row opts-rt-row" key={`${t.contract}-${t.openedAt}-${t.closedAt}`}>
              <time>{format.dateTime(t.closedAt)}</time>
              <b>{t.contract}</b>
              <span>{t.holdHours < 24 ? `${t.holdHours.toFixed(1)}h` : `${(t.holdHours / 24).toFixed(1)}d`}</span>
              <span>{money(t.openPremium)}</span>
              <span>{money(t.closePremium)}</span>
              <span className={t.pnl >= 0 ? "positive" : "negative"}>{signed(t.pnl)}</span>
            </div>
          ))}
          {!data.roundTrips.length && (
            <div className="terminal-empty">No matched open→close pairs yet (need legs with strike/expiry).</div>
          )}
        </div>
      </section>

      <section className="terminal-panel">
        <div className="panel-head">
          <span>Full options tape</span>
          <button type="button" onClick={() => setTapeOpen((v) => !v)}>
            {tapeOpen ? "Minimize" : `Show ${format.number(data.orderCount)}`}
          </button>
        </div>
        {!tapeOpen && (
          <div className="acct-orders-collapsed">
            <p className="muted">{format.number(data.orderCount)} orders folded.</p>
          </div>
        )}
        {tapeOpen && (
          <div className="orders-table opts-table">
            <div className="order-row header opts-row">
              <span>Created</span>
              <span>Und</span>
              <span>Dir</span>
              <span>State</span>
              <span>Strategy</span>
              <span>Legs</span>
              <span>DTE</span>
              <span>Filled</span>
              <span>CF</span>
            </div>
            {preview.map((order) => (
              <div className="order-row opts-row" key={String(order.external_id)}>
                <time>{format.dateTime(order.created_at)}</time>
                <b>{order.underlying}</b>
                <span className={order.direction === "credit" ? "positive" : "negative"}>
                  {order.direction.toUpperCase()}
                </span>
                <span>{order.state}</span>
                <span>{order.strategy?.replace(/_/g, " ") || "—"}</span>
                <span className="opts-legs" title={order.legSummary}>{order.legSummary}</span>
                <span>{order.dte == null ? "—" : order.dte}</span>
                <span>{format.number(Number(order.filled_quantity || 0))}/{format.number(Number(order.quantity || 0))}</span>
                <span className={order.cashflow == null ? "" : order.cashflow >= 0 ? "positive" : "negative"}>
                  {order.cashflow == null ? "—" : signed(order.cashflow)}
                </span>
              </div>
            ))}
            {tapeOpen && data.orders.length > 120 && (
              <p className="muted" style={{ padding: 12 }}>Showing latest 120 of {data.orderCount}.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function PnlCurve({ points, money }: { points: Array<{ t: string; pnl: number }>; money: (n: number) => string }) {
  const gradId = useId().replace(/:/g, "");
  if (points.length < 2) return <div className="terminal-empty compact">Need more filled days for a curve.</div>;
  const w = 640;
  const h = 180;
  const pad = { l: 8, r: 8, t: 12, b: 12 };
  const vals = points.map((p) => p.pnl);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 0);
  const span = max - min || 1;
  const xAt = (i: number) => pad.l + (i / (points.length - 1)) * (w - pad.l - pad.r);
  const yAt = (v: number) => h - pad.b - ((v - min) / span) * (h - pad.t - pad.b);
  const line = points.map((p, i) => `${xAt(i)},${yAt(p.pnl)}`).join(" ");
  const area = `${xAt(0)},${yAt(0)} ${line} ${xAt(points.length - 1)},${yAt(0)}`;
  const last = points[points.length - 1].pnl;
  const up = last >= 0;
  const stroke = up ? "#22c55e" : "#ef4444";
  return (
    <div className="acct-chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Options cashflow curve">
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={pad.l} x2={w - pad.r} y1={yAt(0)} y2={yAt(0)} stroke="rgba(148,163,184,0.25)" strokeDasharray="4 4" />
        <polygon points={area} fill={`url(#${gradId})`} />
        <polyline points={line} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
      <div className="acct-chart-foot">
        <span className="muted">{points[0].t}</span>
        <b className={up ? "positive" : "negative"}>{money(last)}</b>
        <span className="muted">{points[points.length - 1].t}</span>
      </div>
    </div>
  );
}

function DailyBars({
  bars,
  money,
}: {
  bars: Array<{ date: string; pnl?: number; netCashflow?: number; orders: number }>;
  money: (n: number) => string;
}) {
  if (!bars.length) return <div className="terminal-empty compact">No daily bars.</div>;
  const recent = bars.slice(-60);
  const vals = recent.map((b) => b.netCashflow ?? b.pnl ?? 0);
  const maxAbs = Math.max(...vals.map((v) => Math.abs(v)), 1);
  return (
    <div className="acct-bars">
      <div className="acct-bars-row">
        {recent.map((bar, i) => {
          const v = vals[i];
          const h = Math.max(4, (Math.abs(v) / maxAbs) * 100);
          return (
            <div
              key={bar.date}
              className={`acct-bar ${v >= 0 ? "up" : "down"}`}
              title={`${bar.date}: ${money(v)} · ${bar.orders} orders`}
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>
      <div className="acct-chart-foot">
        <span className="muted">{recent[0]?.date}</span>
        <span className="muted">hover</span>
        <span className="muted">{recent[recent.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function HourBars({ bars, max }: { bars: Array<{ hour: number; orders: number; canceled: number }>; max: number }) {
  return (
    <div className="opts-hour">
      {bars.map((b) => (
        <div key={b.hour} className="opts-hour-col" title={`${b.hour}:00 · ${b.orders} orders · ${b.canceled} cancel`}>
          <i style={{ height: `${Math.max(4, (b.orders / max) * 100)}%` }} />
          <span>{b.hour}</span>
        </div>
      ))}
    </div>
  );
}

function DowBars({
  bars,
  money,
}: {
  bars: Array<{ dow: number; label: string; orders: number; netCashflow: number }>;
  money: (n: number) => string;
}) {
  const max = Math.max(...bars.map((b) => b.orders), 1);
  return (
    <div className="opts-dow">
      {bars.map((b) => (
        <div key={b.dow} className="opts-dow-row">
          <b>{b.label}</b>
          <div className="acct-ticker-track">
            <i className={b.netCashflow >= 0 ? "up" : "down"} style={{ width: `${(b.orders / max) * 100}%` }} />
          </div>
          <span className="muted">{b.orders}</span>
          <span className={b.netCashflow >= 0 ? "positive" : "negative"}>{money(b.netCashflow)}</span>
        </div>
      ))}
    </div>
  );
}

function RegimeChart({
  points,
  privacy,
  money,
}: {
  points: Array<{ t: string; cancelRate20: number | null; cashflowCum: number }>;
  privacy: boolean;
  money: (n: number) => string;
}) {
  const w = 720;
  const h = 160;
  const pad = { l: 8, r: 8, t: 10, b: 10 };
  const cfs = points.map((p) => p.cashflowCum);
  const min = Math.min(...cfs, 0);
  const max = Math.max(...cfs, 0);
  const span = max - min || 1;
  const xAt = (i: number) => pad.l + (i / Math.max(points.length - 1, 1)) * (w - pad.l - pad.r);
  const yAt = (v: number) => h - pad.b - ((v - min) / span) * (h - pad.t - pad.b);
  const line = points.map((p, i) => `${xAt(i)},${yAt(p.cashflowCum)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <div className="acct-chart" style={{ padding: "0 14px 12px" }}>
      <svg viewBox={`0 0 ${w} ${h}`}>
        <line x1={pad.l} x2={w - pad.r} y1={yAt(0)} y2={yAt(0)} stroke="rgba(148,163,184,0.25)" strokeDasharray="4 4" />
        <polyline points={line} fill="none" stroke="#38bdf8" strokeWidth="2" />
      </svg>
      <div className="acct-chart-foot">
        <span className="muted">{points[0]?.t?.slice(0, 10)}</span>
        <span>
          CF {privacy ? "••••" : money(last.cashflowCum)}
          {last.cancelRate20 != null ? ` · roll cancel ${Math.round(last.cancelRate20 * 100)}%` : ""}
        </span>
        <span className="muted">{last.t?.slice(0, 10)}</span>
      </div>
    </div>
  );
}
