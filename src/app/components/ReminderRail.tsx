"use client";

import { useState } from "react";
import reminders from "../../../data/reminders.json";

type Tone = "danger" | "warning" | "success" | "info" | "neutral";

const TONE: Record<Tone, string> = {
  danger: "border-error/40 bg-error/10",
  warning: "border-warning/40 bg-warning/10",
  success: "border-success/40 bg-success/10",
  info: "border-info/40 bg-info/10",
  neutral: "border-base-300 bg-base-100",
};

const DOT: Record<Tone, string> = {
  danger: "bg-error",
  warning: "bg-warning",
  success: "bg-success",
  info: "bg-info",
  neutral: "bg-base-content/40",
};

type Card = {
  id: string;
  tone: string;
  title: string;
  body: string;
  source?: string;
};

function ReminderCard({ card, compact }: { card: Card; compact?: boolean }) {
  const tone = (card.tone as Tone) in TONE ? (card.tone as Tone) : "neutral";
  return (
    <article className={`rounded-box border p-3 ${TONE[tone]} ${compact ? "" : "shadow-sm"}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 size-1.5 rounded-full shrink-0 ${DOT[tone]}`} aria-hidden />
        <div className="min-w-0 space-y-1">
          <h3 className="font-bold text-sm tracking-tight leading-snug">{card.title}</h3>
          <p className="text-xs leading-relaxed opacity-80">{card.body}</p>
          {card.source ? (
            <p className="text-[10px] uppercase tracking-wide opacity-40 pt-0.5">{card.source}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** Collapsible strip for < xl */
export function ReminderMobile() {
  const [open, setOpen] = useState(true);
  const cards = (reminders.cards ?? []) as Card[];
  if (!cards.length) return null;

  return (
    <div className="xl:hidden mb-4">
      <button
        type="button"
        className="btn btn-sm btn-ghost border border-base-300 w-full justify-between"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-semibold">Reminders</span>
        <span className="opacity-50 text-xs">{open ? "Hide" : `${cards.length} cards`}</span>
      </button>
      {open ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {cards.map((card) => (
            <ReminderCard key={card.id} card={card} compact />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Sticky right rail for xl+ */
export function ReminderSidebar() {
  const cards = (reminders.cards ?? []) as Card[];
  if (!cards.length) return null;

  return (
    <aside className="hidden xl:block w-72 shrink-0">
      <div className="sticky top-20 space-y-3 max-h-[calc(100vh-6rem)] overflow-y-auto pr-1 pb-4">
        <div className="px-1">
          <div className="text-[10px] font-bold uppercase tracking-wider opacity-40">Reminders</div>
          <p className="text-xs opacity-50 mt-0.5">Read before you size.</p>
        </div>
        {cards.map((card) => (
          <ReminderCard key={card.id} card={card} />
        ))}
      </div>
    </aside>
  );
}
