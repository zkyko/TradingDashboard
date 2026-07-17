import OpenAI from "openai";
import { db } from "./db";
import type { Challenge, MemoryMatch, PlanInput } from "./types";

const apiKey = process.env.DEEPSEEK_API_KEY;
const client = apiKey ? new OpenAI({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com" }) : null;

const COUNSELOR_DOCTRINE = `You are ZK's private trading accountability counselor and journal mentor.
Your job is process discipline, not prediction. You never recommend a ticker, direction, entry, exit, target, stop, leverage level, or position size. You never claim an edge or imply certainty.
You must:
- Separate decision quality from P&L and explicitly resist outcome bias.
- Compare the current reasoning with retrieved journal evidence only; never invent memories.
- Identify thesis drift, impulsive changes, rationalization, recency bias, confirmation bias, loss aversion, revenge trading, and inconsistent rule application when the evidence supports it.
- Treat leveraged ETFs as instruments requiring explicit invalidation, holding window, and accepted exposure, without prescribing numerical limits.
- Ask concrete questions answerable with observable evidence.
- Use neutral language: describe inconsistencies, do not shame.
- Say when the journal lacks enough evidence.
- Never invent a new percentage, threshold, cadence, holding rule, risk rule, or checklist requirement. You may quote rules already present in the retrieved journal, or ask the user to define one.
- Never use Robinhood account data to produce directional advice.
The user owns every decision. You are the friction that makes the reasoning explicit.`;

function tokens(text: string) {
  return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

function overlap(query: Set<string>, document: string) {
  const words = tokens(document);
  if (!query.size || !words.size) return 0;
  let shared = 0;
  for (const word of query) if (words.has(word)) shared++;
  return shared / Math.sqrt(query.size * words.size);
}

function textForPlan(plan: PlanInput) {
  return `${plan.decisionType} ${plan.direction} ${plan.ticker}. ${plan.thesis}\nContext: ${plan.marketContext}\nEvidence: ${plan.evidence}`;
}

// Retrieval is local and deterministic. DeepSeek receives selected journal excerpts
// plus compact quote/market context for ticker pages. Account cash, buying power,
// and full brokerage dumps are never sent. Position qty/avg and recent local order
// summaries may be included when present so process audits can reference reality.
export async function embedPlan(_plan: PlanInput): Promise<number[] | null> { return null; }

export function findMemories(plan: PlanInput, _embedding: number[] | null): MemoryMatch[] {
  const query = tokens(textForPlan(plan));
  const rows = db.prepare(`SELECT pv.id,tp.ticker,pv.decision_type,pv.thesis,pv.market_context,pv.evidence,pv.change_reason,pv.answers,p.id AS playbook_id
    FROM plan_versions pv JOIN trade_plans tp ON tp.id=pv.trade_plan_id JOIN playbooks p ON p.id=tp.playbook_id
    ORDER BY pv.created_at DESC LIMIT 250`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const document = [row.thesis,row.market_context,row.evidence,row.change_reason,row.answers].filter(Boolean).join(" ");
    const semantic = overlap(query, document);
    const playbook = Number(row.playbook_id) === plan.playbookId ? 0.25 : 0;
    const behavior = String(row.decision_type) === plan.decisionType ? 0.15 : 0;
    const ticker = String(row.ticker) === plan.ticker ? 0.05 : 0;
    return { id: Number(row.id), ticker: String(row.ticker), decisionType: String(row.decision_type), thesis: `${row.thesis}${row.change_reason ? ` Change reason: ${row.change_reason}` : ""}`, similarity: semantic * 0.55 + playbook + behavior + ticker };
  }).sort((a, b) => b.similarity - a.similarity).slice(0, 6);
}

function fallbackChallenge(memories: MemoryMatch[]): Challenge {
  return { summary: "DeepSeek counseling is offline until DEEPSEEK_API_KEY is configured. The local memory retrieval is still active.", contradictions: [], questions: ["What observable fact would prove this thesis wrong?", "Is this action part of the committed plan or a reaction to recent price movement?", "Which retrieved past decision is most similar, and what behavior should not be repeated?"], memoryIds: memories.map((memory) => memory.id), fallback: true };
}

export async function createChallenge(plan: PlanInput, memories: MemoryMatch[]): Promise<Challenge> {
  if (!client) return fallbackChallenge(memories);
  const memoryText = memories.map((memory) => `MEMORY #${memory.id} | ${memory.decisionType} ${memory.ticker}\n${memory.thesis}`).join("\n\n") || "NO RELEVANT JOURNAL MEMORY FOUND.";
  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      { role: "system", content: `${COUNSELOR_DOCTRINE}\nReturn JSON only in this exact shape: {"summary":"string","contradictions":["string"],"questions":["string","string","string"],"memoryIds":[1]}. Use only supplied memory IDs.` },
      { role: "user", content: `Review this proposed decision. Output JSON.\n\nPROPOSAL\n${textForPlan(plan)}\nLevels: VAL ${plan.val}; VAH ${plan.vah}; entry ${plan.entry}; invalidation ${plan.invalidation}; target ${plan.target}; quantity ${plan.quantity}; account equity ${plan.accountEquity}; hold until ${plan.holdUntil}.\n\nRETRIEVED JOURNAL\n${memoryText}` },
    ],
    response_format: { type: "json_object" }, max_tokens: 1200,
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) return fallbackChallenge(memories);
  const parsed = JSON.parse(raw) as Partial<Challenge>;
  const validIds = Array.isArray(parsed.memoryIds) ? parsed.memoryIds.filter((id) => memories.some((memory) => memory.id === id)) : [];
  return { summary: String(parsed.summary || "Review completed."), contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions.map(String).slice(0, 6) : [], questions: Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, 3) : fallbackChallenge(memories).questions, memoryIds: validIds };
}

