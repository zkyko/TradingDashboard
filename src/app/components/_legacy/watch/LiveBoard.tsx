"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import LiveCandleChart, { type TimeZoom } from "./LiveCandleChart";
import { useFormat } from "@/app/components/useFormat";
import { stateLabel, stateTone } from "./watchHelpers";
import {
  LIVE_DEFAULT_SYMBOLS,
  type LiveBoardPayload,
  type LiveInterval,
  type LiveSymbolTape,
} from "@/lib/python-service";
import { boardPlayRadar, deriveVpPlays, type VpPlay } from "@/lib/vp-plays";

const INTERVALS: LiveInterval[] = ["10m", "15m", "30m"];
const POLL_MS = 30_000;
const AI_POLL_MS = 180_000;
const STORAGE_KEY = "zk-live-board-v1";

type LiveInsight = {
  symbol: string;
  headline: string;
  marketRead: string;
  offline?: boolean;
  at?: string;
};

type StoredLayout = {
  symbols: string[];
  interval: LiveInterval;
  zooms: Record<string, TimeZoom | null>;
  insights: Record<string, LiveInsight>;
};

function normalizeSymbol(raw: string) {
  const s = raw.trim().toUpperCase();
  if (!s) return "";
  if (s === "ES" || s === "/ES") return "ES=F";
  return s;
}

function displaySymbol(s: string) {
  return s === "ES=F" || s === "ES" ? "ES" : s;
}

function loadStored(): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw) as Partial<StoredLayout>;
    const symbols = Array.isArray(parsed.symbols) && parsed.symbols.length
      ? parsed.symbols.map(normalizeSymbol).filter(Boolean)
      : [...LIVE_DEFAULT_SYMBOLS];
    const interval = INTERVALS.includes(parsed.interval as LiveInterval)
      ? (parsed.interval as LiveInterval)
      : "15m";
    return {
      symbols,
      interval,
      zooms: parsed.zooms && typeof parsed.zooms === "object" ? parsed.zooms : {},
      insights: parsed.insights && typeof parsed.insights === "object" ? parsed.insights : {},
    };
  } catch {
    return {
      symbols: [...LIVE_DEFAULT_SYMBOLS],
      interval: "15m",
      zooms: {},
      insights: {},
    };
  }
}

