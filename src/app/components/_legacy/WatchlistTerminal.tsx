"use client";

import { FormEvent, ClipboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { RangeMeter, InsightCards, TechChart } from "./Sparkline";
import TaWorkbench, { RiskStrip } from "./TaWorkbench";
import VolumeProfileChart from "./watch/VolumeProfileChart";
import TickerJournal from "./watch/TickerJournal";
import { stateLabel, stateTone, type Interval, type VpMode } from "./watch/watchHelpers";
import { useFormat } from "@/app/components/useFormat";
import type { AnalyzePayload } from "@/lib/python-service";
import type { WatchActivity } from "@/lib/watchlist-activity";

type OptionsChain = {
  symbol: string;
  expiries: string[];
  chains: Array<{
    expiry: string;
    calls: Array<Record<string, unknown>>;
    puts: Array<Record<string, unknown>>;
  }>;
  note?: string;
};

function fundNum(fundamentals: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!fundamentals) return null;
  for (const key of keys) {
    const raw = fundamentals[key];
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return null;
}

type Shot = { id: string; originalName: string; caption: string; url: string; createdAt?: string };
type Item = {
  id: number | string;
  symbol: string;
  thesis: string;
  setup: string;
  timeframe: string;
  trigger_price: number | null;
  invalidation: number | null;
  target: number | null;
  status: string;
  last_price: number | null;
  previous_close: number | null;
  created_at?: string | null;
  counsel_json?: string | null;
  attachments?: Shot[];
  [key: string]: string | number | null | Shot[] | undefined;
};

type MarketBar = { time: string; open: number; high: number; low: number; close: number; volume: number };
type Insight = {
  offline?: boolean;
  headline?: string;
  marketRead?: string;
  processAngles?: string[];
  questions?: string[];
  whatChanged?: string[];
};
type Lookup = {
  symbol: string;
  draftId?: string | null;
  onWatchlist?: boolean;
  watchlistId?: number | null;
  quote: {
    symbol: string;
    price: number;
    previousClose: number;
    bid: number;
    ask: number;
    volume?: number | null;
    instrumentName?: string | null;
    state: string;
  };
  changePct: number | null;
  market: {
    historicals: MarketBar[];
    fundamentals: Record<string, unknown> | null;
    technicals: { rsi: number | null; sma20: number | null; sma50: number | null };
    trend: { rangePosition: number | null; windowReturnPct?: number | null };
  } | null;
  insight: Insight | null;
  analysis?: AnalyzePayload | null;
};

type Counsel = { offline?: boolean; reflection?: string; readiness?: string };
type DeskTab = "note" | "market";

function parseCounsel(raw: unknown): Counsel | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as Counsel;
  try { return JSON.parse(String(raw)) as Counsel; } catch { return null; }
}