export type JournalContext = { id: string; kind: string; date: string; text: string; score: number };

export function retrieveJournalContext(queryText: string, limit = 10): JournalContext[] {
  const query = tokens(queryText);
  const decisions = db.prepare(`SELECT pv.id,pv.created_at,tp.ticker,pv.decision_type,pv.thesis,pv.market_context,pv.evidence,pv.change_reason,pv.answers
    FROM plan_versions pv JOIN trade_plans tp ON tp.id=pv.trade_plan_id ORDER BY pv.created_at DESC LIMIT 500`).all() as Array<Record<string, unknown>>;
  const reviews = db.prepare("SELECT id,reviewed_at,notes,adhered FROM reviews ORDER BY reviewed_at DESC LIMIT 250").all() as Array<Record<string, unknown>>;
  const exceptions = db.prepare("SELECT id,created_at,summary,classification,explanation FROM reconciliation_exceptions ORDER BY created_at DESC LIMIT 250").all() as Array<Record<string, unknown>>;
  const watches = db.prepare("SELECT id,updated_at,symbol,setup,thesis,timeframe,trigger_price,invalidation,target,status FROM watchlist_items ORDER BY updated_at DESC LIMIT 250").all() as Array<Record<string, unknown>>;
  const journals = db.prepare("SELECT id,updated_at,title,body_text,ticker,source,sentiment FROM journal_entries ORDER BY updated_at DESC LIMIT 250").all() as Array<Record<string, unknown>>;
  const chunks: JournalContext[] = [
    ...decisions.map((row) => ({ id: `decision:${row.id}`, kind: "DECISION", date: String(row.created_at), text: `${row.ticker} ${row.decision_type}. Thesis: ${row.thesis}. Context: ${row.market_context}. Evidence: ${row.evidence}.${row.change_reason ? ` Change: ${row.change_reason}.` : ""} Answers: ${row.answers}`, score: 0 })),
    ...reviews.map((row) => ({ id: `review:${row.id}`, kind: "REVIEW", date: String(row.reviewed_at), text: `Adhered: ${Boolean(row.adhered)}. ${row.notes}`, score: 0 })),
    ...exceptions.map((row) => ({ id: `exception:${row.id}`, kind: "EXCEPTION", date: String(row.created_at), text: `${row.summary}. Classification: ${row.classification || "unclassified"}. Explanation: ${row.explanation || "none"}`, score: 0 })),
    ...watches.map((row) => ({ id: `watch:${row.id}`, kind: "WATCHLIST", date: String(row.updated_at), text: `${row.symbol} ${row.status} setup:${row.setup}. Thesis: ${row.thesis}. Timeframe: ${row.timeframe}. Trigger: ${row.trigger_price ?? "n/a"}; Invalidation: ${row.invalidation ?? "n/a"}; Target: ${row.target ?? "n/a"}.`, score: 0 })),
    ...journals.map((row) => ({ id: `journal:${row.id}`, kind: "JOURNAL", date: String(row.updated_at), text: `${row.ticker || ""} [${row.source}] ${row.title}. ${row.sentiment || ""} ${row.body_text}`, score: 0 })),
  ];
  return chunks.map((chunk) => ({ ...chunk, score: overlap(query, chunk.text) })).sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, limit);
}

