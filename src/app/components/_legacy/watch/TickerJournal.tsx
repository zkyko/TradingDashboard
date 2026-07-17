"use client";

import { FormEvent, ClipboardEvent, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import type { WatchActivity } from "@/lib/watchlist-activity";
import { useFormat } from "@/app/components/useFormat";

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
  created_at?: string;
  attachments?: Shot[];
};

type Counsel = {
  offline?: boolean;
  reflection?: string;
  readiness?: string;
};

export default function TickerJournal({
  item,
  timeline,
  counsel,
  lookupBusy,
  uploadBusy,
  counselBusy,
  pasteHint,
  caption,
  question,
  onCaption,
  onQuestion,
  onReload,
  onStatus,
  onRemove,
  onPaste,
  onUpload,
  onRemoveShot,
  onCounsel,
  onClose,
}: {
  item: Item;
  timeline: WatchActivity[];
  counsel: Counsel | null;
  lookupBusy: boolean;
  uploadBusy: boolean;
  counselBusy: boolean;
  pasteHint: string;
  caption: string;
  question: string;
  onCaption: (v: string) => void;
  onQuestion: (v: string) => void;
  onReload: () => void;
  onStatus: (status: string) => void;
  onRemove: () => void;
  onPaste: (e: ClipboardEvent<HTMLDivElement>) => void;
  onUpload: (e: FormEvent<HTMLFormElement>) => void;
  onRemoveShot: (id: string) => void;
  onCounsel: (e?: FormEvent) => void;
  onClose: () => void;
}) {
  const format = useFormat();
  const money = format.currency;
  const pasteRef = useRef<HTMLDivElement>(null);
  const shots = item.attachments || [];

  return (
    <article className="ticker-journal">
      <header className="tj-head">
        <div className="tj-title">
          <p className="tj-kicker">{item.timeframe || "Swing"} · {item.setup}</p>
          <h2>{item.symbol}</h2>
        </div>
        <div className="tj-actions">
          <button type="button" className="ghost-btn" onClick={onReload} disabled={lookupBusy}>
            {lookupBusy ? "…" : "Refresh market"}
          </button>
          <select value={String(item.status)} onChange={(e) => onStatus(e.target.value)} aria-label="Status">
            <option>WATCHING</option>
            <option>READY</option>
            <option>PASSED</option>
            <option>ARCHIVED</option>
          </select>
          <Link className="text-link" href={`/plan?ticker=${item.symbol}`}>Plan</Link>
          <button type="button" className="ghost-btn" onClick={onClose}>Clear selection</button>
          <button type="button" className="danger-text" onClick={onRemove}>Remove</button>
        </div>
      </header>

      <div className="tj-levels">
        {item.invalidation != null && (
          <div><span>Watch / invalidation</span><b>{money(Number(item.invalidation))}</b></div>
        )}
        {item.trigger_price != null && (
          <div><span>Trigger</span><b>{money(Number(item.trigger_price))}</b></div>
        )}
        {item.target != null && (
          <div><span>Target</span><b>{money(Number(item.target))}</b></div>
        )}
        {item.last_price != null && (
          <div><span>Last</span><b>{money(Number(item.last_price))}</b></div>
        )}
      </div>

      <section className="tj-thesis">
        <h3>Note</h3>
        <p>{item.thesis}</p>
        {item.created_at && (
          <time className="muted">Started {format.dateTime(item.created_at)}</time>
        )}
      </section>

      {shots.length > 0 && (
        <section className="tj-gallery">
          <h3>Charts</h3>
          <div className="tj-shots">
            {shots.map((shot) => (
              <figure key={shot.id}>
                <Image src={shot.url} alt={shot.caption || shot.originalName} width={1200} height={675} unoptimized />
                <figcaption>
                  <span>{shot.caption || shot.originalName}</span>
                  {shot.createdAt && <time>{format.date(shot.createdAt)}</time>}
                  <button type="button" onClick={() => onRemoveShot(shot.id)} aria-label="Remove">×</button>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className="tj-diary">
        <h3>Diary</h3>
        {timeline.length === 0 ? (
          <p className="muted tj-empty">Nothing logged yet. Hit Refresh market to stamp today’s quote + Python read, or drop a chart below.</p>
        ) : (
          <ol className="tj-feed">
            {timeline.map((act, i) => (
              <li key={`${act.id}-${i}`}>
                <div className="tj-feed-meta">
                  <time>{format.dateTime(act.createdAt)}</time>
                  <span className={`kind-chip kind-${act.kind}`}>{act.kind}</span>
                </div>
                <p>{act.summary || "—"}</p>
                {act.kind === "shot" && act.payload?.url ? (
                  <figure className="timeline-shot">
                    <Image src={String(act.payload.url)} alt={act.summary || "shot"} width={800} height={450} unoptimized />
                  </figure>
                ) : null}
                {act.kind === "refresh" && (act.payload?.rsi != null || act.payload?.price != null) ? (
                  <div className="tj-refresh-stats">
                    {act.payload.price != null && <span>Px {Number(act.payload.price).toFixed(2)}</span>}
                    {act.payload.changePct != null && (
                      <span className={Number(act.payload.changePct) >= 0 ? "positive" : "negative"}>
                        {Number(act.payload.changePct) >= 0 ? "+" : ""}{Number(act.payload.changePct).toFixed(2)}%
                      </span>
                    )}
                    {act.payload.rsi != null && <span>RSI {Number(act.payload.rsi).toFixed(1)}</span>}
                    {act.payload.vp && typeof act.payload.vp === "object" && "poc" in (act.payload.vp as object) && (act.payload.vp as { poc?: number }).poc != null ? (
                      <span>POC {Number((act.payload.vp as { poc: number }).poc).toFixed(2)}</span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="tj-compose">
        <h3>Add to diary</h3>
        <div
          ref={pasteRef}
          className="paste-well tj-paste"
          tabIndex={0}
          onPaste={onPaste}
          onClick={() => pasteRef.current?.focus()}
        >
          <strong>{uploadBusy ? "Uploading…" : pasteHint}</strong>
          <span>Screenshot becomes today’s chart entry</span>
        </div>
        <form className="shot-form" onSubmit={onUpload}>
          <input name="file" type="file" accept="image/png,image/jpeg,image/webp" />
          <input name="caption" value={caption} onChange={(e) => onCaption(e.target.value)} placeholder="What does this chart show?" />
          <button className="ghost-btn" disabled={uploadBusy}>Attach</button>
        </form>
        <form className="tj-ask" onSubmit={onCounsel}>
          <label htmlFor="tj-ask-q">Process check-in</label>
          <textarea
            id="tj-ask-q"
            value={question}
            onChange={(e) => onQuestion(e.target.value)}
            placeholder="e.g. Am I still waiting for 195 break, or did I move the level?"
          />
          <button className="primary" disabled={counselBusy}>{counselBusy ? "…" : "Log check-in"}</button>
        </form>
        {counsel && (
          <div className="ai-result">
            <div className="readiness-row">
              <strong>{counsel.readiness}</strong>
              <span className={counsel.offline ? "amber" : "positive"}>{counsel.offline ? "Offline" : "AI"}</span>
            </div>
            <p>{counsel.reflection}</p>
          </div>
        )}
      </section>
    </article>
  );
}
