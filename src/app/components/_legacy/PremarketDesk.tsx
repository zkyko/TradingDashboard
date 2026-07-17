"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFormat } from "@/app/components/useFormat";
import type { PremarketSymbolBrief } from "@/lib/insights";
import type { PremarketPayload, PremarketQuote } from "@/lib/premarket";

function heatColor(changePct: number | undefined | null) {
  if (changePct == null || !Number.isFinite(changePct)) return "rgba(100,116,139,0.35)";
  const mag = Math.min(1, Math.abs(changePct) / 3);
  if (changePct >= 0) {
    const g = Math.round(80 + mag * 100);
    return `rgba(34, ${g}, 94, ${0.35 + mag * 0.55})`;
  }
  const r = Math.round(180 + mag * 60);
  return `rgba(${r}, 68, 68, ${0.35 + mag * 0.55})`;
}

function cellText(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return String(value);
}

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (!values.length) return null;
  const w = 120;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="pm-spark" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "#22c55e" : "#ef4444"} strokeWidth="2" />
    </svg>
  );
}

export default function PremarketDesk() {
  const format = useFormat();
  const [data, setData] = useState<PremarketPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PremarketQuote | null>(null);
  const [groupFilter, setGroupFilter] = useState<"all" | "sector" | "theme" | "levered">("all");
  const [calTab, setCalTab] = useState<"economics" | "earnings" | "ipos" | "splits">("economics");
  const [brief, setBrief] = useState<PremarketSymbolBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/premarket?days=7");
      const body = await response.json();
      if (!response.ok || body.ok === false) throw new Error(body.error || "Premarket failed.");
      setData(body as PremarketPayload);
      setSelected((prev) => {
        if (!prev) return (body as PremarketPayload).heatmap?.[0] || null;
        return (body as PremarketPayload).heatmap?.find((h) => h.symbol === prev.symbol) || prev;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Premarket failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected || !data) {
      setBrief(null);
      return;
    }
    let cancelled = false;
    setBriefBusy(true);
    setBriefError("");
    void (async () => {
      try {
        const response = await fetch("/api/premarket/insight", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            symbol: selected.symbol,
            name: selected.name,
            group: selected.group,
            changePct: selected.changePct,
            weekChangePct: selected.weekChangePct,
            price: selected.price,
            board: {
              leaders: data.leaders,
              laggards: data.laggards,
              heatmap: data.heatmap,
              indices: data.indices,
              earnings: data.earnings?.slice(0, 20),
            },
          }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Insight failed.");
        if (!cancelled) setBrief(body as PremarketSymbolBrief);
      } catch (err) {
        if (!cancelled) {
          setBrief(null);
          setBriefError(err instanceof Error ? err.message : "Insight failed.");
        }
      } finally {
        if (!cancelled) setBriefBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.symbol, data?.updatedAt]);

  const cells = useMemo(() => {
    const rows = data?.heatmap || [];
    if (groupFilter === "all") return rows;
    return rows.filter((r) => r.group === groupFilter);
  }, [data, groupFilter]);

  const maxAbs = Math.max(...cells.map((c) => Math.abs(c.changePct || 0)), 0.5);

  function pct(n: number | undefined | null) {
    if (n == null || !Number.isFinite(n)) return "—";
    return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
  }

  return (
    <div className="pm">
      <div className="acct-toolbar">
        <span className="muted">
          {data?.clock || "Premarket board"}
          {data?.updatedAt ? ` · synced ${format.dateTime(data.updatedAt)}` : ""}
        </span>
        <button type="button" disabled={busy} onClick={() => void load()}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {data?.calendarError && (
        <p className="muted" style={{ marginBottom: 12 }}>Calendar partial: {data.calendarError}</p>
      )}
      {data?.note && <p className="muted pm-note">{data.note}</p>}

      <div className="pm-indices">
        {(data?.indices || []).map((idx) => {
          const up = (idx.changePct || 0) >= 0;
          return (
            <button
              key={idx.symbol}
              type="button"
              className={`pm-index ${up ? "up" : "down"}`}
              onClick={() => setSelected(idx)}
            >
              <span>{idx.display || idx.symbol}</span>
              <b>{idx.price != null ? format.currency(idx.price) : "—"}</b>
              <small className={up ? "positive" : "negative"}>{pct(idx.changePct)}</small>
            </button>
          );
        })}
      </div>

      <div className="pm-split">
        <section className="terminal-panel pm-heat-panel">
          <div className="panel-head">
            <span>Sector / theme heatmap</span>
            <div className="pm-filters">
              {(["all", "sector", "theme", "levered"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={groupFilter === g ? "active" : ""}
                  onClick={() => setGroupFilter(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div className="pm-heat" role="list">
            {cells.map((cell) => {
              const up = (cell.changePct || 0) >= 0;
              const weight = 0.55 + (Math.abs(cell.changePct || 0) / maxAbs) * 0.9;
              const active = selected?.symbol === cell.symbol;
              return (
                <button
                  key={cell.symbol}
                  type="button"
                  role="listitem"
                  className={`pm-cell ${up ? "up" : "down"}${active ? " active" : ""}`}
                  style={{
                    background: heatColor(cell.changePct),
                    flexGrow: weight,
                    flexBasis: `${Math.max(110, weight * 90)}px`,
                  }}
                  onClick={() => setSelected(cell)}
                  title={`${cell.name}: ${pct(cell.changePct)}`}
                >
                  <span className="pm-cell-sym">{cell.display || cell.symbol}</span>
                  <span className="pm-cell-name">{cell.name}</span>
                  <b className={up ? "positive" : "negative"}>{pct(cell.changePct)}</b>
                  <small>{cell.price != null ? format.currency(cell.price) : cell.error || "—"}</small>
                </button>
              );
            })}
            {!cells.length && !busy && <div className="terminal-empty compact">No heatmap data.</div>}
          </div>
          <div className="pm-lead-lag">
            <div>
              <h4>Leading</h4>
              <ul>
                {(data?.leaders || []).slice(0, 5).map((r) => (
                  <li key={`l-${r.symbol}`}>
                    <button type="button" onClick={() => setSelected(r)}>
                      <b>{r.display || r.symbol}</b>
                      <span className="positive">{pct(r.changePct)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Selling off</h4>
              <ul>
                {(data?.laggards || []).slice(0, 5).map((r) => (
                  <li key={`g-${r.symbol}`}>
                    <button type="button" onClick={() => setSelected(r)}>
                      <b>{r.display || r.symbol}</b>
                      <span className="negative">{pct(r.changePct)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="terminal-panel pm-detail">
          <div className="panel-head">
            <span>{selected ? `${selected.display || selected.symbol} · ${selected.name}` : "Select a cell"}</span>
            <span className="muted">{selected?.group}</span>
          </div>
          {selected ? (
            <div className="pm-detail-body">
              <div className="pm-detail-kpis">
                <div>
                  <span>Yahoo</span>
                  <b>{selected.price != null ? format.currency(selected.price) : "—"}</b>
                </div>
                <div>
                  <span>Day</span>
                  <b className={(selected.changePct || 0) >= 0 ? "positive" : "negative"}>
                    {pct(selected.changePct)}
                  </b>
                </div>
                <div>
                  <span>~5–10d</span>
                  <b className={(selected.weekChangePct || 0) >= 0 ? "positive" : "negative"}>
                    {pct(selected.weekChangePct)}
                  </b>
                </div>
                <div>
                  <span>RH last</span>
                  <b>
                    {brief?.rh?.price != null
                      ? format.currency(brief.rh.price)
                      : briefBusy
                        ? "…"
                        : "—"}
                  </b>
                </div>
                <div>
                  <span>RH bid/ask</span>
                  <b>
                    {brief?.rh?.bid != null && brief?.rh?.ask != null
                      ? `${format.currency(brief.rh.bid)} / ${format.currency(brief.rh.ask)}`
                      : brief?.rh?.error
                        ? brief.rh.error.slice(0, 28)
                        : "—"}
                  </b>
                </div>
              </div>
              {!!selected.spark?.length && (
                <div className="pm-spark-wrap">
                  <Spark values={selected.spark} up={(selected.changePct || 0) >= 0} />
                  <span className="muted">recent closes</span>
                </div>
              )}

              {briefError && <div className="error-box">{briefError}</div>}
              {briefBusy && !brief && <div className="terminal-empty compact">Pulling RH + VP math · AI desk brief…</div>}

              {brief && (
                <div className="pm-ai">
                  <h3>{brief.headline}</h3>
                  <p className="pm-trend"><span>Mode</span> {brief.trendMode}</p>
                  <p className="pm-structure">{brief.structureRead}</p>

                  <div className="pm-levels">
                    {(["daily", "weekly", "intraday"] as const).map((tf) => {
                      const lvl = brief.levels[tf];
                      if (!lvl) return null;
                      return (
                        <div key={tf} className="pm-level-card">
                          <span>{tf}</span>
                          <b>VAL {lvl.val != null ? format.currency(lvl.val) : "—"}</b>
                          <b>POC {lvl.poc != null ? format.currency(lvl.poc) : "—"}</b>
                          <b>VAH {lvl.vah != null ? format.currency(lvl.vah) : "—"}</b>
                          <small className="muted">{lvl.position || ""}</small>
                        </div>
                      );
                    })}
                  </div>

                  <div className="acct-brief-cols">
                    <div>
                      <h4>Look out for</h4>
                      <ul>{brief.lookOutFor.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                    <div>
                      <h4>Process next</h4>
                      <ul>{brief.processNext.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  </div>

                  {!!brief.namesToWatch.length && (
                    <div className="pm-watch-names">
                      <h4>Names to watch (on your board)</h4>
                      <ul>
                        {brief.namesToWatch.map((n) => (
                          <li key={`${n.symbol}-${n.why}`}>
                            <b>{n.symbol}</b>
                            <span>{n.why}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {brief.creativeNote && <p className="pm-creative">{brief.creativeNote}</p>}
                  <p className="muted acct-brief-meta">
                    {brief.offline ? "Offline local brief" : "AI desk brief"}
                    {" · "}Yahoo + Robinhood + VP
                    {" · "}{format.dateTime(brief.updatedAt)}
                    {" · "}saved for the day — refresh tile to regenerate
                    {" · "}process / watch only — not trade advice
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="terminal-empty compact">Click a heatmap tile.</div>
          )}
        </section>
      </div>

      <section className="terminal-panel">
        <div className="panel-head">
          <span>Calendar · day / week</span>
          <div className="pm-filters">
            {(["economics", "earnings", "ipos", "splits"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={calTab === t ? "active" : ""}
                onClick={() => setCalTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {calTab === "economics" && (
          <div className="orders-table pm-cal">
            <div className="order-row header pm-eco-row">
              <span>Event</span><span>Region</span><span>Time</span><span>Expected</span><span>Prior</span><span>Actual</span>
            </div>
            {(data?.economics || []).slice(0, 40).map((row, i) => (
              <div className="order-row pm-eco-row" key={`eco-${i}`}>
                <b>{cellText(row.Event)}</b>
                <span>{cellText(row.Region)}</span>
                <span>{row["Event Time"] ? format.dateTime(String(row["Event Time"])) : "—"}</span>
                <span>{cellText(row.Expected)}</span>
                <span>{cellText(row.Last)}</span>
                <span>{cellText(row.Actual)}</span>
              </div>
            ))}
            {!data?.economics?.length && <div className="terminal-empty compact">No economic events in window.</div>}
          </div>
        )}

        {calTab === "earnings" && (
          <div className="orders-table pm-cal">
            <div className="order-row header pm-earn-row">
              <span>Symbol</span><span>Company</span><span>When</span><span>Timing</span><span>Est. EPS</span><span>Reported</span>
            </div>
            {(data?.earnings || []).slice(0, 50).map((row, i) => (
              <div className="order-row pm-earn-row" key={`earn-${i}`}>
                <b>{cellText(row.Symbol)}</b>
                <span>{cellText(row.Company)}</span>
                <span>{row["Event Start Date"] ? format.dateTime(String(row["Event Start Date"])) : "—"}</span>
                <span>{cellText(row.Timing)}</span>
                <span>{cellText(row["EPS Estimate"])}</span>
                <span>{cellText(row["Reported EPS"])}</span>
              </div>
            ))}
            {!data?.earnings?.length && <div className="terminal-empty compact">No earnings in window.</div>}
          </div>
        )}

        {calTab === "ipos" && (
          <div className="orders-table pm-cal">
            {(data?.ipos || []).slice(0, 30).map((row, i) => (
              <div className="order-row" key={`ipo-${i}`} style={{ gridTemplateColumns: "1fr 2fr 1fr" }}>
                <b>{String(row.Symbol || "—")}</b>
                <span>{JSON.stringify(row).slice(0, 120)}</span>
                <span className="muted">IPO</span>
              </div>
            ))}
            {!data?.ipos?.length && <div className="terminal-empty compact">No IPOs in window.</div>}
          </div>
        )}

        {calTab === "splits" && (
          <div className="orders-table pm-cal">
            {(data?.splits || []).slice(0, 30).map((row, i) => (
              <div className="order-row" key={`spl-${i}`} style={{ gridTemplateColumns: "1fr 2fr 1fr" }}>
                <b>{String(row.Symbol || "—")}</b>
                <span>{JSON.stringify(row).slice(0, 120)}</span>
                <span className="muted">Split</span>
              </div>
            ))}
            {!data?.splits?.length && <div className="terminal-empty compact">No splits in window.</div>}
          </div>
        )}
      </section>
    </div>
  );
}