export type WatchCounsel = {
  offline?: boolean;
  reflection: string;
  readiness: string;
  patterns: string[];
  questions: string[];
  gaps: string[];
  context: JournalContext[];
};

export async function counselWatchlistItem(itemId: number, question?: string): Promise<WatchCounsel> {
  const item = db.prepare("SELECT * FROM watchlist_items WHERE id=?").get(itemId) as Record<string, unknown> | undefined;
  if (!item) throw new Error("Watchlist item not found.");
  const shots = db.prepare("SELECT id,original_name,caption,created_at FROM attachments WHERE watchlist_item_id=? ORDER BY created_at").all(itemId) as Array<Record<string, unknown>>;
  const prompt = [
    question?.trim() || "Audit this watchlist setup for process completeness and consistency with my journal.",
    `Symbol ${item.symbol}. Status ${item.status}. Setup ${item.setup}. Timeframe ${item.timeframe}.`,
    `Thesis: ${item.thesis}`,
    `Levels: trigger ${item.trigger_price ?? "unset"}, invalidation ${item.invalidation ?? "unset"}, target ${item.target ?? "unset"}.`,
    `Last price ${item.last_price ?? "n/a"}, previous close ${item.previous_close ?? "n/a"}.`,
  ].join("\n");
  const context = retrieveJournalContext(`${item.symbol} ${item.setup} ${item.thesis} ${question || ""}`, 10);
  const shotText = shots.length
    ? shots.map((shot) => `SHOT ${shot.id} | ${shot.original_name} | ${shot.caption || "no caption"} | ${shot.created_at}`).join("\n")
    : "No chart screenshots attached yet.";

  if (!client) {
    const offline: WatchCounsel = {
      offline: true,
      reflection: "DeepSeek is not configured. Add DEEPSEEK_API_KEY to .env.local. Local retrieval still ranked related journal excerpts for this symbol.",
      readiness: shots.length && item.invalidation != null && item.trigger_price != null ? "PROCESS PARTIAL — AI offline" : "INCOMPLETE — missing levels or chart evidence",
      patterns: [],
      questions: ["What observable condition turns this watch into a documented decision?", "Which past decision on this symbol or setup should constrain you now?", "What would force you to archive this idea without acting?"],
      gaps: [
        item.invalidation == null ? "Invalidation is unset." : "",
        item.trigger_price == null ? "Trigger is unset." : "",
        !shots.length ? "No chart screenshots attached." : "",
      ].filter(Boolean),
      context,
    };
    db.prepare("UPDATE watchlist_items SET counsel_json=?, counsel_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(offline), itemId);
    return offline;
  }

  const excerpts = context.map((entry) => `${entry.id} | ${entry.kind} | ${entry.date}\n${entry.text}`).join("\n\n");
  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      {
        role: "system",
        content: `${COUNSELOR_DOCTRINE}
You are reviewing a watchlist candidate before any order. Screenshots are represented by filenames and captions only—you cannot see pixels; treat captions as the user's claimed evidence and challenge vague captions.
Return JSON only: {"reflection":"string","readiness":"string","patterns":["string"],"questions":["string"],"gaps":["string"]}.
readiness must be a short process label such as "NOT READY", "NEEDS EVIDENCE", "READY TO DOCUMENT", or "ARCHIVE CANDIDATE"—never a buy/sell recommendation.`,
      },
      {
        role: "user",
        content: `Audit this watchlist item. Output JSON.\n\nUSER FOCUS\n${prompt}\n\nATTACHED CHART EVIDENCE (captions only)\n${shotText}\n\nRETRIEVED JOURNAL EXCERPTS\n${excerpts || "No journal evidence."}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1600,
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("DeepSeek returned an empty watchlist counsel response.");
  const parsed = JSON.parse(raw) as Partial<WatchCounsel>;
  const counsel: WatchCounsel = {
    reflection: String(parsed.reflection || "Review completed."),
    readiness: String(parsed.readiness || "NEEDS REVIEW"),
    patterns: Array.isArray(parsed.patterns) ? parsed.patterns.map(String).slice(0, 6) : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, 5) : [],
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map(String).slice(0, 6) : [],
    context,
  };
  db.prepare("UPDATE watchlist_items SET counsel_json=?, counsel_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(counsel), itemId);
  return counsel;
}

export async function counselJournal(question: string) {
  const context = retrieveJournalContext(question);
  if (!client) return { offline: true, reflection: "DeepSeek is not configured. Add DEEPSEEK_API_KEY to .env.local.", patterns: [], questions: ["What specific decision or repeated behavior do you want to audit?"], commitments: [], context };
  const excerpts = context.map((item) => `${item.id} | ${item.kind} | ${item.date}\n${item.text}`).join("\n\n");
  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      { role: "system", content: `${COUNSELOR_DOCTRINE}\nReturn JSON only: {"reflection":"string","patterns":["string"],"questions":["string"],"commitments":["string"]}. Commitments must be user-authored process checks, never trade instructions.` },
      { role: "user", content: `Respond as an accountability counselor. Output JSON.\n\nUSER QUESTION\n${question}\n\nRETRIEVED JOURNAL EXCERPTS\n${excerpts || "No journal evidence."}` },
    ], response_format: { type: "json_object" }, max_tokens: 1600,
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("DeepSeek returned an empty counseling response.");
  return { ...JSON.parse(raw) as Record<string, unknown>, context };
}

export type MarketInsight = {
  offline?: boolean;
  headline: string;
  marketRead: string;
  processAngles: string[];
  questions: string[];
  whatChanged: string[];
};

export async function interpretTickerPage(snapshot: {
  symbol: string;
  quote: Record<string, unknown>;
  changePct: number | null;
  market: Record<string, unknown> | null;
  local: {
    position?: { quantity?: number; averagePrice?: number } | null;
    openPlan?: Record<string, unknown> | null;
    orders?: Array<Record<string, unknown>>;
  };
}) {
  const context = retrieveJournalContext(`${snapshot.symbol} ${String(snapshot.local.openPlan?.thesis || "")}`, 8);
  const compactMarket = snapshot.market ? {
    trend: snapshot.market.trend,
    technicals: snapshot.market.technicals,
    fundamentals: snapshot.market.fundamentals,
    bars: Array.isArray((snapshot.market as { historicals?: unknown[] }).historicals)
      ? (snapshot.market as { historicals: unknown[] }).historicals.slice(-12)
      : [],
  } : null;

  const localContext = {
    position: snapshot.local.position
      ? { quantity: snapshot.local.position.quantity, averagePrice: snapshot.local.position.averagePrice ?? null }
      : null,
    openPlan: snapshot.local.openPlan
      ? {
        ticker: snapshot.local.openPlan.ticker,
        direction: snapshot.local.openPlan.direction,
        thesis: snapshot.local.openPlan.thesis,
      }
      : null,
    recentOrderCount: snapshot.local.orders?.length ?? 0,
    recentOrderSides: (snapshot.local.orders || []).slice(0, 5).map((order) => ({
      ticker: order.ticker,
      side: order.side,
      state: order.state,
    })),
  };

  if (!client) {
    return {
      offline: true,
      headline: `${snapshot.symbol} page captured`,
      marketRead: "DeepSeek is offline. Local quote/history are still on the journal page for your own reading.",
      processAngles: context.slice(0, 3).map((item) => item.text.slice(0, 160)),
      questions: ["What observable condition would make this watch actionable?", "Does your journal already constrain this symbol?"],
      whatChanged: [],
      context,
    } satisfies MarketInsight & { context: typeof context };
  }

  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      {
        role: "system",
        content: `${COUNSELOR_DOCTRINE}
You are writing a short page in a trader's process journal.
Explain what the market data suggests in plain language, then connect it to process—not prediction.
Never recommend buys/sells/entries/exits/size/leverage.
Return JSON only: {"headline":"string","marketRead":"string","processAngles":["string"],"questions":["string"],"whatChanged":["string"]}.`,
      },
      {
        role: "user",
        content: `Write a journal page insight for ${snapshot.symbol}.

QUOTE
${JSON.stringify(snapshot.quote)}
CHANGE_PCT ${snapshot.changePct}

MARKET CONTEXT
${JSON.stringify(compactMarket)}

LOCAL ACCOUNT/JOURNAL CONTEXT
${JSON.stringify(localContext)}

RETRIEVED JOURNAL
${context.map((item) => `${item.id}: ${item.text}`).join("\n") || "None"}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1400,
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("DeepSeek returned an empty market insight.");
  const parsed = JSON.parse(raw) as Partial<MarketInsight>;
  return {
    headline: String(parsed.headline || `${snapshot.symbol} observation`),
    marketRead: String(parsed.marketRead || ""),
    processAngles: Array.isArray(parsed.processAngles) ? parsed.processAngles.map(String).slice(0, 5) : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, 5) : [],
    whatChanged: Array.isArray(parsed.whatChanged) ? parsed.whatChanged.map(String).slice(0, 5) : [],
    context,
  };
}

/** Short live-board blurb — descriptive only, no trade advice. */
export async function interpretLiveTape(tape: {
  symbol: string;
  changePct: number | null;
  price: number | null;
  last?: {
    rsi?: number | null;
    sma20?: number | null;
    sma50?: number | null;
    volRatio?: number | null;
  } | null;
  states?: Record<string, string> | null;
  ml?: {
    predictedClose?: number;
    predictedChangePct?: number | null;
    testScore?: number;
  } | null;
  interval?: string;
  profiles?: Record<string, unknown> | null;
  plays?: Array<{ name: string; status: string; tagline: string; heat: number }> | null;
}) {
  const fallback = {
    offline: !client,
    headline: `${tape.symbol} · live tape`,
    marketRead: client
      ? ""
      : "DeepSeek offline. RSI/state chips below are still from Python math.",
    at: new Date().toISOString(),
  };

  if (!client) return fallback;

  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [
      {
        role: "system",
        content: `${COUNSELOR_DOCTRINE}
Write a 1-sentence headline and 2-sentence marketRead for a live monitoring tile.
Frame volume-profile context as observable auction state and journalable setup names (VAL spring, VAH test, POC magnet, profile migration).
Never recommend buys/sells/entries/exits/size or say what the user should trade.
Return JSON only: {"headline":"string","marketRead":"string"}.`,
      },
      {
        role: "user",
        content: `Live tape ${tape.symbol} (${tape.interval || "intraday"}).
price=${tape.price} changePct=${tape.changePct}
last=${JSON.stringify(tape.last || {})}
states=${JSON.stringify(tape.states || {})}
ml=${JSON.stringify(tape.ml || null)}
profiles=${JSON.stringify(tape.profiles || null)}
plays=${JSON.stringify(tape.plays || null)}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 320,
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) return fallback;
  const parsed = JSON.parse(raw) as { headline?: string; marketRead?: string };
  return {
    offline: false,
    headline: String(parsed.headline || `${tape.symbol} · live`),
    marketRead: String(parsed.marketRead || ""),
    at: new Date().toISOString(),
  };
}
