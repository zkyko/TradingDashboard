"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useFormat } from "@/app/components/useFormat";
import SetupTapeChart from "@/app/components/SetupTapeChart";
import type { MorningScanResult } from "@/lib/morning-scan";
import type { AppNotification, PriceAlert } from "@/lib/notifications";
import type { TraderPlan } from "@/lib/trader-plan";
import { useCurrentLocale } from "@/locales/client";
import { localePath } from "@/lib/locale";
import type { LiveBar } from "@/lib/python-service";

export default function NotificationsDesk() {
  const format = useFormat();
  const locale = useCurrentLocale();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [plan, setPlan] = useState<TraderPlan | null>(null);
  const [morning, setMorning] = useState<MorningScanResult | null>(null);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tickBusy, setTickBusy] = useState(false);
  const [morningBusy, setMorningBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [symbol, setSymbol] = useState("SOXL");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [notifRes, morningRes] = await Promise.all([
        fetch("/api/notifications"),
        fetch("/api/morning"),
      ]);
      const body = await notifRes.json();
      if (!notifRes.ok) throw new Error(body.error || "Load failed.");
      setNotifications(body.notifications || []);
      setAlerts(body.alerts || []);
      setPlan(body.plan || null);
      setUnread(body.unread || 0);
      if (morningRes.ok) {
        const m = await morningRes.json();
        setMorning(m.morning || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(action: string, payload: Record<string, unknown> = {}) {
    const response = await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Action failed.");
    return body;
  }

  async function addAlert(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await post("create_alert", {
        symbol,
        direction,
        price: Number(price),
        note: note || undefined,
      });
      setPrice("");
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create alert.");
    }
  }

  async function runTick() {
    setTickBusy(true);
    setMsg("");
    setError("");
    try {
      const response = await fetch("/api/cron/tick?watch=1", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Tick failed.");
      setMsg(
        `Tick @ ${body.tick?.at || "now"} · price hits ${body.tick?.priceHits ?? 0} · setups ${body.tick?.setupHits ?? 0} · unread ${body.tick?.unread ?? "—"}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tick failed.");
    } finally {
      setTickBusy(false);
    }
  }

  async function runMorning() {
    setMorningBusy(true);
    setMsg("");
    setError("");
    try {
      const response = await fetch("/api/morning", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Morning scan failed.");
      setMorning(body.morning || null);
      setMsg(
        `Morning scan · ${(body.morning?.setups || []).length} setups · ${(body.morning?.symbols || []).length} symbols`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Morning scan failed.");
    } finally {
      setMorningBusy(false);
    }
  }

  return (
    <div className="notif">
      <div className="acct-toolbar">
        <span className="muted">{unread} unread · {busy ? "loading…" : "live"}</span>
        <button type="button" disabled={tickBusy} onClick={() => void runTick()}>
          {tickBusy ? "Scanning…" : "Run scan now"}
        </button>
        <button type="button" disabled={morningBusy} onClick={() => void runMorning()}>
          {morningBusy ? "RH morning…" : "Run 7:30 morning scan"}
        </button>
        <button
          type="button"
          onClick={async () => {
            await post("mark_all_read");
            await load();
          }}
        >
          Mark all read
        </button>
      </div>
      {msg && <p className="muted" style={{ marginBottom: 12 }}>{msg}</p>}
      {error && <div className="error-box">{error}</div>}

      <section className="terminal-panel">
        <div className="panel-head">
          <span>RH morning tape → VP setups</span>
          <span className="muted">
            {morning ? `${morning.dayKey} · ${format.dateTime(morning.capturedAt)}` : "not run yet"}
          </span>
        </div>
        {morning ? (
          <div className="morning-scan">
            <p className="morning-summary">{morning.summary}</p>
            <div className="morning-buckets">
              {morning.buckets.map((b) => (
                <div key={b.key} className="morning-bucket">
                  <span>{b.title}</span>
                  <b>{b.rows.slice(0, 6).map((r) => r.ticker).join(" · ") || "—"}</b>
                  {b.error && <small className="muted">{b.error}</small>}
                </div>
              ))}
            </div>
            <div className="morning-setups">
              {morning.setups.map((s) => (
                <article key={s.symbol} className="morning-setup">
                  <div className="morning-setup-grid">
                    <div className="morning-setup-copy">
                      <header>
                        <b>{s.symbol}</b>
                        <span className="muted">{s.sources.join(", ")}</span>
                        <span className={(s.changePct || 0) >= 0 ? "positive" : "negative"}>
                          {s.changePct == null ? "—" : `${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(2)}%`}
                        </span>
                      </header>
                      <div className="morning-levels">
                        {(["daily", "weekly", "intraday"] as const).map((tf) => {
                          const lvl = s.levels[tf];
                          if (!lvl) return null;
                          return (
                            <div key={tf}>
                              <span>{tf}</span>
                              VAL {lvl.val != null ? format.currency(lvl.val) : "—"}
                              {" · "}POC {lvl.poc != null ? format.currency(lvl.poc) : "—"}
                              {" · "}VAH {lvl.vah != null ? format.currency(lvl.vah) : "—"}
                              {lvl.position ? ` (${lvl.position})` : ""}
                            </div>
                          );
                        })}
                      </div>
                      <ul>
                        {s.plays.map((p) => (
                          <li key={p.id}>
                            <b>{p.name}</b> · heat {p.heat} · {p.status}
                            <div className="muted">{p.tagline}. Watch: {p.watch}</div>
                            <div className="muted">Invalidation: {p.invalidation}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <SetupTapeChart
                      symbol={s.symbol}
                      bars={s.bars as LiveBar[] | undefined}
                      vpLevels={s.levels.daily}
                      height={200}
                    />
                  </div>
                </article>
              ))}
              {!morning.setups.length && (
                <div className="terminal-empty compact">No hot VP setups on this tape yet.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="terminal-empty compact">
            Run the morning scan (or wait for weekday 7:30 cron) to pull RH movers / options volume / stock volume and build VP setups.
          </div>
        )}
      </section>

      {plan && (
        <section className="terminal-panel">
          <div className="panel-head">
            <span>Operating plan</span>
            <span className="muted">fed to AI + reminders</span>
          </div>
          <div className="notif-plan">
            <p><b>Focus</b> {plan.focus}</p>
            <p><b>Process</b> {plan.process}</p>
            <p><b>Goal</b> {plan.goal}</p>
            <p><b>Universe</b> {plan.universe.join(" · ")}</p>
            <p className="muted">
              {plan.noOptions ? "No options." : ""} {plan.writeBeforeTrade ? "Write before every buy/sell." : ""}
            </p>
          </div>
        </section>
      )}

      <section className="terminal-panel">
        <div className="panel-head">
          <span>Price alerts</span>
          <span className="muted">cron checks regularly</span>
        </div>
        <form className="notif-alert-form" onSubmit={(e) => void addAlert(e)}>
          <label>
            Symbol
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="SOXL" />
          </label>
          <label>
            When
            <select value={direction} onChange={(e) => setDirection(e.target.value as "above" | "below")}>
              <option value="above">reaches above</option>
              <option value="below">reaches below</option>
            </select>
          </label>
          <label>
            Price
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="42.50" inputMode="decimal" />
          </label>
          <label className="span-2">
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write thesis before acting" />
          </label>
          <button type="submit" className="primary">Add alert</button>
        </form>
        <div className="orders-table">
          <div className="order-row header notif-alert-row">
            <span>Symbol</span>
            <span>Condition</span>
            <span>Last</span>
            <span>Note</span>
            <span>Status</span>
            <span />
          </div>
          {alerts.map((a) => (
            <div className="order-row notif-alert-row" key={a.id}>
              <b>{a.symbol}</b>
              <span>{a.direction} {format.currency(a.price)}</span>
              <span>{a.last_price == null ? "—" : format.currency(a.last_price)}</span>
              <span className="muted">{a.note || "—"}</span>
              <span className={a.active ? "positive" : "muted"}>{a.active ? "armed" : a.triggered_at ? "fired" : "off"}</span>
              <span className="notif-alert-actions">
                {a.active && (
                  <button
                    type="button"
                    onClick={async () => {
                      await post("toggle_alert", { id: a.id, active: false });
                      await load();
                    }}
                  >
                    Disarm
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    await post("delete_alert", { id: a.id });
                    await load();
                  }}
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
          {!alerts.length && <div className="terminal-empty compact">No price alerts yet.</div>}
        </div>
      </section>

      <section className="terminal-panel">
        <div className="panel-head">
          <span>Notification feed</span>
          <span className="muted">price · setups · morning · reminders</span>
        </div>
        <ul className="notif-feed">
          {notifications.map((n) => (
            <li key={n.id} className={n.read ? "read" : "unread"}>
              <div className="notif-feed-head">
                <b>{n.title}</b>
                <span className="muted">{n.kind} · {format.dateTime(n.created_at)}</span>
              </div>
              <p>{n.body}</p>
              {n.kind === "premarket" && (
                <Link href={localePath(locale, "/premarket")} style={{ marginRight: 10 }}>Open Premarket</Link>
              )}
              {!n.read && (
                <button
                  type="button"
                  onClick={async () => {
                    await post("mark_read", { id: n.id });
                    await load();
                  }}
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
          {!notifications.length && (
            <li className="terminal-empty compact">No notifications yet — add a price alert or run a scan.</li>
          )}
        </ul>
      </section>

      <section className="terminal-panel">
        <div className="panel-head"><span>Cron</span></div>
        <p className="muted" style={{ padding: "0 14px 14px", lineHeight: 1.45 }}>
          Every 15m: <code>ops/com.zkyko.notification-tick.plist.example</code>.
          Weekdays 7:30: <code>ops/com.zkyko.morning-scan.plist.example</code> — Robinhood gainers/losers,
          high options volume, high stock volume → VAL/POC/VAH + VP setups into this feed.
          Keep Next.js + Python (:8765) running; set <code>SYNC_SECRET</code> in the plist to match <code>.env.local</code>.
        </p>
      </section>
    </div>
  );
}
