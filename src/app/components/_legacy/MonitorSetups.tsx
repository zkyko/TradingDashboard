"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LIVE_DEFAULT_SYMBOLS, type LiveBoardPayload } from "@/lib/python-service";
import { boardPlayRadar } from "@/lib/vp-plays";

type FocusPlay = ReturnType<typeof boardPlayRadar>[number];

export default function MonitorSetups() {
  const [plays, setPlays] = useState<FocusPlay[]>([]);
  const [focus, setFocus] = useState<FocusPlay | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/watchlist/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            interval: "15m",
            symbols: [...LIVE_DEFAULT_SYMBOLS],
            includeMl: false,
          }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Setups unavailable");
        if (cancelled) return;
        const radar = boardPlayRadar((body as LiveBoardPayload).symbols || []);
        setPlays(radar.slice(0, 6));
        setFocus(radar[0] || null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Setups unavailable");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="monitor-setups" aria-label="Forming setups">
      <div className="monitor-setups-head">
        <div>
          <strong>Forming now</strong>
          <small className="muted">
            {busy ? "Scanning live board…" : error || "VP auction stories from Live · process map only"}
          </small>
        </div>
        <Link className="ghost-btn" href="/watchlist/live">Open Live</Link>
      </div>

      {focus && (
        <article className={`monitor-focus bias-${focus.bias}`}>
          <div className="monitor-focus-top">
            <b>{focus.symbol}</b>
            <span>{focus.name}</span>
            <em>{focus.heat}</em>
            <span className="monitor-focus-status">{focus.status}</span>
          </div>
          <p className="monitor-focus-tag">{focus.tagline}</p>
          <p>{focus.thesis}</p>
          <div className="monitor-focus-actions">
            <span><strong>Watch</strong> {focus.watch}</span>
            <Link href={`/watchlist/live`}>Bring up on Live →</Link>
          </div>
        </article>
      )}

      {!!plays.length && (
        <div className="monitor-setup-chips">
          {plays.map((play) => (
            <button
              type="button"
              key={`${play.symbol}-${play.id}`}
              className={`monitor-setup-chip${focus?.symbol === play.symbol && focus?.id === play.id ? " active" : ""}`}
              onClick={() => setFocus(play)}
            >
              <b>{play.symbol}</b>
              <span>{play.name}</span>
              <em>{play.heat}</em>
            </button>
          ))}
        </div>
      )}

      {!busy && !plays.length && !error && (
        <p className="muted" style={{ margin: 0 }}>No sharp VP edges on the live board right now.</p>
      )}
    </section>
  );
}
