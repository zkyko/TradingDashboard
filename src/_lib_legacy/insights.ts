import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { computeAnalytics, type ClosedTrade } from "./analytics";
import { accountBriefContext } from "./account-desk";
import { optionsBriefContext } from "./options-reflection";
import { retrieveJournalContext } from "./memory";
import { parseExecutedAt, formatDate } from "./format";
import { sanitizeJournalHtml, scrubTradeAdvice } from "./sanitize";
import { dayKeyInZone, DEFAULT_TIMEZONE, nowContext } from "./timezone";
import { getTraderPlan, traderPlanForAi } from "./trader-plan";
import { notificationsForAi } from "./notifications";

const apiKey = process.env.DEEPSEEK_API_KEY;
const client = apiKey
  ? new OpenAI({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com" })
  : null;

const DOCTRINE = `You help with a personal trading process journal.
Never recommend buys, sells, entries, exits, size, leverage, or tickers to trade.
Focus on behavior, process, risk hygiene, and observable facts already present in the data.
The trader is stepping off options and focusing on high-leveraged ETFs with trend/swing identification and write-before-trade discipline.
Always use the provided NOW clock for timeline awareness (what happened, what is next today/this week).
Return JSON only when asked.`;

function aiClockBlock(timeZone = DEFAULT_TIMEZONE) {
  const now = nowContext(timeZone);
  const plan = traderPlanForAi(getTraderPlan());
  const alerts = notificationsForAi(6);
  return {
    now,
    plan,
    openNotifications: alerts,
    preamble: `${now.line}\nTRADER_PLAN ${JSON.stringify(plan)}\nOPEN_NOTIFICATIONS ${JSON.stringify(alerts)}`,
  };
}

const TARGET_FIELDS = [
  "ticker",
  "side",
  "quantity",
  "price",
  "executedAt",
  "externalId",
  "ignore",
] as const;

export type ImportField = (typeof TARGET_FIELDS)[number];
export type FieldMapping = Record<string, ImportField | null>;

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseSide(raw: string): "BUY" | "SELL" | "" {
  const sideRaw = raw.trim().toUpperCase();
  if (!sideRaw) return "";
  if (sideRaw === "B" || sideRaw === "BUY" || sideRaw === "LONG") return "BUY";
  if (sideRaw === "S" || sideRaw === "SELL" || sideRaw === "SHORT") return "SELL";
  return "";
}

function parseQuantity(raw: string): number | null {
  const cleaned = String(raw).replace(/,/g, "").trim();
  if (!cleaned) return null;
  const qty = Number(cleaned);
  if (!Number.isFinite(qty) || qty === 0) return null;
  return Math.abs(qty);
}

export async function mapImportColumns(columns: string[], sampleRows: Array<Record<string, string>>): Promise<{
  mapping: FieldMapping;
  notes: string[];
  offline?: boolean;
}> {
  const heuristic: FieldMapping = {};
  for (const col of columns) {
    const key = col.toLowerCase().trim();
    if (/(symbol|ticker|instrument|underlying)/.test(key)) heuristic[col] = "ticker";
    else if (/(^side$|action|buy.?sell|direction)/.test(key)) heuristic[col] = "side";
    else if (/(qty|quantity|shares|size|filled.?qty)/.test(key)) heuristic[col] = "quantity";
    else if (/(avg.?price|fill.?price|price|execution.?price)/.test(key) && !/stop|limit|mark/.test(key)) heuristic[col] = "price";
    else if (/(executed|fill.?time|trade.?time|timestamp|date|time)/.test(key)) heuristic[col] = "executedAt";
    else if (/(order.?id|exec.?id|external.?id|activity.?id|trade.?id|fill.?id|^id$)/.test(key)) heuristic[col] = "externalId";
    else heuristic[col] = "ignore";
  }

  if (!client) {
    return { mapping: heuristic, notes: ["Offline heuristic mapping — set DEEPSEEK_API_KEY for AI mapping."], offline: true };
  }

  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      {
        role: "system",
        content: `${DOCTRINE}
Map CSV columns to import fields for fills.
Allowed targets: ${TARGET_FIELDS.join(", ")}.
Use ignore when a column is irrelevant. Prefer order/execution/activity ids for externalId — never account id.
Return JSON: {"mapping":{"Column Name":"ticker|side|quantity|price|executedAt|externalId|ignore"},"notes":["string"]}.`,
      },
      {
        role: "user",
        content: `Columns:\n${columns.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nSample rows:\n${JSON.stringify(sampleRows.slice(0, 5), null, 2)}\n\nHeuristic guess:\n${JSON.stringify(heuristic)}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1200,
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) return { mapping: heuristic, notes: ["AI returned empty mapping; using heuristics."] };
  const parsed = JSON.parse(raw) as { mapping?: FieldMapping; notes?: string[] };
  const mapping: FieldMapping = { ...heuristic };
  if (parsed.mapping && typeof parsed.mapping === "object") {
    for (const [col, value] of Object.entries(parsed.mapping)) {
      if (columns.includes(col) && value && TARGET_FIELDS.includes(value as ImportField)) {
        mapping[col] = value as ImportField;
      }
    }
  }
  return {
    mapping,
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(String).slice(0, 6) : [],
  };
}

export function applyMappedRows(
  rows: Array<Record<string, string>>,
  mapping: FieldMapping,
) {
  const byField = new Map<ImportField, string[]>();
  for (const [col, field] of Object.entries(mapping)) {
    if (!field || field === "ignore") continue;
    const list = byField.get(field) || [];
    list.push(col);
    byField.set(field, list);
  }

  const multi = [...byField.entries()].filter(([, cols]) => cols.length > 1);
  if (multi.length) {
    throw new Error(`Multiple columns mapped to the same field: ${multi.map(([f, cols]) => `${f}←${cols.join(",")}`).join("; ")}`);
  }
  if (!byField.has("executedAt")) {
    throw new Error("Map an executedAt/date column before importing. Timestamps are required for FIFO analytics.");
  }
  if (!byField.has("ticker") || !byField.has("side") || !byField.has("quantity") || !byField.has("price")) {
    throw new Error("Map ticker, side, quantity, and price before importing.");
  }

  const getCol = (field: ImportField) => byField.get(field)?.[0];
  const inserted: string[] = [];
  const skipped: string[] = [];
  const insert = db.prepare(`INSERT OR IGNORE INTO executions
    (external_id,ticker,side,quantity,price,executed_at,decision_id)
    VALUES (?,?,?,?,?,?,NULL)`);

  const planned: Array<{ externalId: string; ticker: string; side: string; quantity: number; price: number; executedAt: string; row: number }> = [];
  for (const [index, row] of rows.entries()) {
    const read = (field: ImportField) => {
      const col = getCol(field);
      return col ? String(row[col] ?? "").trim() : "";
    };
    const ticker = read("ticker").toUpperCase();
    let side = parseSide(read("side"));
    const qtyRaw = Number(String(read("quantity")).replace(/,/g, ""));
    if (!side && Number.isFinite(qtyRaw) && qtyRaw < 0) side = "SELL";
    const quantity = parseQuantity(read("quantity"));
    const price = Number(String(read("price")).replace(/[$,]/g, ""));
    const executedAt = parseExecutedAt(read("executedAt"));
    const externalId = read("externalId") || `import-${randomUUID()}`;
    if (!ticker || !side || quantity == null || !price || price <= 0 || !executedAt) {
      skipped.push(`row ${index + 1}: invalid fields`);
      continue;
    }
    planned.push({ externalId, ticker, side, quantity, price, executedAt, row: index + 1 });
  }

  const seen = new Map<string, number>();
  for (const item of planned) {
    if (seen.has(item.externalId)) {
      throw new Error(`Duplicate externalId "${item.externalId}" in rows ${seen.get(item.externalId)} and ${item.row}. Remap externalId or fix the CSV.`);
    }
    seen.set(item.externalId, item.row);
  }

  const tx = db.transaction(() => {
    for (const item of planned) {
      const result = insert.run(item.externalId, item.ticker, item.side, item.quantity, item.price, item.executedAt);
      if (result.changes) inserted.push(item.externalId);
      else skipped.push(`dup ${item.externalId}`);
    }
  });
  tx();
  return { inserted: inserted.length, skipped: skipped.length, skippedSamples: skipped.slice(0, 8) };
}

export type SentimentInsight = {
  offline?: boolean;
  overall: "constructive" | "cautious" | "mixed" | "strained";
  summary: string;
  marketTone: string;
  behaviorTone: string;
  flags: string[];
  questions: string[];
};

function scrubInsightText<T extends Record<string, unknown>>(obj: T, keys: string[]): T {
  const next = { ...obj };
  for (const key of keys) {
    const value = next[key];
    if (typeof value === "string") (next as Record<string, unknown>)[key] = scrubTradeAdvice(value);
    if (Array.isArray(value)) (next as Record<string, unknown>)[key] = value.map((item) => typeof item === "string" ? scrubTradeAdvice(item) : item);
  }
  return next;
}

/** Parse LLM JSON; tolerate truncated / lightly broken payloads. */
function parseModelJson(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* continue */
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1);
    try {
      return JSON.parse(slice) as Record<string, unknown>;
    } catch {
      // Close common truncation: dangling quote / unfinished string at EOF
      const repaired = slice
        .replace(/,\s*$/, "")
        .replace(/("(?:\\.|[^"\\])*)\s*$/, "$1\"")
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]");
      try {
        return JSON.parse(repaired) as Record<string, unknown>;
      } catch {
        try {
          return JSON.parse(`${repaired}}`) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export async function analyzeSentiment(opts: { force?: boolean } = {}): Promise<SentimentInsight & { cached?: boolean; updatedAt?: string }> {
  const { getDayCache, setDayCache } = await import("./desk-cache");
  if (!opts.force) {
    const hit = getDayCache<SentimentInsight>("insights:sentiment");
    if (hit) return { ...hit.value, cached: true, updatedAt: hit.updatedAt };
  }
  const analytics = computeAnalytics();
  const context = retrieveJournalContext("process discipline patterns sentiment revenge impulsivity", 8);
  if (!client) {
    const offline = {
      offline: true as const,
      overall: (analytics.metrics.realizedPnl >= 0 ? "mixed" : "cautious") as SentimentInsight["overall"],
      summary: "Offline sentiment — local stats only.",
      marketTone: "No live model read.",
      behaviorTone: `Win rate ${analytics.metrics.winRate == null ? "n/a" : `${(analytics.metrics.winRate * 100).toFixed(0)}%`}, expectancy ${analytics.metrics.expectancy?.toFixed(2) ?? "n/a"}.`,
      flags: analytics.patterns.slice(0, 4),
      questions: ["Which recent closes followed a written plan?", "Where did size or hold time drift?"],
    };
    setDayCache("insights:sentiment", offline);
    return offline;
  }
  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      {
        role: "system",
        content: `${DOCTRINE}
Analyze process sentiment from trading stats and journal excerpts.
Do not invent opportunities or recommend trades.
Return JSON: {"overall":"constructive|cautious|mixed|strained","summary":"string","marketTone":"string","behaviorTone":"string","flags":["string"],"questions":["string"]}.`,
      },
      {
        role: "user",
        content: `${aiClockBlock().preamble}\nMETRICS\n${JSON.stringify(analytics.metrics)}\nPATTERNS\n${analytics.patterns.join("\n")}\nWEEKDAY\n${JSON.stringify(analytics.weekdayPnl)}\nJOURNAL\n${context.map((c) => `${c.id}: ${c.text}`).join("\n")}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1200,
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty sentiment response.");
  const parsed = scrubInsightText(JSON.parse(raw) as Partial<SentimentInsight>, ["summary", "marketTone", "behaviorTone", "flags", "questions"]);
  const overall = ["constructive", "cautious", "mixed", "strained"].includes(String(parsed.overall))
    ? parsed.overall as SentimentInsight["overall"]
    : "mixed";
  const result: SentimentInsight = {
    overall,
    summary: String(parsed.summary || ""),
    marketTone: String(parsed.marketTone || ""),
    behaviorTone: String(parsed.behaviorTone || ""),
    flags: Array.isArray(parsed.flags) ? parsed.flags.map(String).slice(0, 6) : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, 5) : [],
  };
  const updatedAt = setDayCache("insights:sentiment", result);
  return { ...result, cached: false, updatedAt };
}

export type ProcessPatternInsight = {
  offline?: boolean;
  headline: string;
  patterns: Array<{ name: string; evidence: string; processRisk: string }>;
  habitsToKeep: string[];
  habitsToWatch: string[];
};

export async function recognizeProcessPatterns(opts: { force?: boolean } = {}): Promise<ProcessPatternInsight & { cached?: boolean; updatedAt?: string }> {
  const { getDayCache, setDayCache } = await import("./desk-cache");
  if (!opts.force) {
    const hit = getDayCache<ProcessPatternInsight>("insights:patterns");
    if (hit) return { ...hit.value, cached: true, updatedAt: hit.updatedAt };
  }
  const analytics = computeAnalytics();
  const context = retrieveJournalContext("plan adherence exceptions revenge size drift", 10);
  if (!client) {
    const offline: ProcessPatternInsight = {
      offline: true,
      headline: "Local pattern summary",
      patterns: analytics.patterns.slice(0, 4).map((p) => ({
        name: "Local signal",
        evidence: p,
        processRisk: "Review against written rules.",
      })),
      habitsToKeep: [],
      habitsToWatch: ["0% of fills linked to a plan in local data."],
    };
    setDayCache("insights:patterns", offline);
    return offline;
  }
  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      {
        role: "system",
        content: `${DOCTRINE}
Identify PROCESS patterns (behavior), not trade setups or opportunities.
Return JSON: {"headline":"string","patterns":[{"name":"string","evidence":"string","processRisk":"string"}],"habitsToKeep":["string"],"habitsToWatch":["string"]}.`,
      },
      {
        role: "user",
        content: `${aiClockBlock().preamble}\nANALYTICS\n${JSON.stringify({ metrics: analytics.metrics, byTicker: analytics.byTicker.slice(0, 8), patterns: analytics.patterns })}\nJOURNAL\n${context.map((c) => c.text).join("\n")}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1400,
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty pattern response.");
  const parsed = scrubInsightText(JSON.parse(raw) as Partial<ProcessPatternInsight>, ["headline", "habitsToKeep", "habitsToWatch"]);
  const result: ProcessPatternInsight = {
    headline: String(parsed.headline || "Process patterns"),
    patterns: Array.isArray(parsed.patterns)
      ? parsed.patterns.slice(0, 6).map((p) => ({
        name: scrubTradeAdvice(String((p as { name?: string }).name || "Pattern")),
        evidence: scrubTradeAdvice(String((p as { evidence?: string }).evidence || "")),
        processRisk: scrubTradeAdvice(String((p as { processRisk?: string }).processRisk || "")),
      }))
      : [],
    habitsToKeep: Array.isArray(parsed.habitsToKeep) ? parsed.habitsToKeep.map(String).slice(0, 5) : [],
    habitsToWatch: Array.isArray(parsed.habitsToWatch) ? parsed.habitsToWatch.map(String).slice(0, 5) : [],
  };
  const updatedAt = setDayCache("insights:patterns", result);
  return { ...result, cached: false, updatedAt };
}

export function listJournalEntries(limit = 50) {
  return db.prepare(`SELECT id,title,body_html,body_text,source,ticker,sentiment,tags_json,meta_json,fingerprint,created_at,updated_at
    FROM journal_entries ORDER BY datetime(updated_at) DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
}

export function getJournalEntry(id: string) {
  return db.prepare(`SELECT * FROM journal_entries WHERE id=?`).get(id) as Record<string, unknown> | undefined;
}

export function saveJournalEntry(input: {
  id?: string;
  title: string;
  bodyHtml: string;
  source?: string;
  ticker?: string | null;
  sentiment?: string | null;
  tags?: string[];
  meta?: Record<string, unknown>;
  fingerprint?: string | null;
  createOnly?: boolean;
}) {
  const bodyHtml = sanitizeJournalHtml(input.bodyHtml);
  const bodyText = stripHtml(bodyHtml);
  const existing = input.id ? getJournalEntry(input.id) : null;
  if (input.createOnly && existing) throw new Error("Journal entry already exists.");
  if (input.id && !existing) throw new Error("Journal entry not found.");

  if (existing) {
    const title = input.title.trim() || String(existing.title || "Untitled");
    db.prepare(`UPDATE journal_entries
      SET title=?, body_html=?, body_text=?, source=?, ticker=?, sentiment=?, tags_json=?, meta_json=?, fingerprint=COALESCE(?, fingerprint), updated_at=datetime('now')
      WHERE id=?`).run(
      title,
      bodyHtml,
      bodyText,
      input.source || existing.source || "manual",
      input.ticker !== undefined ? input.ticker : existing.ticker ?? null,
      input.sentiment !== undefined ? input.sentiment : existing.sentiment ?? null,
      JSON.stringify(input.tags ?? JSON.parse(String(existing.tags_json || "[]"))),
      JSON.stringify(input.meta ?? JSON.parse(String(existing.meta_json || "{}"))),
      input.fingerprint ?? null,
      input.id,
    );
    return getJournalEntry(String(input.id));
  }

  const id = input.id || randomUUID();
  db.prepare(`INSERT INTO journal_entries
    (id,title,body_html,body_text,source,ticker,sentiment,tags_json,meta_json,fingerprint)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    input.title.trim() || "Untitled",
    bodyHtml,
    bodyText,
    input.source || "manual",
    input.ticker ?? null,
    input.sentiment ?? null,
    JSON.stringify(input.tags ?? []),
    JSON.stringify(input.meta ?? {}),
    input.fingerprint ?? null,
  );
  return getJournalEntry(id);
}

export function deleteJournalEntry(id: string) {
  const shots = db.prepare("SELECT stored_name FROM attachments WHERE journal_entry_id=?").all(id) as Array<{ stored_name: string }>;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM attachments WHERE journal_entry_id=?").run(id);
    db.prepare("DELETE FROM journal_entries WHERE id=?").run(id);
  });
  tx();
  return shots;
}

async function draftTradeJournal(trade: ClosedTrade) {
  if (!client) {
    const html = `<p><strong>${trade.ticker}</strong> ${trade.side} close · qty ${trade.qty}</p>
<p>Entry ${trade.entryPrice.toFixed(4)} → exit ${trade.exitPrice.toFixed(4)} · PnL ${trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)} (${trade.pnlPct.toFixed(2)}%)</p>
<p>Process note (offline): what was the written plan for this close?</p>`;
    return {
      title: `${trade.ticker} close ${formatDate(trade.closedAt, "en")}`,
      bodyHtml: html,
      sentiment: trade.pnl >= 0 ? "constructive" : "cautious",
      tags: ["auto", trade.ticker, trade.side.toLowerCase()],
    };
  }
  const context = retrieveJournalContext(`${trade.ticker} ${trade.side}`, 5);
  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      {
        role: "system",
        content: `${DOCTRINE}
Write a short HTML journal entry for one closed fill (process reflection).
No trade advice. Use <p>, <ul>, <li>, <strong> only.
Return JSON: {"title":"string","bodyHtml":"string","sentiment":"constructive|cautious|mixed|strained","tags":["string"]}.`,
      },
      {
        role: "user",
        content: `CLOSED TRADE\n${JSON.stringify(trade)}\nJOURNAL CONTEXT\n${context.map((c) => c.text).join("\n") || "None"}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 900,
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty auto-journal response.");
  const parsed = JSON.parse(raw) as {
    title?: string;
    bodyHtml?: string;
    sentiment?: string;
    tags?: string[];
  };
  return {
    title: scrubTradeAdvice(String(parsed.title || `${trade.ticker} close`)),
    bodyHtml: sanitizeJournalHtml(String(parsed.bodyHtml || "<p></p>")),
    sentiment: parsed.sentiment || null,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 8) : ["auto"],
  };
}

export async function autoJournalFromRecent(limit = 5) {
  const analytics = computeAnalytics();
  const recent = analytics.recentTrades.slice(0, limit);
  const created: Array<Record<string, unknown>> = [];
  for (const trade of recent) {
    const fingerprint = `${trade.ticker}|${trade.closedAt}|${trade.qty}|${trade.exitPrice}`;
    const exists = db.prepare(`SELECT id FROM journal_entries WHERE fingerprint=? LIMIT 1`).get(fingerprint);
    if (exists) continue;
    const draft = await draftTradeJournal(trade);
    const entry = saveJournalEntry({
      title: draft.title,
      bodyHtml: draft.bodyHtml,
      source: "auto",
      ticker: trade.ticker,
      sentiment: draft.sentiment,
      tags: draft.tags,
      meta: { trade },
      fingerprint,
    });
    if (entry) created.push(entry);
  }
  return { created: created.length, entries: created };
}

export type AccountabilityBrief = {
  offline?: boolean;
  dayKey: string;
  headline: string;
  story: string;
  monthsRead: string;
  keep: string[];
  watch: string[];
  questions: string[];
  commitments: string[];
  updatedAt: string;
  cached?: boolean;
};

function localAccountabilityBrief(dayKey: string): AccountabilityBrief {
  const ctx = accountBriefContext();
  const clock = aiClockBlock();
  return {
    offline: true,
    dayKey,
    headline: "Local accountability map",
    story: `${clock.now.line}. ${ctx.activity.bullets.join(" ")} ${ctx.optionsNote}`,
    monthsRead: ctx.months.map((m) => `${m.label}: ${m.pnl >= 0 ? "+" : ""}${m.pnl} (${m.trades} closes)`).join(" · ") || "No monthly closes yet.",
    keep: ["Write the thesis before the click.", "Mark invalidation while calm.", "Leveraged ETFs only — no options."],
    watch: [
      ctx.activity.planLinkedPct != null && ctx.activity.planLinkedPct < 40
        ? "Plan-linked fills are low — decisions may be happening off-journal."
        : "Check whether recent closes still match written plans.",
    ],
    questions: [
      "Which month's behavior do you want to repeat — and which to retire?",
      "What observable rule would have changed yesterday's worst close?",
    ],
    commitments: [
      "One journal note before the next leveraged-ETF click.",
      "No new options orders.",
      "No new size rule invented mid-session.",
    ],
    updatedAt: new Date().toISOString(),
  };
}

/** Daily-cached process brief for Account — regenerates when day_key changes or force=true. */
export async function getAccountabilityBrief(opts: { force?: boolean; timeZone?: string } = {}): Promise<AccountabilityBrief> {
  const dayKey = dayKeyInZone(new Date(), opts.timeZone || DEFAULT_TIMEZONE);

  if (!opts.force) {
    const cached = db.prepare(`SELECT payload_json, created_at FROM accountability_briefs WHERE day_key=?`).get(dayKey) as
      | { payload_json: string; created_at: string }
      | undefined;
    if (cached) {
      try {
        const parsed = JSON.parse(cached.payload_json) as AccountabilityBrief;
        return { ...parsed, cached: true, dayKey };
      } catch {
        /* regenerate */
      }
    }
  }

  const ctx = accountBriefContext();
  const journal = retrieveJournalContext("accountability process discipline plan adherence month review", 10);
  const clock = aiClockBlock(opts.timeZone || DEFAULT_TIMEZONE);

  if (!client) {
    const brief = localAccountabilityBrief(dayKey);
    db.prepare(`INSERT OR REPLACE INTO accountability_briefs (day_key, payload_json, created_at) VALUES (?,?,?)`)
      .run(dayKey, JSON.stringify(brief), brief.updatedAt);
    return brief;
  }

  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      {
        role: "system",
        content: `${DOCTRINE}
You are writing a daily accountability brief for a trader's Account page.
Summarize how they have been behaving across months since the data window started.
Be concrete, kind, and firm. Never recommend buys/sells/tickers/size.
Options history lives on a separate Options tab — mention it only if optionsNote is present, do not deep-dive options here.
Anchor commitments to the NOW clock (what to do next today / this session).
Return JSON only:
{"headline":"string","story":"string","monthsRead":"string","keep":["string"],"watch":["string"],"questions":["string"],"commitments":["string"]}.
story = 2-4 sentences on what they've been doing so far.
monthsRead = how the months evolved (process, not hindsight trading advice).
commitments = 2-3 small process commitments for the next session (include write-before-trade if TRADER_PLAN says so).`,
      },
      {
        role: "user",
        content: `${clock.preamble}\nSTATS\n${JSON.stringify(ctx)}\nJOURNAL\n${journal.map((j) => j.text).join("\n") || "None"}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1100,
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    const brief = localAccountabilityBrief(dayKey);
    db.prepare(`INSERT OR REPLACE INTO accountability_briefs (day_key, payload_json, created_at) VALUES (?,?,?)`)
      .run(dayKey, JSON.stringify(brief), brief.updatedAt);
    return brief;
  }
  const parsedRaw = parseModelJson(raw);
  if (!parsedRaw) {
    const brief = localAccountabilityBrief(dayKey);
    brief.headline = "Accountability brief (local fallback)";
    brief.story = `${brief.story} AI returned incomplete JSON — showing local stats. Refresh again shortly.`;
    db.prepare(`INSERT OR REPLACE INTO accountability_briefs (day_key, payload_json, created_at) VALUES (?,?,?)`)
      .run(dayKey, JSON.stringify(brief), brief.updatedAt);
    return brief;
  }
  const parsed = scrubInsightText(parsedRaw, [
    "headline", "story", "monthsRead", "keep", "watch", "questions", "commitments",
  ]);
  const brief: AccountabilityBrief = {
    offline: false,
    dayKey,
    headline: String(parsed.headline || "Accountability brief"),
    story: String(parsed.story || ""),
    monthsRead: String(parsed.monthsRead || ""),
    keep: Array.isArray(parsed.keep) ? parsed.keep.map(String).slice(0, 5) : [],
    watch: Array.isArray(parsed.watch) ? parsed.watch.map(String).slice(0, 5) : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, 5) : [],
    commitments: Array.isArray(parsed.commitments) ? parsed.commitments.map(String).slice(0, 4) : [],
    updatedAt: new Date().toISOString(),
    cached: false,
  };
  db.prepare(`INSERT OR REPLACE INTO accountability_briefs (day_key, payload_json, created_at) VALUES (?,?,?)`)
    .run(dayKey, JSON.stringify(brief), brief.updatedAt);
  return brief;
}

export type OptionsProcessBrief = {
  offline?: boolean;
  dayKey: string;
  headline: string;
  story: string;
  patterns: string[];
  keep: string[];
  retire: string[];
  questions: string[];
  commitments: string[];
  updatedAt: string;
  cached?: boolean;
};

function localOptionsBrief(dayKey: string): OptionsProcessBrief {
  const ctx = optionsBriefContext();
  return {
    offline: true,
    dayKey,
    headline: "Options exit review",
    story: ctx.bullets.slice(0, 3).join(" "),
    patterns: [
      ctx.byStrategy[0] ? `Dominant structure: ${ctx.byStrategy[0].strategy} (${ctx.byStrategy[0].count}).` : "Structures unlabeled.",
      ctx.cancelRate != null ? `Cancel rate ~${ctx.cancelRate}% — friction or second-guessing.` : "Cancel rate unavailable.",
      ctx.roundTripCount
        ? `${ctx.roundTripCount} matched round trips · avg hold ${ctx.avgHoldHours ?? "—"}h.`
        : "Few matched open→close pairs to score.",
    ],
    keep: ["Review the tape before inventing a new rule.", "Write why an options habit ends — in journal."],
    retire: [
      "Opening new options tickets while reviewing the exit.",
      ctx.byDte.some((b) => b.bucket.includes("0–2") && b.orders > 10)
        ? "0–2 DTE habit if it drove churn."
        : "Whatever structure shows up most without a written plan.",
    ],
    questions: [
      "Which underlying turned into gambling vs defined risk?",
      "When cancel rate spiked, what were you avoiding?",
    ],
    commitments: ["No new options orders today.", "One journal note on the worst round trip."],
    updatedAt: new Date().toISOString(),
  };
}

/** Cached process brief for Options tab — reflection only, no trade advice. */
export async function getOptionsProcessBrief(opts: { force?: boolean; timeZone?: string } = {}): Promise<OptionsProcessBrief> {
  const dayKey = `opt:${dayKeyInZone(new Date(), opts.timeZone || DEFAULT_TIMEZONE)}`;

  if (!opts.force) {
    const cached = db.prepare(`SELECT payload_json, created_at FROM accountability_briefs WHERE day_key=?`).get(dayKey) as
      | { payload_json: string; created_at: string }
      | undefined;
    if (cached) {
      try {
        const parsed = JSON.parse(cached.payload_json) as OptionsProcessBrief;
        return { ...parsed, cached: true, dayKey };
      } catch {
        /* regenerate */
      }
    }
  }

  const ctx = optionsBriefContext();
  const journal = retrieveJournalContext("options process debit credit cancel hold time exit review", 8);
  const clock = aiClockBlock(opts.timeZone || DEFAULT_TIMEZONE);

  if (!client) {
    const brief = localOptionsBrief(dayKey);
    db.prepare(`INSERT OR REPLACE INTO accountability_briefs (day_key, payload_json, created_at) VALUES (?,?,?)`)
      .run(dayKey, JSON.stringify(brief), brief.updatedAt);
    return brief;
  }

  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      {
        role: "system",
        content: `${DOCTRINE}
You write an Options exit / reflection brief for a trader who is stopping options trading.
Help them see good and bad process in their order history. Never recommend new options trades, structures, underlyings, or size.
Use NOW clock so commitments are for the next session from this moment forward.
Return compact valid JSON only (short strings, no raw newlines inside values):
{"headline":"string","story":"string","patterns":["string"],"keep":["string"],"retire":["string"],"questions":["string"],"commitments":["string"]}.
story = 2-4 sentences on options habits in the window.
patterns = observable behavioral patterns from the stats.
retire = habits to leave behind.
commitments = include staying off new options tickets + write-before-trade on leveraged ETFs.`,
      },
      {
        role: "user",
        content: `${clock.preamble}\nOPTIONS STATS\n${JSON.stringify(ctx)}\nJOURNAL\n${journal.map((j) => j.text).join("\n") || "None"}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1600,
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    const brief = localOptionsBrief(dayKey);
    db.prepare(`INSERT OR REPLACE INTO accountability_briefs (day_key, payload_json, created_at) VALUES (?,?,?)`)
      .run(dayKey, JSON.stringify(brief), brief.updatedAt);
    return brief;
  }
  const parsedRaw = parseModelJson(raw);
  if (!parsedRaw) {
    const brief = localOptionsBrief(dayKey);
    brief.headline = "Options reflection (local fallback)";
    brief.story = `${brief.story} AI returned incomplete JSON — showing the local stats brief instead. Hit Refresh again in a moment.`;
    db.prepare(`INSERT OR REPLACE INTO accountability_briefs (day_key, payload_json, created_at) VALUES (?,?,?)`)
      .run(dayKey, JSON.stringify(brief), brief.updatedAt);
    return brief;
  }
  const parsed = scrubInsightText(parsedRaw, [
    "headline", "story", "patterns", "keep", "retire", "questions", "commitments",
  ]);
  const brief: OptionsProcessBrief = {
    offline: false,
    dayKey,
    headline: String(parsed.headline || "Options reflection"),
    story: String(parsed.story || ""),
    patterns: Array.isArray(parsed.patterns) ? parsed.patterns.map(String).slice(0, 6) : [],
    keep: Array.isArray(parsed.keep) ? parsed.keep.map(String).slice(0, 5) : [],
    retire: Array.isArray(parsed.retire) ? parsed.retire.map(String).slice(0, 5) : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, 5) : [],
    commitments: Array.isArray(parsed.commitments) ? parsed.commitments.map(String).slice(0, 4) : [],
    updatedAt: new Date().toISOString(),
    cached: false,
  };
  db.prepare(`INSERT OR REPLACE INTO accountability_briefs (day_key, payload_json, created_at) VALUES (?,?,?)`)
    .run(dayKey, JSON.stringify(brief), brief.updatedAt);
  return brief;
}