export default function WatchlistTerminal({
  initialItems,
  initialTicker = "",
}: {
  initialItems: Item[];
  initialTicker?: string;
}) {
  const format = useFormat();
  const money = format.currency;
  const [items, setItems] = useState(initialItems);
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    if (initialTicker) {
      const match = initialItems.find((i) => String(i.symbol).toUpperCase() === initialTicker);
      if (match) return Number(match.id);
    }
    return initialItems[0] ? Number(initialItems[0].id) : null;
  });
  const [tickerQuery, setTickerQuery] = useState(initialTicker);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzePayload | null>(null);
  const [timeline, setTimeline] = useState<WatchActivity[]>([]);
  const [tab, setTab] = useState<DeskTab>("note");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [counselBusy, setCounselBusy] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [caption, setCaption] = useState("");
  const [question, setQuestion] = useState("");
  const [pasteHint, setPasteHint] = useState("Paste chart (⌘V)");
  const [chartDays, setChartDays] = useState(90);
  const [interval, setInterval] = useState<Interval>("day");
  const [vpMode, setVpMode] = useState<VpMode>("daily");
  const [includeMl, setIncludeMl] = useState(true);
  const [options, setOptions] = useState<OptionsChain | null>(null);
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [insightBusy, setInsightBusy] = useState(false);
  const autoDone = useRef("");
  const lookupRef = useRef<(s: string, days?: number, withInsight?: boolean, ml?: boolean) => Promise<void>>(
    async () => undefined,
  );
  const lookupAbort = useRef<AbortController | null>(null);
  const lookupSeq = useRef(0);

  const selected = useMemo(
    () => items.find((i) => Number(i.id) === selectedId) || null,
    [items, selectedId],
  );
  const counsel = parseCounsel(selected?.counsel_json);
  const pendingDraft = Boolean(lookup?.draftId && !lookup.onWatchlist);
  const page = lookup;
  const quote = page?.quote;
  const market = page?.market || null;
  const insight = page?.insight || null;
  const changePct = page?.changePct ?? null;
  const hist = market?.historicals || [];
  const states = analysis?.states || {};
  const rsi = analysis?.last?.rsi ?? market?.technicals.rsi ?? null;
  const sma20 = analysis?.last?.sma20 ?? market?.technicals.sma20 ?? null;
  const vsSma20 = quote && sma20 ? ((quote.price / sma20) - 1) * 100 : null;
  const volRatio = analysis?.last?.volRatio ?? null;
  const positive = (changePct ?? 0) >= 0;
  const pe = fundNum(market?.fundamentals, ["pe_ratio", "pe", "price_to_earnings"]);
  const high52 = fundNum(market?.fundamentals, ["high_52_weeks", "year_high", "fifty_two_week_high"]);
  const low52 = fundNum(market?.fundamentals, ["low_52_weeks", "year_low", "fifty_two_week_low"]);
  const mktCap = fundNum(market?.fundamentals, ["market_cap", "marketcap"]);

  const insightCards = useMemo(() => {
    const cards: Array<{ tone: "bear" | "bull" | "info"; text: string }> = [];
    if (changePct != null) {
      cards.push({
        tone: changePct < 0 ? "bear" : "bull",
        text: `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}% vs previous close`,
      });
    }
    if (rsi != null) cards.push({ tone: "info", text: `RSI ${rsi.toFixed(1)} · ${stateLabel("rsi", states.rsi)}` });
    if (insight?.processAngles?.length) {
      for (const a of insight.processAngles.slice(0, 2)) cards.push({ tone: "info", text: a });
    }
    return cards;
  }, [changePct, rsi, states.rsi, insight]);

  async function reload() {
    const updated = await fetch("/api/watchlist").then((r) => r.json()) as Item[];
    setItems(updated);
    return updated;
  }

  /** Keep deep-link in the address bar without remounting the page (avoids lookup loops). */
  function syncTickerUrl(symbol: string | null) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (symbol) url.searchParams.set("ticker", symbol);
    else url.searchParams.delete("ticker");
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) {
      window.history.replaceState(window.history.state, "", next);
    }
  }

  async function loadTimeline(symbol: string, itemId?: number | null) {
    const q = itemId
      ? `/api/watchlist/calendar?itemId=${itemId}`
      : `/api/watchlist/calendar?symbol=${encodeURIComponent(symbol)}`;
    try {
      const body = await fetch(q).then((r) => r.json());
      setTimeline(Array.isArray(body.timeline) ? body.timeline : []);
    } catch {
      setTimeline([]);
    }
  }

  async function lookupTicker(symbolRaw: string, days = chartDays, withInsight = false, ml = includeMl) {
    const symbol = symbolRaw.trim().toUpperCase();
    if (!symbol) {
      setError("Enter a ticker.");
      return;
    }

    lookupAbort.current?.abort();
    const ac = new AbortController();
    lookupAbort.current = ac;
    const seq = ++lookupSeq.current;

    setLookupBusy(true);
    setError("");
    setTickerQuery(symbol);
    setShowAddForm(false);
    syncTickerUrl(symbol);
    autoDone.current = symbol;

    try {
      const response = await fetch("/api/watchlist/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, days, insight: withInsight, interval, vpMode, includeMl: ml }),
        signal: ac.signal,
      });
      const body = await response.json();
      if (seq !== lookupSeq.current) return;
      if (!response.ok) throw new Error(body.error || "Lookup failed.");
      setLookup(body as Lookup);
      if (body.analysis) setAnalysis(body.analysis as AnalyzePayload);
      else setAnalysis(null);
      setOptions(null);

      if (body.watchlistId) {
        const updated = await reload();
        if (seq !== lookupSeq.current) return;
        setSelectedId(Number(body.watchlistId));
        setItems(updated);
        setTab("note");
        await loadTimeline(body.symbol, Number(body.watchlistId));
      } else {
        setSelectedId(null);
        setTimeline([]);
        setTab("market");
        setShowAddForm(true);
      }
    } catch (err) {
      if (ac.signal.aborted || seq !== lookupSeq.current) return;
      setError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      if (seq === lookupSeq.current) setLookupBusy(false);
    }
  }

  lookupRef.current = lookupTicker;

  useEffect(() => {
    if (!initialTicker || autoDone.current === initialTicker) return;
    autoDone.current = initialTicker;
    void lookupRef.current(initialTicker);
  }, [initialTicker]);

  async function selectItem(item: Item) {
    const id = Number(item.id);
    const symbol = String(item.symbol).toUpperCase();
    // Same row already open — don't thrash lookup/URL.
    if (selectedId === id && lookup?.symbol === symbol && !lookupBusy) {
      setTab("note");
      return;
    }
    setSelectedId(id);
    setTab("note");
    setTickerQuery(symbol);
    syncTickerUrl(symbol);
    autoDone.current = symbol;
    await loadTimeline(symbol, id);
    await lookupTicker(symbol, chartDays, false);
  }

  async function refreshAll() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/watchlist/refresh", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Refresh failed.");
      await reload();
      if (selected) await lookupTicker(String(selected.symbol), chartDays, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft() {
    if (!lookup?.draftId) {
      setLookup(null);
      setShowAddForm(false);
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/watchlist/drafts/${lookup.draftId}`, { method: "DELETE" });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setError(body.error);
    setLookup(null);
    setAnalysis(null);
    setShowAddForm(false);
    syncTickerUrl(null);
  }

  async function commitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lookup?.draftId) return;
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch(`/api/watchlist/drafts/${lookup.draftId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setError(body.error);
    const updated = await reload();
    const symbol = String(body.symbol || lookup.symbol).toUpperCase();
    setItems(updated);
    setSelectedId(Number(body.id));
    setLookup((c) => (c ? { ...c, draftId: null, onWatchlist: true, watchlistId: Number(body.id) } : c));
    setShowAddForm(false);
    setTab("note");
    autoDone.current = symbol;
    syncTickerUrl(symbol);
    await loadTimeline(symbol, Number(body.id));
  }

  async function status(id: number, next: string) {
    await fetch(`/api/watchlist/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setItems((prev) => prev.map((i) => (Number(i.id) === id ? { ...i, status: next } : i)));
  }

  async function remove(id: number) {
    await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
    const next = items.filter((i) => Number(i.id) !== id);
    setItems(next);
    if (selectedId === id) {
      setSelectedId(next[0] ? Number(next[0].id) : null);
      setLookup(null);
      setAnalysis(null);
      setTimeline([]);
      if (next[0]) void selectItem(next[0]);
      else syncTickerUrl(null);
    }
  }

  async function uploadFile(file: File, note?: string) {
    if (!selected) return;
    setUploadBusy(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    form.set("watchlistItemId", String(selected.id));
    form.set("caption", note || caption || `Chart · ${selected.symbol}`);
    const response = await fetch("/api/attachments", { method: "POST", body: form });
    const body = await response.json();
    setUploadBusy(false);
    if (!response.ok) return setError(body.error);
    setCaption("");
    setPasteHint("Attached.");
    await reload();
    await loadTimeline(String(selected.symbol), Number(selected.id));
  }

  async function onPasteShot(event: ClipboardEvent<HTMLDivElement>) {
    if (!selected) return;
    const image = Array.from(event.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (!image) {
      setPasteHint("No image on clipboard.");
      return;
    }
    event.preventDefault();
    const file = image.getAsFile();
    if (!file) return;
    await uploadFile(new File([file], `${selected.symbol}-${Date.now()}.png`, { type: file.type || "image/png" }));
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File)) return;
    await uploadFile(file, String(data.get("caption") || ""));
    event.currentTarget.reset();
  }

  async function removeShot(id: string) {
    if (!selected) return;
    const response = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    if (response.ok) {
      await reload();
      await loadTimeline(String(selected.symbol), Number(selected.id));
    }
  }

  async function runCounsel(event?: FormEvent) {
    event?.preventDefault();
    if (!selected) return;
    setCounselBusy(true);
    setError("");
    const response = await fetch(`/api/watchlist/${selected.id}/counsel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const body = await response.json();
    setCounselBusy(false);
    if (!response.ok) return setError(body.error);
    setItems(items.map((i) => (Number(i.id) === Number(selected.id)
      ? { ...i, counsel_json: JSON.stringify(body) }
      : i)));
    await loadTimeline(String(selected.symbol), Number(selected.id));
  }

  async function loadInsight() {
    if (!quote) return;
    setInsightBusy(true);
    try {
      await lookupTicker(quote.symbol, chartDays, true);
    } finally {
      setInsightBusy(false);
    }
  }

  async function loadOptions() {
    if (!quote) return;
    setOptionsBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/watchlist/options?symbol=${encodeURIComponent(quote.symbol)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Options chain failed.");
      setOptions(body as OptionsChain);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Options chain failed.");
    } finally {
      setOptionsBusy(false);
    }
  }

  return (
    <div className="wl">
      <form
        className="wl-add"
        onSubmit={(e) => {
          e.preventDefault();
          void lookupTicker(tickerQuery);
        }}
      >
        <input
          value={tickerQuery}
          onChange={(e) => setTickerQuery(e.target.value.toUpperCase())}
          placeholder="Add ticker — SOXL"
          autoComplete="off"
          spellCheck={false}
          disabled={lookupBusy}
        />
        <button type="submit" className="primary" disabled={lookupBusy}>
          {lookupBusy ? "…" : "Add / open"}
        </button>
        <button type="button" className="ghost-btn" disabled={busy || !items.length} onClick={() => void refreshAll()}>
          Refresh all
        </button>
      </form>

      {error && <div className="error-box">{error}</div>}

      <div className="wl-layout">
        <aside className="wl-rail" aria-label="Watchlist">
          <header>
            <span>Watching</span>
            <b>{items.length}</b>
          </header>
          <div className="wl-rail-list">
            {items.map((item) => {
              const ch = item.last_price && item.previous_close
                ? (Number(item.last_price) / Number(item.previous_close) - 1) * 100
                : null;
              const active = Number(item.id) === selectedId;
              return (
                <button
                  type="button"
                  key={Number(item.id)}
                  className={`wl-row${active ? " active" : ""}`}
                  onClick={() => void selectItem(item)}
                >
                  <div className="wl-row-top">
                    <b>{item.symbol}</b>
                    <span className={(ch ?? 0) >= 0 ? "positive" : "negative"}>
                      {ch == null ? "—" : `${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="wl-row-bot">
                    <span>{item.setup}</span>
                    <span>{item.last_price != null ? money(Number(item.last_price)) : "—"}</span>
                  </div>
                </button>
              );
            })}
            {!items.length && (
              <div className="wl-empty">
                Empty list. Type a ticker above, review the tape, then save it here.
              </div>
            )}
          </div>
        </aside>

        <main className="wl-desk">
          {pendingDraft && showAddForm && quote && (
            <section className="wl-save-card">
              <header>
                <h2>{quote.symbol}</h2>
                <p className={(changePct ?? 0) >= 0 ? "positive" : "negative"}>
                  {money(quote.price)}
                  {changePct == null ? "" : ` · ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
                </p>
              </header>
              <p className="muted">Not on your list yet. Save it to keep a diary and show it in the rail.</p>
              <form className="commit-form" onSubmit={commitDraft}>
                <label>Setup<input name="setup" required placeholder="POC to VAH" /></label>
                <label>Timeframe<input name="timeframe" defaultValue="swing" /></label>
                <label className="span-2">Note<textarea name="thesis" required placeholder="Watching 195 break to play 202…" rows={3} /></label>
                <label>Invalidation / watch<input name="invalidation" type="number" step="0.01" placeholder="195" /></label>
                <label>Target<input name="target" type="number" step="0.01" placeholder="202" /></label>
                <button className="primary span-2" disabled={busy}>{busy ? "Saving…" : "Save to watchlist"}</button>
                <button type="button" className="ghost-btn span-2" onClick={() => void discardDraft()}>Discard</button>
              </form>
              {hist.length > 0 && (
                <div className="wl-save-preview">
                  <TaWorkbench bars={hist} />
                </div>
              )}
            </section>
          )}

          {!pendingDraft && !selected && (
            <div className="wl-empty desk">
              Select a ticker from the list, or add one above.
            </div>
          )}

          {selected && !pendingDraft && (
            <>
              <div className="wl-tabs">
                <button type="button" className={tab === "note" ? "active" : ""} onClick={() => setTab("note")}>Note & diary</button>
                <button type="button" className={tab === "market" ? "active" : ""} onClick={() => setTab("market")}>Market</button>
              </div>

              {tab === "note" && (
                <TickerJournal
                  item={{
                    ...selected,
                    created_at: selected.created_at ? String(selected.created_at) : undefined,
                    trigger_price: selected.trigger_price == null ? null : Number(selected.trigger_price),
                    invalidation: selected.invalidation == null ? null : Number(selected.invalidation),
                    target: selected.target == null ? null : Number(selected.target),
                    last_price: selected.last_price == null ? null : Number(selected.last_price),
                  }}
                  timeline={timeline}
                  counsel={counsel}
                  lookupBusy={lookupBusy}
                  uploadBusy={uploadBusy}
                  counselBusy={counselBusy}
                  pasteHint={pasteHint}
                  caption={caption}
                  question={question}
                  onCaption={setCaption}
                  onQuestion={setQuestion}
                  onReload={() => void lookupTicker(String(selected.symbol))}
                  onStatus={(next) => void status(Number(selected.id), next)}
                  onRemove={() => void remove(Number(selected.id))}
                  onPaste={onPasteShot}
                  onUpload={upload}
                  onRemoveShot={(id) => void removeShot(id)}
                  onCounsel={(e) => void runCounsel(e)}
                  onClose={() => {
                    setSelectedId(null);
                    setLookup(null);
                    setAnalysis(null);
                    setTimeline([]);
                    syncTickerUrl(null);
                  }}
                />
              )}

              {tab === "market" && (
                <section className="wl-market">
                  {!quote && lookupBusy && <div className="terminal-empty compact">Loading market…</div>}
                  {quote && (
                    <>
                      <div className="kpi-row">
                        <div className="kpi-card">
                          <span>Price</span>
                          <b>{money(quote.price)}</b>
                          <small className={positive ? "positive" : "negative"}>
                            {changePct == null ? "—" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
                          </small>
                        </div>
                        <div className={`kpi-card tone-${stateTone(states.volume)}`}>
                          <span>Vol vs avg</span>
                          <b>{volRatio == null ? "—" : `${volRatio.toFixed(2)}×`}</b>
                        </div>
                        <div className={`kpi-card tone-${stateTone(states.rsi)}`}>
                          <span>RSI</span>
                          <b>{rsi == null ? "—" : rsi.toFixed(1)}</b>
                          <small>{stateLabel("rsi", states.rsi)}</small>
                        </div>
                        <div className={`kpi-card tone-${stateTone(states.vsSma20)}`}>
                          <span>vs SMA20</span>
                          <b>{vsSma20 == null ? "—" : `${vsSma20 >= 0 ? "+" : ""}${vsSma20.toFixed(1)}%`}</b>
                        </div>
                        <div className="kpi-card">
                          <span>Bid / Ask</span>
                          <b>{money(quote.bid)} · {money(quote.ask)}</b>
                        </div>
                        <div className="kpi-card">
                          <span>P/E</span>
                          <b>{pe == null ? "—" : pe.toFixed(1)}</b>
                        </div>
                        <div className="kpi-card">
                          <span>52w</span>
                          <b>{low52 == null || high52 == null ? "—" : `${money(low52)}–${money(high52)}`}</b>
                        </div>
                        <div className="kpi-card">
                          <span>Mkt cap</span>
                          <b>{mktCap == null ? "—" : format.number(mktCap, { notation: "compact", maximumFractionDigits: 1 })}</b>
                        </div>
                      </div>

                      <div className="wl-state-grid" aria-label="Indicator states">
                        {(["rsi", "vsSma20", "macd", "stoch", "volume", "bb"] as const).map((key) => (
                          <div key={key} className={`wl-state-chip tone-${stateTone(states[key])}`}>
                            <span>{key}</span>
                            <b>{stateLabel(key, states[key])}</b>
                          </div>
                        ))}
                      </div>

                      <div className="tf-row watch-controls">
                        {[
                          { label: "1M", days: 30 },
                          { label: "3M", days: 90 },
                          { label: "6M", days: 180 },
                          { label: "1Y", days: 365 },
                        ].map((tf) => (
                          <button
                            key={tf.days}
                            type="button"
                            className={chartDays === tf.days ? "active" : ""}
                            disabled={lookupBusy}
                            onClick={() => {
                              setChartDays(tf.days);
                              void lookupTicker(quote.symbol, tf.days, false);
                            }}
                          >
                            {tf.label}
                          </button>
                        ))}
                        <select
                          value={interval}
                          onChange={(e) => {
                            const next = e.target.value as Interval;
                            setInterval(next);
                            setVpMode(next === "day" ? "daily" : "session");
                          }}
                        >
                          <option value="day">Daily</option>
                          <option value="hour">Hour</option>
                          <option value="10minute">10m</option>
                          <option value="5minute">5m</option>
                        </select>
                        <label className="live-auto">
                          <input
                            type="checkbox"
                            checked={includeMl}
                            onChange={(e) => {
                              const next = e.target.checked;
                              setIncludeMl(next);
                              void lookupTicker(quote.symbol, chartDays, false, next);
                            }}
                          />
                          ML
                        </label>
                        <button type="button" className="ghost-btn" disabled={insightBusy || lookupBusy} onClick={() => void loadInsight()}>
                          {insightBusy ? "Insight…" : "Process insight"}
                        </button>
                        <button type="button" className="ghost-btn" disabled={optionsBusy} onClick={() => void loadOptions()}>
                          {optionsBusy ? "Options…" : "Options chain"}
                        </button>
                      </div>

                      <p className="muted watch-disclaimer">Descriptive market math — not recommendations.</p>

                      {(insight?.headline || insight?.marketRead) && (
                        <div className="wl-panel">
                          <h3>{insight.headline || "Market read"}</h3>
                          {insight.marketRead && <p>{insight.marketRead}</p>}
                          {!!insight.whatChanged?.length && (
                            <ul>
                              {insight.whatChanged.map((line) => <li key={line}>{line}</li>)}
                            </ul>
                          )}
                          {!!insight.questions?.length && (
                            <ul>
                              {insight.questions.map((q) => <li key={q}>{q}</li>)}
                            </ul>
                          )}
                        </div>
                      )}

                      {analysis?.risk && hist.length > 1 && <RiskStrip bars={hist} />}
                      {hist.length > 0 && (
                        <>
                          <TechChart
                            points={hist}
                            sma20={analysis?.last?.sma20 ?? market?.technicals.sma20}
                            sma50={analysis?.last?.sma50 ?? market?.technicals.sma50}
                          />
                          <TaWorkbench bars={hist} />
                          <RangeMeter position={market?.trend.rangePosition ?? null} />
                        </>
                      )}
                      {analysis?.volumeProfile && (
                        <VolumeProfileChart
                          bins={analysis.volumeProfile.bins}
                          poc={analysis.volumeProfile.poc}
                          vah={analysis.volumeProfile.vah}
                          val={analysis.volumeProfile.val}
                          mode={analysis.volumeProfile.mode}
                        />
                      )}

                      {analysis?.ml && (
                        <div className="wl-panel">
                          <h3>Experimental ML</h3>
                          <p className="muted">{analysis.ml.disclaimer}</p>
                          <p>
                            Predicted close: <b>{money(analysis.ml.predictedClose)}</b>
                            {analysis.ml.predictedChangePct != null && (
                              <> · {analysis.ml.predictedChangePct >= 0 ? "+" : ""}{analysis.ml.predictedChangePct.toFixed(2)}%</>
                            )}
                            {" · "}Test R² {analysis.ml.testScore.toFixed(3)}
                          </p>
                          {!!analysis.ml.featureImportance?.length && (
                            <ul>
                              {analysis.ml.featureImportance.slice(0, 5).map((f) => (
                                <li key={f.feature}>{f.feature}: {f.importance.toFixed(3)}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      {options && (
                        <div className="wl-panel">
                          <h3>Options · {options.symbol}</h3>
                          <p className="muted">{options.note || "Read-only Yahoo chain — not for order placement."}</p>
                          <p>Expiries: {options.expiries.slice(0, 6).join(", ") || "—"}</p>
                          {options.chains[0] && (
                            <p>
                              Nearest {options.chains[0].expiry}: {options.chains[0].calls.length} calls · {options.chains[0].puts.length} puts
                            </p>
                          )}
                        </div>
                      )}

                      <InsightCards items={insightCards} />
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
