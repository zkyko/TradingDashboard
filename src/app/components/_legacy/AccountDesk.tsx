"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useFormat } from "@/app/components/useFormat";
import type { AccountDeskPayload } from "@/lib/account-desk";
import type { AccountabilityBrief } from "@/lib/insights";

const PRIVACY_KEY = "zk-account-privacy";
const ORDERS_KEY = "zk-account-orders-open";

export default function AccountDesk({ data }: { data: AccountDeskPayload }) {
  const format = useFormat();
  const [privacy, setPrivacy] = useState(true);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [brief, setBrief] = useState<AccountabilityBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState("");

  useEffect(() => {
    try {
      const p = localStorage.getItem(PRIVACY_KEY);
      const o = localStorage.getItem(ORDERS_KEY);
      if (p != null) setPrivacy(p === "1");
      if (o != null) setOrdersOpen(o === "1");
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
    localStorage.setItem(ORDERS_KEY, ordersOpen ? "1" : "0");
  }, [ordersOpen, hydrated]);

  async function loadBrief(force = false) {
    setBriefBusy(true);
    setBriefError("");
    try {
      const response = await fetch(`/api/account/brief${force ? "?force=1" : ""}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Brief failed.");
      setBrief(body as AccountabilityBrief);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : "Brief failed.");
    } finally {
      setBriefBusy(false);
    }
  }

  useEffect(() => {
    void loadBrief(false);
  }, []);

  const dayPositive = data.dayPnl >= 0;
  const ytdPositive = data.ytdPnl >= 0;
  const previewOrders = useMemo(() => data.orders.slice(0, ordersOpen ? 80 : 0), [data.orders, ordersOpen]);
  const maxMonthAbs = Math.max(...data.months.map((m) => Math.abs(m.pnl)), 1);

  return (
    <div className="acct">
      <div className="acct-toolbar">
        <label className="acct-toggle">
          <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
          Privacy mode
        </label>
        <span className="muted">
          Data since {data.since}
          {data.capturedAt ? ` · synced ${format.dateTime(data.capturedAt)}` : ""}
        </span>
      </div>

      <section className={`acct-day ${dayPositive ? "up" : "down"}`}>
        <span>Day PnL · {data.dayKey}</span>
        <b className={dayPositive ? "positive" : "negative"}>
          {dayPositive && data.dayPnl > 0 ? "+" : ""}
          {format.currency(data.dayPnl)}
        </b>
        <small>{data.dayTrades} closes today · realized from fills</small>
      </section>

      <section className="terminal-panel acct-brief">
        <div className="panel-head">
          <span>Daily accountability brief</span>
          <button type="button" disabled={briefBusy} onClick={() => void loadBrief(true)}>
            {briefBusy ? "Updating…" : "Refresh brief"}
          </button>
        </div>
        {briefError && <div className="error-box">{briefError}</div>}
        {!brief && briefBusy && <div className="terminal-empty compact">Writing today’s brief…</div>}
        {brief && (
          <div className="acct-brief-body">
            <h3>{brief.headline}</h3>
            <p className="acct-brief-story">{brief.story}</p>
            {brief.monthsRead && (
              <p className="acct-brief-months"><span>Months</span> {brief.monthsRead}</p>
            )}
            <div className="acct-brief-cols">
              <div>
                <h4>Keep</h4>
                <ul>{brief.keep.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <div>
                <h4>Watch</h4>
                <ul>{brief.watch.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </div>
            {!!brief.questions.length && (
              <div className="acct-brief-q">
                <h4>Ask yourself</h4>
                <ul>{brief.questions.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            {!!brief.commitments.length && (
              <div className="acct-brief-commit">
                <h4>Today’s process commitments</h4>
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
          <span>What you’ve been doing</span>
          <span className="muted">
            WR {data.activity.winRate == null ? "—" : `${Math.round(data.activity.winRate * 100)}%`}
            {data.activity.planLinkedPct != null
              ? ` · ${Math.round(data.activity.planLinkedPct * 100)}% plan-linked`
              : ""}
          </span>
        </div>
        <ul className="acct-activity-bullets">
          {data.activity.bullets.map((b) => <li key={b}>{b}</li>)}
        </ul>
      </section>

      <section className="terminal-panel">
        <div className="panel-head">
          <span>Month by month</span>
          <span className="muted">since {data.since}</span>
        </div>
        <div className="acct-months">
          {data.months.map((month) => {
            const up = month.pnl >= 0;
            const width = Math.max(8, (Math.abs(month.pnl) / maxMonthAbs) * 100);
            return (
              <article key={month.key} className={`acct-month ${up ? "up" : "down"}`}>
                <header>
                  <b>{month.label}</b>
                  <span className={up ? "positive" : "negative"}>
                    {up && month.pnl > 0 ? "+" : ""}
                    {format.currency(month.pnl)}
                  </span>
                </header>
                <div className="acct-month-bar">
                  <i style={{ width: `${width}%` }} />
                </div>
                <div className="acct-month-meta">
                  <span>{month.trades} closes</span>
                  <span>{month.winRate == null ? "—" : `${Math.round(month.winRate * 100)}% WR`}</span>
                  <span>{month.activeDays} days</span>
                  {month.topTicker && <span>{month.topTicker}</span>}
                </div>
                <p>{month.blurb}</p>
              </article>
            );
          })}
          {!data.months.length && <div className="terminal-empty compact">No monthly closes yet.</div>}
        </div>
      </section>

      {!privacy && (
        <div className="account-grid">
          {data.accounts.map((account) => (
            <section className="terminal-panel" key={account.accountNumber || account.mask}>
              <div className="panel-head">
                <span>{account.nickname.toUpperCase()} · {account.mask}</span>
                <span className={account.state === "active" ? "positive" : "negative"}>
                  {account.state.toUpperCase()}
                </span>
              </div>
              <div className="account-metrics">
                <div><span>Account value</span><b>{format.currency(account.totalValue)}</b></div>
                <div><span>Cash</span><b>{format.currency(account.cash)}</b></div>
                <div><span>Buying power</span><b>{format.currency(account.buyingPower)}</b></div>
                <div><span>Unleveraged BP</span><b>{format.currency(account.unleveragedBp)}</b></div>
                <div>
                  <span>Margin capacity</span>
                  <b className={account.marginCapacity > 0 ? "amber" : ""}>{format.currency(account.marginCapacity)}</b>
                </div>
                <div><span>Account type</span><b>{account.type.toUpperCase()}</b></div>
                <div><span>Equity value</span><b>{format.currency(account.equityValue)}</b></div>
                <div><span>Options value</span><b>{format.currency(account.optionsValue)}</b></div>
                <div><span>Crypto value</span><b>{format.currency(account.cryptoValue)}</b></div>
                <div><span>Pending deposits</span><b>{format.currency(account.pendingDeposits)}</b></div>
                <div><span>Options level</span><b>{account.optionLevel}</b></div>
              </div>
            </section>
          ))}
          {!data.accounts.length && (
            <div className="terminal-empty">No snapshot. Run sync.</div>
          )}
        </div>
      )}

      {privacy && (
        <p className="muted acct-privacy-note">
          Sensitive balances hidden. Toggle Privacy mode off to show account value, cash, buying power, and masks.
        </p>
      )}

      <div className="acct-viz-grid">
        <section className="terminal-panel acct-viz">
          <div className="panel-head">
            <span>YTD realized curve</span>
            <span className={ytdPositive ? "positive" : "negative"}>
              {ytdPositive && data.ytdPnl > 0 ? "+" : ""}
              {format.currency(data.ytdPnl)} · {data.ytdTrades} closes
            </span>
          </div>
          <PnlCurve points={data.equityCurve} money={format.currency} />
        </section>

        <section className="terminal-panel acct-viz">
          <div className="panel-head">
            <span>Daily realized</span>
            <span className="muted">{data.dailyBars.length} sessions</span>
          </div>
          <DailyBars bars={data.dailyBars} money={format.currency} />
        </section>

        <section className="terminal-panel acct-viz wide">
          <div className="panel-head">
            <span>By ticker · YTD</span>
            <span className="muted">top |pnl|</span>
          </div>
          <TickerBars rows={data.byTicker} money={format.currency} />
        </section>
      </div>

      <section className="terminal-panel">
        <div className="panel-head">
          <span>Orders · since {data.since}</span>
          <button type="button" onClick={() => setOrdersOpen((v) => !v)}>
            {ordersOpen ? "Minimize" : `Show ${format.number(data.orderCount)}`}
          </button>
        </div>
        {!ordersOpen && (
          <div className="acct-orders-collapsed">
            <p className="muted">{format.number(data.orderCount)} orders folded · open when you need the tape.</p>
          </div>
        )}
        {ordersOpen && (
          <div className="orders-table">
            <div className="order-row header">
              <span>Created</span>
              {!privacy && <span>Account</span>}
              <span>Symbol</span>
              <span>Side</span>
              <span>Type</span>
              <span>State</span>
              <span>Qty</span>
              <span>Filled</span>
              <span>Avg px</span>
              <span>Source</span>
            </div>
            {previewOrders.map((order) => (
              <div className="order-row" key={String(order.external_id)}>
                <time>{format.dateTime(order.created_at)}</time>
                {!privacy && <span>{order.account_mask}</span>}
                <b>{order.ticker}</b>
                <span className={order.side === "BUY" ? "positive" : "negative"}>{order.side}</span>
                <span>{order.order_type}</span>
                <span>{order.state}</span>
                <span>{order.quantity != null ? format.number(Number(order.quantity)) : "$ BASED"}</span>
                <span>{format.number(Number(order.filled_quantity || 0))}</span>
                <span>{order.average_price ? format.currency(Number(order.average_price)) : "—"}</span>
                <span>{order.placed_agent || "user"}</span>
              </div>
            ))}
            {!previewOrders.length && (
              <div className="terminal-empty">No orders since {data.since}</div>
            )}
            {ordersOpen && data.orders.length > 80 && (
              <p className="muted" style={{ padding: 12 }}>Showing latest 80 of {data.orderCount}.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function PnlCurve({
  points,
  money,
}: {
  points: Array<{ t: string; pnl: number }>;
  money: (n: number) => string;
}) {
  const gradId = useId().replace(/:/g, "");
  if (points.length < 2) {
    return <div className="terminal-empty compact">Need more closes since Jan 2026 for a curve.</div>;
  }
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
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="YTD realized PnL">
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
        <span className="muted">{points[0].t.slice(0, 10)}</span>
        <b className={up ? "positive" : "negative"}>{money(last)}</b>
        <span className="muted">{points[points.length - 1].t.slice(0, 10)}</span>
      </div>
    </div>
  );
}

function DailyBars({
  bars,
  money,
}: {
  bars: Array<{ date: string; pnl: number; trades: number; orders: number }>;
  money: (n: number) => string;
}) {
  if (!bars.length) return <div className="terminal-empty compact">No daily bars yet.</div>;
  const recent = bars.slice(-48);
  const maxAbs = Math.max(...recent.map((b) => Math.abs(b.pnl)), 1);
  return (
    <div className="acct-bars">
      <div className="acct-bars-row" aria-label="Daily realized PnL">
        {recent.map((bar) => {
          const h = Math.max(4, (Math.abs(bar.pnl) / maxAbs) * 100);
          const up = bar.pnl >= 0;
          return (
            <div
              key={bar.date}
              className={`acct-bar ${up ? "up" : "down"}`}
              title={`${bar.date}: ${money(bar.pnl)} · ${bar.trades} closes · ${bar.orders} orders`}
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>
      <div className="acct-chart-foot">
        <span className="muted">{recent[0]?.date}</span>
        <span className="muted">hover bars</span>
        <span className="muted">{recent[recent.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function TickerBars({
  rows,
  money,
}: {
  rows: Array<{ ticker: string; pnl: number; trades: number }>;
  money: (n: number) => string;
}) {
  if (!rows.length) return <div className="terminal-empty compact">No ticker closes since Jan 2026.</div>;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1);
  return (
    <div className="acct-tickers">
      {rows.map((row) => {
        const pct = (Math.abs(row.pnl) / maxAbs) * 100;
        const up = row.pnl >= 0;
        return (
          <div key={row.ticker} className="acct-ticker-row">
            <b>{row.ticker}</b>
            <div className="acct-ticker-track">
              <i className={up ? "up" : "down"} style={{ width: `${pct}%` }} />
            </div>
            <span className={up ? "positive" : "negative"}>
              {up && row.pnl > 0 ? "+" : ""}
              {money(row.pnl)}
            </span>
            <small className="muted">{row.trades}</small>
          </div>
        );
      })}
    </div>
  );
}