export type OptionsDeepDive = {
  offline?: boolean;
  dayKey: string;
  headline: string;
  verdict: string;
  whatWorked: string[];
  whatHurt: string[];
  doNext: string[];
  avoid: string[];
  mlRead: string;
  calendarRead: string;
  updatedAt: string;
  cached?: boolean;
  ml?: unknown;
};

function localOptionsDeepDive(dayKey: string, ml: unknown, ctx: ReturnType<typeof optionsBriefContext>): OptionsDeepDive {
  const clusters = (ml as { clusters?: Array<{ blurb: string }> })?.clusters || [];
  const cancel = (ml as { cancelModel?: { featureImportance?: Array<{ feature: string }>; testAccuracy?: number }; summary?: { overallCancelRate?: number } })?.cancelModel;
  const topFeat = cancel?.featureImportance?.[0]?.feature || "timing";
  const baseCancel = (ml as { summary?: { overallCancelRate?: number } })?.summary?.overallCancelRate;
  return {
    offline: true,
    dayKey,
    headline: "Options deep dive (local)",
    verdict: ctx.bullets.slice(0, 2).join(" "),
    whatWorked: [
      ctx.bestRoundTrips[0]
        ? `Best matched trip: ${ctx.bestRoundTrips[0].underlying} ${ctx.bestRoundTrips[0].pnl >= 0 ? "+" : ""}${ctx.bestRoundTrips[0].pnl}.`
        : "Preserve any journaled setups that were planned before the click.",
      ctx.roundTripCount ? `${ctx.roundTripCount} closes you can actually score — use those, not vibes.` : "Build cleaner open→close matching by labeling legs.",
    ],
    whatHurt: [
      ctx.worstRoundTrips[0]
        ? `Worst matched trip: ${ctx.worstRoundTrips[0].underlying} ${ctx.worstRoundTrips[0].pnl}.`
        : "Unmatched opens leave blind spots.",
      ctx.cancelRate != null ? `Cancel rate ~${ctx.cancelRate}% — second-guessing or size panic.` : "Cancel friction unknown.",
      `ML points at ${topFeat} as a cancel driver — process noise, not a signal to trade.`,
    ],
    doNext: [
      "Keep the Options tab closed for new tickets — review only.",
      "Journal the worst three round trips with one sentence each: thesis vs reality.",
      "If a day on the calendar is red and busy, note what time you clicked.",
    ],
    avoid: [
      "Opening a 'one last' options trade to 'make back' calendar red days.",
      "Treating ML clusters as entry recipes.",
      clusters[0] ? `Repeating the high-cancel cluster pattern: ${clusters[0].blurb}` : "0–2 DTE lottery tickets without a written plan.",
    ],
    mlRead: cancel
      ? `Cancel model test accuracy ${cancel.testAccuracy == null ? "—" : `${Math.round(cancel.testAccuracy * 100)}%`}. Top feature: ${topFeat}. Base cancel ${baseCancel != null ? `${Math.round(baseCancel * 100)}%` : "—"}.`
      : "ML unavailable — using tape stats only.",
    calendarRead: `Round-trip PnL across history: ${ctx.roundTripPnl >= 0 ? "+" : ""}${ctx.roundTripPnl}. Use the calendar to see which days stacked damage vs selective green.`,
    updatedAt: new Date().toISOString(),
    ml,
  };
}

