import { db } from "@/lib/db";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";

export type TraderPlan = {
  focus: string;
  process: string;
  goal: string;
  universe: string[];
  noOptions: boolean;
  writeBeforeTrade: boolean;
  notes: string;
  updatedAt: string;
};

const DEFAULT_PLAN: TraderPlan = {
  focus: "High-leveraged ETFs only — identify trend and swing, keep losses small.",
  process: "Write the decision (thesis, invalidation, size intent) before any buy or sell click.",
  goal: "Trend + swing identification on leveraged ETFs; minimize losses; no options going forward.",
  universe: ["SOXL", "SOXS", "TQQQ", "SQQQ", "TSLL", "LABD", "SPXL", "SPXS", "QLD", "QID"],
  noOptions: true,
  writeBeforeTrade: true,
  notes: "Stepped off options Jul 2026. Notifications watch price levels and forming setups.",
  updatedAt: new Date().toISOString(),
};

db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

export function getTraderPlan(): TraderPlan {
  const row = db.prepare(`SELECT value_json FROM app_settings WHERE key='trader_plan'`).get() as
    | { value_json: string }
    | undefined;
  if (!row) {
    saveTraderPlan(DEFAULT_PLAN);
    return DEFAULT_PLAN;
  }
  try {
    return { ...DEFAULT_PLAN, ...(JSON.parse(row.value_json) as Partial<TraderPlan>) };
  } catch {
    return DEFAULT_PLAN;
  }
}

export function saveTraderPlan(plan: Partial<TraderPlan>): TraderPlan {
  const next: TraderPlan = {
    ...getTraderPlanSafe(),
    ...plan,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(`INSERT INTO app_settings (key, value_json, updated_at) VALUES ('trader_plan', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`)
    .run(JSON.stringify(next), next.updatedAt);
  return next;
}

function getTraderPlanSafe(): TraderPlan {
  const row = db.prepare(`SELECT value_json FROM app_settings WHERE key='trader_plan'`).get() as
    | { value_json: string }
    | undefined;
  if (!row) return { ...DEFAULT_PLAN };
  try {
    return { ...DEFAULT_PLAN, ...(JSON.parse(row.value_json) as Partial<TraderPlan>) };
  } catch {
    return { ...DEFAULT_PLAN };
  }
}

/** Compact block for AI prompts. */
export function traderPlanForAi(plan: TraderPlan = getTraderPlan()) {
  return {
    focus: plan.focus,
    process: plan.process,
    goal: plan.goal,
    universe: plan.universe,
    noOptions: plan.noOptions,
    writeBeforeTrade: plan.writeBeforeTrade,
    notes: plan.notes,
    reminder: plan.writeBeforeTrade
      ? "Before any buy/sell: require a written note (thesis + invalidation)."
      : null,
    timeZoneHint: DEFAULT_TIMEZONE,
  };
}
