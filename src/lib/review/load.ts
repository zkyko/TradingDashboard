import fs from "node:fs";
import path from "node:path";
import type {
  BehaviorFile,
  CalendarIndexFile,
  DayReviewFile,
  DaysIndexFile,
  EquityFile,
  FillsFile,
  JournalEntryMeta,
  TradesFile,
  WeekReviewFile,
  WeeksIndexFile,
} from "./types";

const ROOT = process.cwd();

export function dataDir() {
  return path.join(ROOT, "data");
}

export function weeksDir() {
  return path.join(dataDir(), "weeks");
}

export function daysDir() {
  return path.join(dataDir(), "days");
}

export function journalDir() {
  return path.join(ROOT, "journal");
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function loadEquity(): EquityFile {
  return readJson(path.join(dataDir(), "equity.json"), {
    updatedAt: "",
    latest: null,
    series: [],
  });
}

export function loadFills(): FillsFile {
  return readJson(path.join(dataDir(), "fills.json"), { updatedAt: "", fills: [] });
}

export function loadTrades(): TradesFile {
  return readJson(path.join(dataDir(), "trades.json"), {
    updatedAt: "",
    openLots: 0,
    trades: [],
  });
}

export function loadBehavior(): BehaviorFile {
  return readJson(path.join(dataDir(), "behavior.json"), {
    updatedAt: "",
    timeZone: "America/Chicago",
    currentStreak: { type: "flat", length: 0 },
    maxWinStreak: 0,
    maxLossStreak: 0,
    overnightPnl: 0,
    holdBuckets: {
      overnight: { n: 0, pnl: 0 },
      under15m: { n: 0, pnl: 0 },
      m15to60: { n: 0, pnl: 0 },
      over60m: { n: 0, pnl: 0 },
    },
    sizeEscalationFlags: 0,
    tilt: { state: "calm", score: 0, reasons: ["No data yet"] },
    recentTrades: [],
  });
}

export function loadWeeksIndex(): WeeksIndexFile {
  return readJson(path.join(dataDir(), "weeks-index.json"), { updatedAt: "", weeks: [] });
}

export function loadDaysIndex(): DaysIndexFile {
  return readJson(path.join(dataDir(), "days-index.json"), { updatedAt: "", days: [] });
}

export function loadCalendarIndex(): CalendarIndexFile {
  return readJson(path.join(dataDir(), "calendar-index.json"), {
    updatedAt: "",
    timeZone: "America/Chicago",
    months: [],
  });
}

export function loadSizing(): import("./types").SizingFile {
  return readJson(path.join(dataDir(), "sizing.json"), {
    updatedAt: "",
    equity: 0,
    assumptions: {
      accountNote: "",
      targetPts: 10,
      riskBudgetPct: 0.0075,
      typicalShares: 10,
    },
    soxl28d: {
      trades: 0,
      winRate: 0,
      expectancy: 0,
      avgWin: 0,
      avgLoss: 0,
      under15: { n: 0, pnl: 0 },
      over15: { n: 0, pnl: 0 },
      overnight: { n: 0, pnl: 0 },
    },
    gates: [],
    gatesPassed: 0,
    stance: "hold_size",
    headline: "Run sync to generate sizing plan.",
    guidance: [],
    suggested: {
      holdShares: 10,
      consistencyCapShares: 5,
      nextSharesIfReady: 10,
      sizeUpReady: false,
    },
  });
}

export function loadMetricsForward(): import("./types").MetricsForwardFile {
  return readJson(path.join(dataDir(), "metrics-forward.json"), {
    updatedAt: "",
    fromWeek: "2026-W29",
    note: "",
    cumulative: {
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
      flatCount: 0,
      winRate: null,
      winPct: null,
      profitFactor: null,
      rewardRisk: null,
      expectancy: null,
      avgWin: null,
      avgLoss: null,
      grossWin: 0,
      grossLoss: 0,
      realizedPnl: 0,
      bestTrade: null,
      worstTrade: null,
      avgHoldMinutes: null,
    },
    weeks: [],
  });
}

export function loadWeek(id: string): WeekReviewFile | null {
  const file = path.join(weeksDir(), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as WeekReviewFile;
}

export function loadDay(date: string): DayReviewFile | null {
  const file = path.join(daysDir(), `${date}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as DayReviewFile;
}

export function loadLatestWeek(): WeekReviewFile | null {
  const index = loadWeeksIndex();
  if (!index.weeks.length) {
    if (!fs.existsSync(weeksDir())) return null;
    const files = fs.readdirSync(weeksDir()).filter((f) => f.endsWith(".json")).sort();
    if (!files.length) return null;
    return loadWeek(files[files.length - 1].replace(/\.json$/, ""));
  }
  return loadWeek(index.weeks[0].id);
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: raw };
  const block = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s+/, "");
  const meta: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body };
}

function parseList(value?: string): string[] {
  if (!value) return [];
  if (value.startsWith("[")) {
    try {
      return JSON.parse(value.replace(/'/g, '"')) as string[];
    } catch {
      return value.replace(/[\[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function listJournalEntries(): JournalEntryMeta[] {
  const dir = journalDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const { meta } = parseFrontmatter(raw);
      const slug = file.replace(/\.md$/, "");
      return {
        slug,
        path: `journal/${file}`,
        title: meta.title || slug,
        date: meta.date || slug.slice(0, 10),
        tags: parseList(meta.tags),
        mood: meta.mood,
        tickers: parseList(meta.tickers),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function loadJournalEntry(slug: string): { meta: JournalEntryMeta; body: string } | null {
  const file = path.join(journalDir(), `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  return {
    meta: {
      slug,
      path: `journal/${slug}.md`,
      title: meta.title || slug,
      date: meta.date || slug.slice(0, 10),
      tags: parseList(meta.tags),
      mood: meta.mood,
      tickers: parseList(meta.tickers),
    },
    body,
  };
}

/** Minimal markdown → safe HTML (headings, lists, paragraphs, bold/italic, code). */
export function renderMarkdown(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;
  const flushList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  const inline = (s: string) =>
    escape(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");

  for (const line of lines) {
    if (/^### /.test(line)) {
      flushList();
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
    } else if (/^## /.test(line)) {
      flushList();
      out.push(`<h2>${inline(line.slice(3))}</h2>`);
    } else if (/^# /.test(line)) {
      flushList();
      out.push(`<h1>${inline(line.slice(2))}</h1>`);
    } else if (/^[-*] /.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (!line.trim()) {
      flushList();
    } else {
      flushList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  flushList();
  return out.join("\n");
}