/** ML stats → AI-rewritten deep dive: what to do / avoid (process only). */
export async function getOptionsDeepDive(opts: {
  force?: boolean;
  timeZone?: string;
  ml: unknown;
}): Promise<OptionsDeepDive> {
  const dayKey = `opt-dive:${dayKeyInZone(new Date(), opts.timeZone || DEFAULT_TIMEZONE)}`;
  const ctx = optionsBriefContext();

  if (!opts.force) {
    const cached = db.prepare(`SELECT payload_json FROM accountability_briefs WHERE day_key=?`).get(dayKey) as
      | { payload_json: string }
      | undefined;
    if (cached) {
      try {
        const parsed = JSON.parse(cached.payload_json) as OptionsDeepDive;
        return { ...parsed, cached: true, dayKey, ml: opts.ml };
      } catch {
        /* regenerate */
      }
    }
  }

  if (!client) {
    const dive = localOptionsDeepDive(dayKey, opts.ml, ctx);
    db.prepare(`INSERT OR REPLACE INTO accountability_briefs (day_key, payload_json, created_at) VALUES (?,?,?)`)
      .run(dayKey, JSON.stringify(dive), dive.updatedAt);
    return dive;
  }

  const clock = aiClockBlock(opts.timeZone || DEFAULT_TIMEZONE);
  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      {
        role: "system",
        content: `${DOCTRINE}
You rewrite raw options ML + tape stats into a clear deep-dive for a trader who is STOPPING options.
Be direct and practical about process: what to do next, what to avoid, what the numbers actually mean.
Never recommend buys, sells, structures, underlyings, size, or "one more trade."
Use NOW clock — doNext items should be sequenced from this moment (today / next session).
Return JSON only:
{"headline":"string","verdict":"string","whatWorked":["string"],"whatHurt":["string"],"doNext":["string"],"avoid":["string"],"mlRead":"string","calendarRead":"string"}.
verdict = 3-5 sentences, plain language.
mlRead = translate ML clusters / cancel model into human process language (no trading advice).
calendarRead = how to use the PnL calendar for reflection.
doNext = concrete process actions (journal, stop new options, leveraged ETF write-before-trade).`,
      },
      {
        role: "user",
        content: `${clock.preamble}\nOPTIONS TAPE\n${JSON.stringify(ctx)}\n\nPYTHON ML\n${JSON.stringify(opts.ml)}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1600,
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    const dive = localOptionsDeepDive(dayKey, opts.ml, ctx);
    db.prepare(`INSERT OR REPLACE INTO accountability_briefs (day_key, payload_json, created_at) VALUES (?,?,?)`)
      .run(dayKey, JSON.stringify(dive), dive.updatedAt);
    return dive;
  }
  const parsedRaw = parseModelJson(raw);
  if (!parsedRaw) {
    const dive = localOptionsDeepDive(dayKey, opts.ml, ctx);
    dive.headline = "Options deep dive (local fallback)";
    dive.verdict = `${dive.verdict} AI returned incomplete JSON — showing local ML summary. Refresh again shortly.`;
    db.prepare(`INSERT OR REPLACE INTO accountability_briefs (day_key, payload_json, created_at) VALUES (?,?,?)`)
      .run(dayKey, JSON.stringify(dive), dive.updatedAt);
    return dive;
  }
  const parsed = scrubInsightText(parsedRaw, [
    "headline", "verdict", "whatWorked", "whatHurt", "doNext", "avoid", "mlRead", "calendarRead",
  ]);
  const dive: OptionsDeepDive = {
    offline: false,
    dayKey,
    headline: String(parsed.headline || "Options deep dive"),
    verdict: String(parsed.verdict || ""),
    whatWorked: Array.isArray(parsed.whatWorked) ? parsed.whatWorked.map(String).slice(0, 6) : [],
    whatHurt: Array.isArray(parsed.whatHurt) ? parsed.whatHurt.map(String).slice(0, 6) : [],
    doNext: Array.isArray(parsed.doNext) ? parsed.doNext.map(String).slice(0, 6) : [],
    avoid: Array.isArray(parsed.avoid) ? parsed.avoid.map(String).slice(0, 6) : [],
    mlRead: String(parsed.mlRead || ""),
    calendarRead: String(parsed.calendarRead || ""),
    updatedAt: new Date().toISOString(),
    cached: false,
    ml: opts.ml,
  };
  db.prepare(`INSERT OR REPLACE INTO accountability_briefs (day_key, payload_json, created_at) VALUES (?,?,?)`)
    .run(dayKey, JSON.stringify(dive), dive.updatedAt);
  return dive;
}

export type PremarketSymbolBrief = {
  offline?: boolean;
  symbol: string;
  headline: string;
  trendMode: string;
  structureRead: string;
  levels: {
    daily?: { val: number | null; poc: number | null; vah: number | null; position?: string };
    weekly?: { val: number | null; poc: number | null; vah: number | null; position?: string };
    intraday?: { val: number | null; poc: number | null; vah: number | null; position?: string };
  };
  lookOutFor: string[];
  processNext: string[];
  namesToWatch: Array<{ symbol: string; why: string }>;
  creativeNote: string;
  rh?: {
    price?: number;
    bid?: number;
    ask?: number;
    previousClose?: number;
    state?: string;
    error?: string;
  } | null;
  math?: unknown;
  updatedAt: string;
};

function localPremarketBrief(input: {
  symbol: string;
  name?: string;
  quote: PremarketSymbolBrief["rh"];
  analysis: {
    last?: { close?: number | null; rsi?: number | null; sma20?: number | null; sma50?: number | null };
    states?: Record<string, string>;
    volumeProfile?: { val?: number | null; poc?: number | null; vah?: number | null };
    profiles?: Record<string, { val?: number | null; poc?: number | null; vah?: number | null; position?: string }>;
    ml?: { predictedChangePct?: number | null } | null;
  };
  plays: Array<{ name: string; status: string; tagline: string }>;
  related: Array<{ symbol: string; changePct?: number; name?: string }>;
}): PremarketSymbolBrief {
  const daily = input.analysis.profiles?.daily || input.analysis.volumeProfile;
  const weekly = input.analysis.profiles?.weekly;
  const intraday = input.analysis.profiles?.["15m"] || input.analysis.profiles?.["30m"];
  const vsSma = input.analysis.states?.vsSma20 || "neutral";
  const pos = (daily as { position?: string } | undefined)?.position || "unknown";
  const trendMode =
    pos === "above_vah" || (vsSma === "above" && pos !== "below_val")
      ? "Initiative / trend-lean (above value or SMA)"
      : pos === "below_val" || vsSma === "below"
        ? "Initiative / trend-lean (below value or SMA)"
        : "Balance / rotation inside value";

  return {
    offline: true,
    symbol: input.symbol,
    headline: `${input.symbol} · ${trendMode.split(" ")[0].toLowerCase()} read`,
    trendMode,
    structureRead: `Local math: RSI ${input.analysis.last?.rsi?.toFixed?.(1) ?? "—"}, vs SMA20 ${vsSma}. Daily profile position ${pos}. ${input.plays[0]?.tagline || "No hot VP play labeled."}`,
    levels: {
      daily: daily
        ? { val: daily.val ?? null, poc: daily.poc ?? null, vah: daily.vah ?? null, position: (daily as { position?: string }).position }
        : undefined,
      weekly: weekly
        ? { val: weekly.val ?? null, poc: weekly.poc ?? null, vah: weekly.vah ?? null, position: weekly.position }
        : undefined,
      intraday: intraday
        ? { val: intraday.val ?? null, poc: intraday.poc ?? null, vah: intraday.vah ?? null, position: intraday.position }
        : undefined,
    },
    lookOutFor: [
      "Whether price accepts outside VA (trend) or rotates back to POC (balance).",
      "Write thesis + invalidation before any leveraged-ETF click.",
      input.plays[0] ? `Named setup on tape: ${input.plays[0].name} (${input.plays[0].status}).` : "No live VP setup tag yet — wait for an edge test.",
    ],
    processNext: [
      "Open Decision/Journal and write the invalidation level first.",
      "Compare daily VAL/VAH to the RH last print before sizing intent.",
    ],
    namesToWatch: input.related.slice(0, 5).map((r) => ({
      symbol: r.symbol,
      why: `${r.name || r.symbol} on your premarket board (${r.changePct == null ? "—" : `${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}%`}) — journal attention, not an order.`,
    })),
    creativeNote: "Ask: is inventory unfinished at POC, or has the auction already migrated?",
    rh: input.quote,
    math: input.analysis,
    updatedAt: new Date().toISOString(),
  };
}

/** Premarket desk AI: trend vs balance, VP levels, what to watch — process only. */
export async function getPremarketSymbolBrief(opts: {
  symbol: string;
  name?: string;
  group?: string;
  changePct?: number | null;
  weekChangePct?: number | null;
  price?: number | null;
  force?: boolean;
  board?: {
    leaders?: Array<{ symbol: string; name?: string; changePct?: number }>;
    laggards?: Array<{ symbol: string; name?: string; changePct?: number }>;
    heatmap?: Array<{ symbol: string; name?: string; changePct?: number; group?: string }>;
    indices?: Array<{ symbol: string; display?: string; changePct?: number }>;
    earnings?: Array<Record<string, unknown>>;
  };
}): Promise<PremarketSymbolBrief> {
  const { getDayCache, setDayCache } = await import("./desk-cache");
  const symbol = opts.symbol.replace(/^\^/, "").toUpperCase();
  const cachePrefix = `premarket:${symbol}`;
  if (!opts.force) {
    const hit = getDayCache<PremarketSymbolBrief>(cachePrefix);
    if (hit?.value?.headline) return { ...hit.value, offline: hit.value.offline, updatedAt: hit.updatedAt };
  }

  const { fetchRobinhoodQuotes } = await import("./robinhood");
  const { fetchLiveBoard, optionsAnalyze } = await import("./python-service");
  const { deriveVpPlays } = await import("./vp-plays");
  const { getTraderPlan } = await import("./trader-plan");

  const rhSymbol = opts.symbol.startsWith("^") ? null : symbol;

  let rh: PremarketSymbolBrief["rh"] = null;
  if (rhSymbol) {
    try {
      const quotes = await fetchRobinhoodQuotes([rhSymbol]);
      const q = quotes[0];
      if (q) {
        rh = {
          price: q.price,
          bid: q.bid,
          ask: q.ask,
          previousClose: q.previousClose,
          state: q.state,
        };
      } else {
        rh = { error: "No Robinhood quote returned." };
      }
    } catch (err) {
      rh = { error: err instanceof Error ? err.message : "Robinhood quote failed." };
    }
  } else {
    rh = { error: "Index symbol — Robinhood equity quote skipped." };
  }

  let analysis: Record<string, unknown> = {};
  let profiles: Record<string, { val?: number | null; poc?: number | null; vah?: number | null; position?: string }> = {};
  let plays: Array<{ name: string; status: string; tagline: string; heat: number }> = [];

  try {
    const board = await fetchLiveBoard("15m", [opts.symbol.startsWith("^") ? opts.symbol : symbol], true);
    const tape = board.symbols?.[0];
    if (tape && !tape.error) {
      analysis = {
        last: tape.analysis?.last || null,
        states: tape.analysis?.states || null,
        ml: tape.analysis?.ml || null,
        volumeProfile: tape.analysis?.volumeProfile || null,
        profiles: tape.profiles || null,
      };
      profiles = (tape.profiles || {}) as typeof profiles;
      plays = deriveVpPlays(tape).map((p) => ({
        name: p.name,
        status: p.status,
        tagline: p.tagline,
        heat: p.heat,
      }));
    }
  } catch {
    /* fall through to daily analyze */
  }

  if (!analysis.last) {
    try {
      const daily = await optionsAnalyze(symbol, true);
      analysis = {
        last: daily.last,
        states: daily.states,
        ml: daily.ml,
        volumeProfile: daily.volumeProfile,
        profiles: {
          daily: {
            val: daily.volumeProfile?.val ?? null,
            poc: daily.volumeProfile?.poc ?? null,
            vah: daily.volumeProfile?.vah ?? null,
            position: "unknown",
          },
        },
      };
      profiles = analysis.profiles as typeof profiles;
    } catch {
      /* leave empty */
    }
  }

  const plan = getTraderPlan();
  const related = [
    ...(opts.board?.heatmap || []).filter((h) => h.group === opts.group && h.symbol !== symbol),
    ...(opts.board?.leaders || []),
    ...(opts.board?.laggards || []),
    ...plan.universe.map((s) => ({ symbol: s, name: s, changePct: undefined as number | undefined })),
  ]
    .filter((r, i, arr) => arr.findIndex((x) => x.symbol === r.symbol) === i && r.symbol !== symbol)
    .slice(0, 8);

  const earningsNear = (opts.board?.earnings || [])
    .filter((e) => String(e.Symbol || "").toUpperCase())
    .slice(0, 8)
    .map((e) => ({ symbol: String(e.Symbol), company: e.Company, when: e["Event Start Date"] }));

  const packed = {
    symbol,
    name: opts.name,
    group: opts.group,
    changePct: opts.changePct,
    weekChangePct: opts.weekChangePct,
    yahooPrice: opts.price,
    rh,
    analysis: {
      last: analysis.last,
      states: analysis.states,
      ml: analysis.ml
        ? {
            predictedChangePct: (analysis.ml as { predictedChangePct?: number | null }).predictedChangePct ?? null,
            testScore: (analysis.ml as { testScore?: number }).testScore,
          }
        : null,
    },
    profiles: Object.fromEntries(
      Object.entries(profiles).map(([k, v]) => [
        k,
        { val: v?.val ?? null, poc: v?.poc ?? null, vah: v?.vah ?? null, position: v?.position ?? null },
      ]),
    ),
    plays: plays.slice(0, 4),
    indices: opts.board?.indices?.slice(0, 5),
    related,
    earningsNear,
  };

  const local = localPremarketBrief({
    symbol,
    name: opts.name,
    quote: rh,
    analysis: {
      last: (analysis.last || undefined) as
        | { close?: number | null; rsi?: number | null; sma20?: number | null; sma50?: number | null }
        | undefined,
      states: (analysis.states || {}) as Record<string, string>,
      volumeProfile: analysis.volumeProfile as
        | { val?: number | null; poc?: number | null; vah?: number | null }
        | undefined,
      profiles,
      ml: analysis.ml as { predictedChangePct?: number | null } | null,
    },
    plays,
    related,
  });

  const clock = aiClockBlock();
  const persist = (brief: PremarketSymbolBrief) => {
    const updatedAt = setDayCache(cachePrefix, brief);
    return { ...brief, updatedAt };
  };
  if (!client) return persist({ ...local, math: packed });

  try {
    const response = await client.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      messages: [
        {
          role: "system",
          content: `${DOCTRINE}
You are the Premarket desk analyst for a trader who only journals leveraged-ETF trend/swing ideas and writes before every click.
Using ONLY the provided math (Yahoo + Robinhood quote + volume profile + VP plays + board leaders/laggards):
- Say whether the auction looks like TREND (initiative / accepted outside value) or BALANCE (rotation inside VA / POC magnet).
- Restate VAL / POC / VAH clearly per timeframe present.
- Tell them what to LOOK OUT FOR (observable events), what PROCESS to do next, and which NAMES ALREADY IN THE DATA deserve journal attention — never invent tickers, never say buy/sell/enter/exit/size.
Creative notes welcome (auction questions, unfinished business, inventory).
Return compact valid JSON only:
{"headline":"string","trendMode":"string","structureRead":"string","lookOutFor":["string"],"processNext":["string"],"namesToWatch":[{"symbol":"string","why":"string"}],"creativeNote":"string"}.`,
        },
        {
          role: "user",
          content: `${clock.preamble}\nPREMARKET_SYMBOL\n${JSON.stringify(packed)}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1400,
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) return persist({ ...local, math: packed });

    let parsedRaw: Record<string, unknown>;
    try {
      parsedRaw = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start < 0 || end <= start) return persist({ ...local, math: packed });
      parsedRaw = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    }

    const parsed = scrubInsightText(parsedRaw, [
      "headline", "trendMode", "structureRead", "lookOutFor", "processNext", "creativeNote",
    ]);
    const namesRaw = Array.isArray(parsed.namesToWatch) ? parsed.namesToWatch : [];
    const namesToWatch = namesRaw
      .map((n) => {
        if (!n || typeof n !== "object") return null;
        const row = n as { symbol?: string; why?: string };
        const sym = String(row.symbol || "").toUpperCase();
        if (!sym) return null;
        return { symbol: sym, why: scrubTradeAdvice(String(row.why || "")) };
      })
      .filter((n): n is { symbol: string; why: string } => Boolean(n))
      .slice(0, 6);

    return persist({
      offline: false,
      symbol,
      headline: String(parsed.headline || local.headline),
      trendMode: String(parsed.trendMode || local.trendMode),
      structureRead: String(parsed.structureRead || local.structureRead),
      levels: local.levels,
      lookOutFor: Array.isArray(parsed.lookOutFor) ? parsed.lookOutFor.map(String).slice(0, 6) : local.lookOutFor,
      processNext: Array.isArray(parsed.processNext) ? parsed.processNext.map(String).slice(0, 5) : local.processNext,
      namesToWatch: namesToWatch.length ? namesToWatch : local.namesToWatch,
      creativeNote: String(parsed.creativeNote || local.creativeNote),
      rh,
      math: packed,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return persist({ ...local, math: packed });
  }
}

