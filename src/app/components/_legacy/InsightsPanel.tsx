"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProcessPatternInsight, SentimentInsight } from "@/lib/insights";
import { useI18n } from "@/locales/client";

const CACHE_KEY = "zk-insights-cache-v2";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // trust server day-cache; client soft-cache half day

type CachePayload = { at: number; sentiment: SentimentInsight; patterns: ProcessPatternInsight };

export default function InsightsPanel({ compact = false }: { compact?: boolean }) {
  const t = useI18n();
  const [sentiment, setSentiment] = useState<SentimentInsight | null>(null);
  const [patterns, setPatterns] = useState<ProcessPatternInsight | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cachedLabel, setCachedLabel] = useState(false);

  const load = useCallback(async (force = false) => {
    setBusy(true);
    setError("");
    try {
      if (!force) {
        try {
          const raw = sessionStorage.getItem(CACHE_KEY);
          if (raw) {
            const cached = JSON.parse(raw) as CachePayload;
            if (Date.now() - cached.at < CACHE_TTL_MS) {
              setSentiment(cached.sentiment);
              setPatterns(cached.patterns);
              setCachedLabel(true);
              setBusy(false);
              return;
            }
          }
        } catch { /* ignore */ }
      }
      const response = await fetch(`/api/insights${force ? "?force=1" : ""}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Insights failed.");
      setSentiment(data.sentiment);
      setPatterns(data.patterns);
      setCachedLabel(Boolean(data.sentiment?.cached || data.patterns?.cached));
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
          at: Date.now(),
          sentiment: data.sentiment,
          patterns: data.patterns,
        } satisfies CachePayload));
      } catch { /* ignore */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Insights failed.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className={`terminal-panel insights-panel${compact ? " compact" : ""}`}>
      <div className="panel-head">
        <span>{t("insights.title")}{cachedLabel ? ` · ${t("insights.cached")}` : ""}</span>
        <button type="button" onClick={() => void load(true)} disabled={busy}>{busy ? "…" : t("common.refresh")}</button>
      </div>
      {error && <p className="error-box">{error}</p>}
      <div className="insights-grid">
        <article>
          <header>
            <strong>{t("insights.sentiment")}</strong>
            {sentiment && <em className={`tone-${sentiment.overall}`}>{sentiment.overall}</em>}
          </header>
          {!sentiment ? (
            <p className="muted">{t("common.loading")}</p>
          ) : (
            <>
              <p>{sentiment.summary}</p>
              <p className="muted"><b>{t("insights.marketTone")}</b> · {sentiment.marketTone}</p>
              <p className="muted"><b>{t("insights.behavior")}</b> · {sentiment.behaviorTone}</p>
              {!!sentiment.flags.length && (
                <ul>{sentiment.flags.map((f, i) => <li key={`f-${i}`}>{f}</li>)}</ul>
              )}
              {!!sentiment.questions.length && (
                <ul className="questions">{sentiment.questions.map((q, i) => <li key={`q-${i}`}>{q}</li>)}</ul>
              )}
            </>
          )}
        </article>
        <article>
          <header>
            <strong>{t("insights.patterns")}</strong>
            {patterns?.offline && <em>{t("insights.offline")}</em>}
          </header>
          {!patterns ? (
            <p className="muted">{t("common.loading")}</p>
          ) : (
            <>
              <p>{patterns.headline}</p>
              <div className="pattern-list">
                {patterns.patterns.map((p, i) => (
                  <div key={`p-${i}`}>
                    <b>{p.name}</b>
                    <span>{p.evidence}</span>
                    <small>{p.processRisk}</small>
                  </div>
                ))}
              </div>
              {!!patterns.habitsToKeep.length && (
                <p className="muted"><b>{t("insights.keep")}</b> · {patterns.habitsToKeep.join(" · ")}</p>
              )}
              {!!patterns.habitsToWatch.length && (
                <p className="muted"><b>{t("insights.watch")}</b> · {patterns.habitsToWatch.join(" · ")}</p>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