export default function LiveBoard() {
  const format = useFormat();
  const [hydrated, setHydrated] = useState(false);
  const [symbols, setSymbols] = useState<string[]>([...LIVE_DEFAULT_SYMBOLS]);
  const [interval, setIntervalTf] = useState<LiveInterval>("15m");
  const [zooms, setZooms] = useState<Record<string, TimeZoom | null>>({});
  const [insights, setInsights] = useState<Record<string, LiveInsight>>({});
  const [board, setBoard] = useState<LiveBoardPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(0);
  const [addQuery, setAddQuery] = useState("");
  const [addHint, setAddHint] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [radarOpen, setRadarOpen] = useState(false);
  const insightBusy = useRef(false);

  useEffect(() => {
    const stored = loadStored();
    setSymbols(stored.symbols);
    setIntervalTf(stored.interval);
    setZooms(stored.zooms);
    setInsights(stored.insights);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload: StoredLayout = { symbols, interval, zooms, insights };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [hydrated, symbols, interval, zooms, insights]);

  const load = useCallback(async (tf: LiveInterval, syms: string[], silent = false) => {
    if (!syms.length) {
      setBoard(null);
      return;
    }
    if (!silent) setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/watchlist/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interval: tf, symbols: syms, includeMl: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || body.hint || "Live board failed.");
      setBoard(body as LiveBoardPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live board failed.");
    } finally {
      if (!silent) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void load(interval, symbols, tick > 0);
  }, [hydrated, interval, symbols, load, tick]);

  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => window.clearInterval(id);
  }, [auto]);

  const orderedTapes = useMemo(() => {
    const byKey = new Map<string, LiveSymbolTape>();
    for (const tape of board?.symbols ?? []) {
      byKey.set(tape.yf || tape.symbol, tape);
      byKey.set(tape.symbol, tape);
    }
    return symbols.map((sym) => {
      const tape = byKey.get(sym) || byKey.get(displaySymbol(sym));
      return (
        tape || {
          symbol: displaySymbol(sym),
          yf: sym,
          bars: [],
          last: null,
          changePct: null,
          analysis: null,
          error: board ? "Waiting for bars…" : null,
        }
      );
    });
  }, [board, symbols]);

  const openTape = useMemo(() => {
    if (!openKey) return null;
    return orderedTapes.find((t) => normalizeSymbol(t.yf || t.symbol) === openKey) || null;
  }, [openKey, orderedTapes]);

  const refreshInsights = useCallback(async (tapes: LiveSymbolTape[], tf: LiveInterval) => {
    if (insightBusy.current || !tapes.length) return;
    insightBusy.current = true;
    try {
      const response = await fetch("/api/watchlist/live/insight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tapes: tapes
            .filter((t) => !t.error && t.last)
            .slice(0, 12)
            .map((t) => {
              const plays = deriveVpPlays(t).slice(0, 3).map((p) => ({
                name: p.name,
                status: p.status,
                tagline: p.tagline,
                heat: p.heat,
              }));
              return {
                symbol: t.symbol,
                changePct: t.changePct,
                price: t.last?.close ?? null,
                last: t.analysis?.last || null,
                states: t.analysis?.states || null,
                ml: t.analysis?.ml
                  ? {
                      predictedClose: t.analysis.ml.predictedClose,
                      predictedChangePct: t.analysis.ml.predictedChangePct,
                      testScore: t.analysis.ml.testScore,
                    }
                  : null,
                interval: tf,
                profiles: t.profiles
                  ? Object.fromEntries(
                      Object.entries(t.profiles).map(([k, v]) => [
                        k,
                        v
                          ? { position: v.position, val: v.val, poc: v.poc, vah: v.vah, alert: v.alert }
                          : null,
                      ]),
                    )
                  : null,
                plays,
              };
            }),
        }),
      });
      const body = await response.json();
      if (!response.ok) return;
      const next: Record<string, LiveInsight> = {};
      for (const row of body.insights || []) {
        next[String(row.symbol).toUpperCase()] = {
          symbol: String(row.symbol).toUpperCase(),
          headline: String(row.headline || ""),
          marketRead: String(row.marketRead || ""),
          offline: Boolean(row.offline),
          at: row.at,
        };
      }
      setInsights((prev) => ({ ...prev, ...next }));
    } catch {
      /* keep prior blurbs */
    } finally {
      insightBusy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!board?.symbols?.length) return;
    void refreshInsights(board.symbols, interval);
    const id = window.setInterval(() => {
      if (board?.symbols?.length) void refreshInsights(board.symbols, interval);
    }, AI_POLL_MS);
    return () => window.clearInterval(id);
  }, [board?.updatedAt, interval, refreshInsights]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!openKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenKey(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openKey]);

  function addSymbol(event?: FormEvent) {
    event?.preventDefault();
    const next = normalizeSymbol(addQuery);
    if (!next) {
      setAddHint("Type a ticker first.");
      return;
    }
    const exists = symbols.some(
      (s) => normalizeSymbol(s) === next || displaySymbol(s) === displaySymbol(next),
    );
    if (exists) {
      setAddHint(`${displaySymbol(next)} is already on the board.`);
      return;
    }
    setSymbols((prev) => [...prev, next]);
    setAddQuery("");
    setAddHint(`Added ${displaySymbol(next)}.`);
  }

  function removeSymbol(sym: string) {
    const key = normalizeSymbol(sym);
    setSymbols((prev) => prev.filter((s) => s !== key && displaySymbol(s) !== displaySymbol(key)));
    setAddHint(`Removed ${displaySymbol(key)}.`);
    if (openKey === key) setOpenKey(null);
    setZooms((prev) => {
      const copy = { ...prev };
      delete copy[key];
      delete copy[displaySymbol(key)];
      return copy;
    });
  }

  function reorder(fromSym: string, toSym: string) {
    if (fromSym === toSym) return;
    setSymbols((prev) => {
      const next = [...prev];
      const from = next.indexOf(fromSym);
      const to = next.indexOf(toSym);
      if (from < 0 || to < 0) return prev;
      next.splice(from, 1);
      next.splice(to, 0, fromSym);
      return next;
    });
  }

  function setZoom(sym: string, zoom: TimeZoom | null) {
    const key = normalizeSymbol(sym);
    setZooms((prev) => ({ ...prev, [key]: zoom }));
  }

  const radar = boardPlayRadar(orderedTapes);

  return (
    <div className="live-board">
      <div className="live-toolbar">
        <div className="tf-row watch-controls">
          {INTERVALS.map((tf) => (
            <button
              key={tf}
              type="button"
              className={interval === tf ? "active" : ""}
              disabled={busy}
              onClick={() => setIntervalTf(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
        <form className="live-add" onSubmit={(e) => addSymbol(e)}>
          <input
            value={addQuery}
            onChange={(e) => {
              setAddQuery(e.target.value.toUpperCase());
              if (addHint) setAddHint("");
            }}
            placeholder="NVDA"
            autoComplete="off"
            spellCheck={false}
            aria-label="Add ticker to live board"
          />
          <button type="submit" className="primary">Add chart</button>
        </form>
        {addHint && <span className="muted live-add-hint">{addHint}</span>}
        <div className="live-toolbar-end">
          <label className="live-auto">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Auto {POLL_MS / 1000}s
          </label>
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => void load(interval, symbols)}>
            {busy ? "Updating…" : "Refresh"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => board && void refreshInsights(board.symbols, interval)}
          >
            Refresh AI
          </button>
          {board?.updatedAt && (
            <span className="muted live-stamp">
              {format.dateTime(board.updatedAt)} · {board.source}
            </span>
          )}
        </div>
      </div>

      <p className="muted watch-disclaimer">
        Charts first — click a ticker to open its VP desk. Descriptive only · drag ⋮⋮ to reorder · zoom locks on pan.
      </p>

      {error && <div className="error-box">{error}</div>}

      {!!radar.length && (
        <div className="live-radar-bar">
          <button type="button" className="live-radar-toggle" onClick={() => setRadarOpen((v) => !v)}>
            <b>Plays radar</b>
            <span className="muted">{radar.length} hot · {radarOpen ? "hide" : "show"}</span>
          </button>
          {radarOpen && (
            <div className="live-radar-list">
              {radar.map((row) => (
                <button
                  type="button"
                  key={`${row.symbol}-${row.id}`}
                  className={`live-radar-item status-${row.status} bias-${row.bias}`}
                  onClick={() => {
                    const match = orderedTapes.find((t) => t.symbol === row.symbol);
                    if (match) setOpenKey(normalizeSymbol(match.yf || match.symbol));
                  }}
                >
                  <div className="live-radar-top">
                    <b>{row.symbol}</b>
                    <span>{row.name}</span>
                    <em>{row.heat}</em>
                  </div>
                  <p>{row.tagline}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="live-grid">
        {orderedTapes.map((tape) => {
          const key = normalizeSymbol(tape.yf || tape.symbol);
          const zoom = zooms[key] || zooms[tape.symbol] || null;
          return (
            <LiveTile
              key={key}
              tape={tape}
              money={format.currency}
              zoom={zoom}
              dragging={dragId === key}
              onDragStart={() => setDragId(key)}
              onDragEnd={() => setDragId(null)}
              onDropOn={() => {
                if (dragId) reorder(dragId, key);
                setDragId(null);
              }}
              onZoomLock={(z) => setZoom(key, z)}
              onUnlock={() => setZoom(key, null)}
              onRemove={() => removeSymbol(key)}
              onOpen={() => setOpenKey(key)}
            />
          );
        })}
        {!orderedTapes.length && !busy && !error && (
          <div className="wl-empty desk">Add a ticker to start the board.</div>
        )}
      </div>

      {openTape && openKey && (
        <LiveDesk
          tape={openTape}
          money={format.currency}
          insight={insights[openTape.symbol] || insights[displaySymbol(openKey)] || insights[openKey]}
          zoom={zooms[openKey] || zooms[openTape.symbol] || null}
          onZoomLock={(z) => setZoom(openKey, z)}
          onUnlock={() => setZoom(openKey, null)}
          onClose={() => setOpenKey(null)}
          onRemove={() => removeSymbol(openKey)}
        />
      )}
    </div>
  );
}

function LiveTile({
  tape,
  money,
  zoom,
  dragging,
  onDragStart,
  onDragEnd,
  onDropOn,
  onZoomLock,
  onUnlock,
  onRemove,
  onOpen,
}: {
  tape: LiveSymbolTape;
  money: (n: number | null | undefined) => string;
  zoom: TimeZoom | null;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
  onZoomLock: (zoom: TimeZoom | null) => void;
  onUnlock: () => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const last = tape.last?.close ?? null;
  const ch = tape.changePct;
  const up = (ch ?? 0) >= 0;
  const label = tape.symbol === "ES" ? "ES" : tape.symbol;
  const analysis = tape.analysis;
  const profiles = tape.profiles || {};
  const dailyVp = profiles.daily || profiles["1d"];
  const locked = Boolean(zoom);
  const hotAlert = tape.vpAlerts?.[0];
  const topPlay = deriveVpPlays(tape)[0];
  const cue = hotAlert
    ? `${vpPositionLabel(hotAlert.position)} · ${hotAlert.tf}`
    : topPlay
      ? topPlay.name
      : null;

  return (
    <article
      className={`live-tile compact${dragging ? " dragging" : ""}${locked ? " zoom-locked" : ""}${hotAlert ? " vp-alert" : ""}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
    >
      <header className="live-tile-head">
        <div className="live-tile-title">
          <span
            className="live-drag"
            title="Drag to reorder"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              onDragStart();
            }}
            onDragEnd={onDragEnd}
          >
            ⋮⋮
          </span>
          <button type="button" className="live-symbol-btn" onClick={onOpen} title="Open desk">
            {label}
          </button>
          {locked && (
            <button type="button" className="live-lock-btn" onClick={onUnlock}>
              Locked
            </button>
          )}
        </div>
        <div className="live-tile-px">
          <strong>{last == null ? "—" : money(last)}</strong>
          <span className={up ? "positive" : "negative"}>
            {ch == null ? "—" : `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%`}
          </span>
          <button type="button" className="live-remove" onClick={onRemove} title="Remove">×</button>
        </div>
      </header>

      {cue && (
        <button type="button" className="live-cue" onClick={onOpen}>
          {cue}
          <span>Open →</span>
        </button>
      )}

      {tape.error && <p className="error-inline">{tape.error}</p>}
      {!tape.error && tape.bars.length > 0 && (
        <LiveCandleChart
          bars={tape.bars}
          sma20={analysis?.sma20Series}
          vpLevels={dailyVp}
          lockedZoom={zoom}
          onZoomLock={onZoomLock}
        />
      )}
      {!tape.error && !tape.bars.length && <div className="spark-empty">No bars</div>}

      <button type="button" className="live-open-btn" onClick={onOpen}>
        Open {label} desk
      </button>
    </article>
  );
}

function LiveDesk({
  tape,
  money,
  insight,
  zoom,
  onZoomLock,
  onUnlock,
  onClose,
  onRemove,
}: {
  tape: LiveSymbolTape;
  money: (n: number | null | undefined) => string;
  insight?: LiveInsight;
  zoom: TimeZoom | null;
  onZoomLock: (zoom: TimeZoom | null) => void;
  onUnlock: () => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  const last = tape.last?.close ?? null;
  const ch = tape.changePct;
  const up = (ch ?? 0) >= 0;
  const label = tape.symbol === "ES" ? "ES futures" : tape.symbol;
  const analysis = tape.analysis;
  const rsi = analysis?.last?.rsi ?? null;
  const volRatio = analysis?.last?.volRatio ?? null;
  const states = analysis?.states || {};
  const profiles = tape.profiles || {};
  const dailyVp = profiles.daily || profiles["1d"];
  const plays = deriveVpPlays(tape);
  const vpRows: Array<{ key: string; label: string }> = [
    { key: "daily", label: "Daily" },
    { key: "weekly", label: "Weekly" },
    { key: "1d", label: "1D" },
    { key: "10m", label: "10m" },
    { key: "15m", label: "15m" },
    { key: "30m", label: "30m" },
  ];
  const hotAlert = tape.vpAlerts?.[0];

  return (
    <div className="live-desk-root" role="dialog" aria-modal="true" aria-label={`${label} desk`}>
      <button type="button" className="live-desk-backdrop" aria-label="Close" onClick={onClose} />
      <div className="live-desk">
        <header className="live-desk-head">
          <div>
            <h2>{label}</h2>
            <p className={up ? "positive" : "negative"}>
              {last == null ? "—" : money(last)}
              {ch == null ? "" : ` · ${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%`}
            </p>
          </div>
          <div className="live-desk-actions">
            {zoom && (
              <button type="button" className="ghost-btn" onClick={onUnlock}>Unlock zoom</button>
            )}
            <button type="button" className="ghost-btn" onClick={onRemove}>Remove</button>
            <button type="button" className="primary" onClick={onClose}>Close</button>
          </div>
        </header>

        {hotAlert && (
          <div className="live-vp-banner">
            Price {vpPositionLabel(hotAlert.position)} · {hotAlert.tf.toUpperCase()} VP
          </div>
        )}

        {!tape.error && tape.bars.length > 0 && (
          <div className="live-desk-chart">
            <LiveCandleChart
              bars={tape.bars}
              sma20={analysis?.sma20Series}
              vpLevels={dailyVp}
              height={320}
              lockedZoom={zoom}
              onZoomLock={onZoomLock}
            />
          </div>
        )}

        <div className="live-metrics">
          <span className={`tone-${stateTone(states.rsi)}`}>
            RSI {rsi == null ? "—" : rsi.toFixed(1)}
            {states.rsi ? ` · ${stateLabel("rsi", states.rsi)}` : ""}
          </span>
          <span className={`tone-${stateTone(states.volume)}`}>
            Vol {volRatio == null ? "—" : `${volRatio.toFixed(2)}×`}
          </span>
          <span className={`tone-${stateTone(states.vsSma20)}`}>
            {stateLabel("vsSma20", states.vsSma20)}
          </span>
          {analysis?.ml && (
            <span className="muted">
              ML {money(analysis.ml.predictedClose)}
              {analysis.ml.predictedChangePct != null
                ? ` (${analysis.ml.predictedChangePct >= 0 ? "+" : ""}${analysis.ml.predictedChangePct.toFixed(1)}%)`
                : ""}
            </span>
          )}
        </div>

        <section className="live-desk-section">
          <h3>Volume profile</h3>
          <div className="live-vp-grid">
            {vpRows.map(({ key, label: tfLabel }) => {
              const snap = profiles[key];
              if (!snap) return null;
              return (
                <div key={key} className={`live-vp-row${snap.alert ? " alert" : ""}`}>
                  <span className="live-vp-tf">{tfLabel}</span>
                  <span>VAL {fmtPx(snap.val, money)}</span>
                  <span>POC {fmtPx(snap.poc, money)}</span>
                  <span>VAH {fmtPx(snap.vah, money)}</span>
                  <span className={`live-vp-pos pos-${snap.position || "unknown"}`}>
                    {vpPositionLabel(snap.position)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="live-desk-section">
          <h3>VP plays</h3>
          <div className="live-plays">
            {plays.map((play) => (
              <PlayCard key={play.id} play={play} />
            ))}
          </div>
        </section>

        {insight && (
          <section className="live-desk-section">
            <h3>AI read</h3>
            <div className="live-ai">
              <b>{insight.headline}</b>
              <p>{insight.marketRead}</p>
              {insight.offline && <small className="muted">AI offline</small>}
            </div>
          </section>
        )}

        <p className="muted watch-disclaimer">Descriptive auction map — not trade advice.</p>
      </div>
    </div>
  );
}

function PlayCard({ play }: { play: VpPlay }) {
  return (
    <article className={`live-play status-${play.status} bias-${play.bias}`}>
      <div className="live-play-top">
        <b>{play.name}</b>
        <span className="live-play-heat">{play.heat}</span>
        <span className="live-play-status">{play.status}</span>
      </div>
      <p className="live-play-tag">{play.tagline}</p>
      <p>{play.thesis}</p>
      <ul>
        <li><span>Watch</span> {play.watch}</li>
        <li><span>Invalidates</span> {play.invalidation}</li>
      </ul>
      <div className="live-play-tfs">
        {play.tfs.map((tf) => <i key={tf}>{tf}</i>)}
        <i className="bias">{play.bias.replace(/_/g, " ")}</i>
      </div>
    </article>
  );
}

function fmtPx(n: number | null | undefined, money: (v: number | null | undefined) => string) {
  return n == null || !Number.isFinite(n) ? "—" : money(n);
}

function vpPositionLabel(pos: string | undefined) {
  switch (pos) {
    case "at_val": return "AT VAL";
    case "at_vah": return "AT VAH";
    case "at_poc": return "AT POC";
    case "below_val": return "Below VAL";
    case "above_vah": return "Above VAH";
    case "inside_va": return "Inside VA";
    default: return "—";
  }
}
