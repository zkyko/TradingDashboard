#!/usr/bin/env node
/**
 * Refresh static review JSON from local SQLite (+ optional live Robinhood via /api/sync).
 *
 *   npm run sync:agent
 *   npm run sync:agent -- --live
 *
 * Preserves keep/stop/improve/lesson/mistakes/openNotes on existing week files.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const weeksDir = path.join(dataDir, "weeks");
const daysDir = path.join(dataDir, "days");
const dbPath = path.join(dataDir, "thesis-loop.db");
const LIVE = process.argv.includes("--live");
const TZ = "America/Chicago";

function ensureDirs() {
  fs.mkdirSync(weeksDir, { recursive: true });
  fs.mkdirSync(daysDir, { recursive: true });
  fs.mkdirSync(path.join(root, "journal"), { recursive: true });
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function dayKeyInZone(iso, timeZone = TZ) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}

function startOfWeekMonday(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const dow = utc.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  utc.setUTCDate(utc.getUTCDate() + offset);
  return utc.toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

function isoWeekId(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function weekLabel(start, endInclusive) {
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${endInclusive}T12:00:00Z`);
  const opts = { month: "short", day: "numeric" };
  return `${a.toLocaleDateString("en-US", opts)} – ${b.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

function buildClosedTrades(fills) {
  const books = new Map();
  const trades = [];
  for (const fill of fills) {
    const ticker = fill.ticker.toUpperCase();
    const side = fill.side.toUpperCase();
    const qty = Number(fill.quantity);
    const price = Number(fill.price);
    if (!qty || !price) continue;
    const lots = books.get(ticker) ?? [];
    books.set(ticker, lots);

    const pushTrade = (matched, entryPrice, exitPrice, openedAt, closedAt, tradeSide, pnl) => {
      const holdMinutes = Math.max(0, (new Date(closedAt) - new Date(openedAt)) / 60000);
      trades.push({
        ticker,
        qty: matched,
        entryPrice,
        exitPrice,
        pnl,
        pnlPct: entryPrice ? (pnl / (entryPrice * matched)) * 100 : 0,
        openedAt,
        closedAt,
        side: tradeSide,
        holdMinutes,
        overnight: openedAt.slice(0, 10) !== closedAt.slice(0, 10),
      });
    };

    if (side === "BUY") {
      let remaining = qty;
      while (remaining > 0 && lots.length && lots[0].side === "SHORT") {
        const lot = lots[0];
        const matched = Math.min(remaining, lot.qty);
        pushTrade(matched, lot.price, price, lot.openedAt, fill.executedAt, "SHORT", (lot.price - price) * matched);
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 1e-9) lots.shift();
      }
      if (remaining > 1e-9) lots.push({ qty: remaining, price, openedAt: fill.executedAt, side: "LONG" });
    } else {
      let remaining = qty;
      while (remaining > 0 && lots.length && lots[0].side === "LONG") {
        const lot = lots[0];
        const matched = Math.min(remaining, lot.qty);
        pushTrade(matched, lot.price, price, lot.openedAt, fill.executedAt, "LONG", (price - lot.price) * matched);
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 1e-9) lots.shift();
      }
      if (remaining > 1e-9) lots.push({ qty: remaining, price, openedAt: fill.executedAt, side: "SHORT" });
    }
  }
  let openLots = 0;
  for (const lots of books.values()) openLots += lots.length;
  return { trades, openLots };
}

function streakStats(trades) {
  let curType = "flat";
  let curLen = 0;
  let maxWin = 0;
  let maxLoss = 0;
  let winRun = 0;
  let lossRun = 0;
  for (const trade of trades) {
    if (trade.pnl > 0) {
      winRun += 1;
      lossRun = 0;
      maxWin = Math.max(maxWin, winRun);
      curType = "win";
      curLen = winRun;
    } else if (trade.pnl < 0) {
      lossRun += 1;
      winRun = 0;
      maxLoss = Math.max(maxLoss, lossRun);
      curType = "loss";
      curLen = lossRun;
    }
  }
  return { currentStreak: { type: curType, length: curLen }, maxWinStreak: maxWin, maxLossStreak: maxLoss };
}

function countSizeEscalations(fills) {
  const byDay = new Map();
  for (const f of fills) {
    const day = dayKeyInZone(f.executedAt);
    const list = byDay.get(day) ?? [];
    list.push(f);
    byDay.set(day, list);
  }
  let flags = 0;
  for (const list of byDay.values()) {
    let lastSellLoss = false;
    let lastBuyNotional = 0;
    const buys = [];
    for (const f of list) {
      if (f.side === "BUY") {
        const notional = f.quantity * f.price;
        if (lastSellLoss && lastBuyNotional > 0 && notional > lastBuyNotional * 1.15) flags += 1;
        lastBuyNotional = notional;
        buys.push(f.price);
        lastSellLoss = false;
      } else {
        const ref = buys.length ? buys[buys.length - 1] : f.price;
        lastSellLoss = f.price < ref;
      }
    }
  }
  return flags;
}

function computeBehavior(trades, fills) {
  const recent = trades.slice(-40);
  const streaks = streakStats(trades);
  const holdBuckets = {
    overnight: { n: 0, pnl: 0 },
    under15m: { n: 0, pnl: 0 },
    m15to60: { n: 0, pnl: 0 },
    over60m: { n: 0, pnl: 0 },
  };
  for (const t of recent) {
    if (t.overnight) {
      holdBuckets.overnight.n += 1;
      holdBuckets.overnight.pnl += t.pnl;
    } else if (t.holdMinutes <= 15) {
      holdBuckets.under15m.n += 1;
      holdBuckets.under15m.pnl += t.pnl;
    } else if (t.holdMinutes <= 60) {
      holdBuckets.m15to60.n += 1;
      holdBuckets.m15to60.pnl += t.pnl;
    } else {
      holdBuckets.over60m.n += 1;
      holdBuckets.over60m.pnl += t.pnl;
    }
  }
  const overnightPnl = holdBuckets.overnight.pnl;
  const sizeEscalationFlags = countSizeEscalations(fills.slice(-200));
  const reasons = [];
  let score = 0;
  let state = "calm";
  if (streaks.currentStreak.type === "win" && streaks.currentStreak.length >= 3) {
    state = "on_streak";
    score = Math.min(40, streaks.currentStreak.length * 8);
    reasons.push(`Win streak ×${streaks.currentStreak.length}`);
  }
  if (streaks.currentStreak.type === "loss" && streaks.currentStreak.length >= 3) {
    state = "cooling_off";
    score = Math.min(70, 30 + streaks.currentStreak.length * 10);
    reasons.push(`Loss streak ×${streaks.currentStreak.length}`);
  }
  if (holdBuckets.under15m.n >= 3 && holdBuckets.under15m.pnl < 0) {
    state = "chopping";
    score = Math.max(score, 55);
    reasons.push(`Sub-15m scalps losing ($${holdBuckets.under15m.pnl.toFixed(0)})`);
  }
  if (sizeEscalationFlags >= 2) {
    state = "revenge_sizing";
    score = Math.max(score, 75);
    reasons.push(`Size escalation after losses (${sizeEscalationFlags} flags)`);
  }
  if (overnightPnl < -50) {
    state = "overnight_hungover";
    score = Math.max(score, 80);
    reasons.push(`Overnight PnL $${overnightPnl.toFixed(0)}`);
  }
  if (!reasons.length) reasons.push("No active tilt flags in recent tape");
  return {
    updatedAt: new Date().toISOString(),
    timeZone: TZ,
    currentStreak: streaks.currentStreak,
    maxWinStreak: streaks.maxWinStreak,
    maxLossStreak: streaks.maxLossStreak,
    overnightPnl,
    holdBuckets,
    sizeEscalationFlags,
    tilt: { state, score, reasons },
    recentTrades: [...trades].reverse().slice(0, 12),
  };
}

function tradesInWeek(trades, start, endExclusive) {
  return trades.filter((t) => {
    const day = dayKeyInZone(t.closedAt);
    return day >= start && day < endExclusive;
  });
}

function reviewTrade(t, context) {
  const { priorLosses = 0, dayTradeIndex = 0, dayBuyNotionals = [] } = context;
  const flags = [];
  const hold = t.holdMinutes;
  let holdBucket = "session";
  if (t.overnight) holdBucket = "overnight";
  else if (hold <= 15) holdBucket = "sub_15m";
  else if (hold <= 60) holdBucket = "m15_60";
  else holdBucket = "over_60m";

  const movePts = Math.abs(t.exitPrice - t.entryPrice);
  const notional = t.qty * t.entryPrice;
  const rMultiple = t.entryPrice ? t.pnl / Math.max(1, notional * 0.01) : 0; // vs 1% of notional as crude R

  if (t.overnight) flags.push("overnight");
  if (holdBucket === "sub_15m" && t.pnl < 0) flags.push("losing_scratch");
  if (holdBucket === "sub_15m" && t.pnl > 0) flags.push("fast_win");
  if (holdBucket === "over_60m" || (holdBucket === "m15_60" && t.pnl > 0)) flags.push("gave_room");
  if (priorLosses >= 2) flags.push("after_loss_streak");
  if (dayTradeIndex >= 4) flags.push("high_frequency_day");
  if (dayBuyNotionals.length >= 2) {
    const prev = dayBuyNotionals[dayBuyNotionals.length - 2];
    if (prev > 0 && notional > prev * 1.15 && priorLosses >= 1) flags.push("size_up_after_loss");
  }

  // Process grade: outcome-agnostic where possible
  let grade = "B";
  let verdict = "Neutral process.";
  if (flags.includes("size_up_after_loss") || (flags.includes("overnight") && Math.abs(t.pnl) > 50 && t.pnl < 0)) {
    grade = "C";
    verdict = "Process break: risk expanded when discipline usually fails.";
  } else if (flags.includes("losing_scratch") && flags.includes("after_loss_streak")) {
    grade = "C";
    verdict = "Chop after losses — consistency cost, not information.";
  } else if (flags.includes("gave_room") && !flags.includes("overnight")) {
    grade = "A";
    verdict = "Held past noise. Matches your positive-EV hold window.";
  } else if (flags.includes("fast_win") && hold <= 8) {
    grade = "B";
    verdict = "Quick win — fine occasionally; sample of sub-15m is still weak overall.";
  } else if (t.overnight && t.pnl > 0) {
    grade = "B";
    verdict = "Overnight worked this time. Do not update rules from one outcome.";
  } else if (t.overnight) {
    grade = "C";
    verdict = "Overnight risk — binary path; not a consistency skill.";
  } else if (holdBucket === "m15_60") {
    grade = t.pnl >= 0 ? "A" : "B";
    verdict = t.pnl >= 0
      ? "In your best bucket (15–60m)."
      : "Valid hold window; loss is cost of doing business if stop was planned.";
  }

  const bullets = [];
  bullets.push(`${holdBucket.replace("_", " ")} · ${hold.toFixed(0)}m · ${movePts.toFixed(2)} pts`);
  if (flags.length) bullets.push(`Flags: ${flags.join(", ")}`);
  bullets.push(verdict);

  return {
    ticker: t.ticker,
    qty: t.qty,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    pnl: t.pnl,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    holdMinutes: t.holdMinutes,
    overnight: t.overnight,
    holdBucket,
    grade,
    flags,
    movePts,
    notional,
    review: bullets.join(" · "),
    whatWorked: grade === "A" ? verdict : flags.includes("gave_room") ? "Held through noise." : "",
    whatFailed: grade === "C" ? verdict : flags.includes("losing_scratch") ? "Scratch/chop — no edge proven." : "",
    nextTime:
      flags.includes("size_up_after_loss")
        ? "Same size after a loser. Size is earned by streaks of rule-following, not by P&L chase."
        : flags.includes("overnight")
          ? "If overnight is allowed, cap notional ≤15% equity and write invalidation before entry."
          : holdBucket === "sub_15m"
            ? "Default to ≥15m hold or stand down — your sub-15m sample is negative EV."
            : "Repeat only if entry/invalidation were written first.",
  };
}

function buildDayReview(trades, existing, dateKey) {
  const dayTrades = trades.filter((t) => dayKeyInZone(t.closedAt) === dateKey);
  const byTickerMap = new Map();
  for (const t of dayTrades) {
    const row = byTickerMap.get(t.ticker) ?? { ticker: t.ticker, pnl: 0, trades: 0, wins: 0 };
    row.pnl += t.pnl;
    row.trades += 1;
    if (t.pnl > 0) row.wins += 1;
    byTickerMap.set(t.ticker, row);
  }
  const dayBehavior = computeBehavior(dayTrades, []);
  const dow = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let lossStreak = 0;
  const dayBuyNotionals = [];
  const tradeReviews = dayTrades.map((t, i) => {
    const priorLosses = lossStreak;
    dayBuyNotionals.push(t.qty * t.entryPrice);
    const reviewed = reviewTrade(t, { priorLosses, dayTradeIndex: i, dayBuyNotionals: [...dayBuyNotionals] });
    if (t.pnl < 0) lossStreak += 1;
    else if (t.pnl > 0) lossStreak = 0;
    // Preserve manual overrides on matching trade if present
    const prev = existing?.tradeReviews?.find(
      (r) => r.ticker === t.ticker && r.closedAt === t.closedAt && Math.abs(r.qty - t.qty) < 1e-6,
    );
    if (prev?.notes) reviewed.notes = prev.notes;
    if (prev?.nextTimeManual) reviewed.nextTime = prev.nextTimeManual;
    return reviewed;
  });

  const grades = { A: 0, B: 0, C: 0 };
  for (const r of tradeReviews) grades[r.grade] = (grades[r.grade] || 0) + 1;

  return {
    id: dateKey,
    date: dateKey,
    label: new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    weekday: WEEKDAYS[dow],
    weekId: isoWeekId(dateKey),
    timeZone: TZ,
    updatedAt: new Date().toISOString(),
    realizedPnl: dayTrades.reduce((s, t) => s + t.pnl, 0),
    tradeCount: dayTrades.length,
    winCount: dayTrades.filter((t) => t.pnl > 0).length,
    lossCount: dayTrades.filter((t) => t.pnl < 0).length,
    processGrades: grades,
    metrics: computeTradeMetrics(dayTrades),
    byTicker: [...byTickerMap.values()].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)),
    trades: dayTrades.map((t) => ({
      ticker: t.ticker,
      qty: t.qty,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      pnl: t.pnl,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
      holdMinutes: t.holdMinutes,
      overnight: t.overnight,
    })),
    tradeReviews,
    tilt: dayBehavior.tilt,
    streaks: {
      current: dayBehavior.currentStreak,
      maxWin: dayBehavior.maxWinStreak,
      maxLoss: dayBehavior.maxLossStreak,
    },
    keep: existing?.keep ?? [],
    stop: existing?.stop ?? [],
    improve: existing?.improve ?? [],
    lesson: existing?.lesson ?? "",
    notes: existing?.notes ?? "",
  };
}

function buildSizingPlan(trades, equity) {
  const soxl = trades.filter((t) => t.ticker === "SOXL");
  const since = new Date(Date.now() - 28 * 86400000).toISOString();
  const last28 = soxl.filter((t) => t.closedAt >= since);
  const sample = last28.length ? last28 : soxl.slice(-40);
  const wins = sample.filter((t) => t.pnl > 0);
  const losses = sample.filter((t) => t.pnl < 0);
  const under15 = sample.filter((t) => !t.overnight && t.holdMinutes <= 15);
  const over15 = sample.filter((t) => !t.overnight && t.holdMinutes > 15);
  const overnight = sample.filter((t) => t.overnight);
  const avgQty = sample.length ? sample.reduce((s, t) => s + t.qty, 0) / sample.length : 10;
  const winRate = sample.length ? wins.length / sample.length : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
  const expectancy = sample.length ? sample.reduce((s, t) => s + t.pnl, 0) / sample.length : 0;
  const under15Pnl = under15.reduce((s, t) => s + t.pnl, 0);
  const over15Pnl = over15.reduce((s, t) => s + t.pnl, 0);
  const overnightPnl = overnight.reduce((s, t) => s + t.pnl, 0);

  const eq = equity || 2000;
  // Assume "trying $10 on SOXL" = ~$10/share stop/target. Consistency risk ≤1% equity.
  const targetPts = 10;
  const riskBudgetPct = 0.01;
  const riskBudget = eq * riskBudgetPct;
  const consistencyShares = Math.max(1, Math.floor(riskBudget / targetPts));
  const currentTypicalShares = Math.max(1, Math.round(avgQty || 1));
  const alreadyAboveCap = currentTypicalShares > consistencyShares;

  const gates = [
    {
      id: "hold_edge",
      label: "Hold-window edge",
      pass: over15Pnl > 0 && over15.length >= 10 && under15Pnl <= 0,
      detail: `>15m PnL $${over15Pnl.toFixed(0)} (n=${over15.length}) vs ≤15m $${under15Pnl.toFixed(0)} (n=${under15.length})`,
    },
    {
      id: "expectancy",
      label: "Positive expectancy (28d SOXL)",
      pass: expectancy > 0 && sample.length >= 15,
      detail: `Expectancy $${expectancy.toFixed(2)}/trade on ${sample.length} closes · WR ${(winRate * 100).toFixed(0)}%`,
    },
    {
      id: "loss_asymmetry",
      label: "Avg win ≥ 1.2× avg loss",
      pass: avgLoss > 0 && avgWin >= 1.2 * avgLoss,
      detail: `Avg win $${avgWin.toFixed(0)} · avg loss $${avgLoss.toFixed(0)}`,
    },
    {
      id: "no_overnight_leak",
      label: "Overnight not leaking",
      pass: overnightPnl >= -0.02 * eq,
      detail: `Overnight PnL $${overnightPnl.toFixed(0)} (hard cap while building)`,
    },
    {
      id: "size_discipline",
      label: "Size ≤ consistency cap",
      pass: !alreadyAboveCap,
      detail: `Typical ${currentTypicalShares} sh vs cap ${consistencyShares} sh (1% equity ÷ $${targetPts} stop)`,
    },
    {
      id: "process_weeks",
      label: "2 clean process weeks",
      pass: false,
      detail: "Manual: written rules followed, no revenge size, no junk overnight — not auto-passed from P&L",
    },
  ];

  const autoGates = gates.filter((g) => g.id !== "process_weeks");
  const autoPassed = autoGates.filter((g) => g.pass).length;
  const passed = gates.filter((g) => g.pass).length;
  // Never recommend sizing up while over the consistency cap or process weeks unmet.
  const readyToSizeUp =
    !alreadyAboveCap
    && autoPassed === autoGates.length
    && gates.find((g) => g.id === "process_weeks")?.pass === true;

  let stance = "hold_size";
  let headline = "Hold size. Consistency before growth.";
  const body = [];

  if (alreadyAboveCap) {
    stance = "size_down_or_hold";
    headline = `Do not size up — typical ${currentTypicalShares} sh is already above the ${consistencyShares} sh consistency cap.`;
    body.push(
      `For ~$${eq.toFixed(0)} equity and a ~$${targetPts}/share SOXL stop, 1% risk ⇒ ~${consistencyShares} shares. You are averaging ~${currentTypicalShares}.`,
    );
    body.push(
      `Growth path: trade A-setups at ≤${consistencyShares}–${Math.max(consistencyShares, Math.min(currentTypicalShares, consistencyShares + 2))} sh until process weeks clear, then +1–2 shares.`,
    );
  } else if (readyToSizeUp) {
    stance = "size_up_small";
    headline = "Gates clear — add +1–2 shares on A-setups only.";
    body.push(`Next size: ${currentTypicalShares + 2} shares max. One C-grade revenge day → back to ${consistencyShares}.`);
  } else {
    body.push(
      `Stay at ≤${consistencyShares} shares while gates are open. Passed ${passed}/${gates.length}.`,
    );
  }

  body.push(
    `>15m SOXL is the engine ($${over15Pnl.toFixed(0)}); ≤15m is a drag ($${under15Pnl.toFixed(0)}). Only size the first.`,
  );
  body.push(
    `Unbiased rule: size follows measured edge + rule adherence, never a green day or a $10 target fantasy.`,
  );

  return {
    updatedAt: new Date().toISOString(),
    equity: eq,
    assumptions: {
      accountNote: "User: ~$2k risk book, trying ~$10 moves on SOXL",
      targetPts,
      riskBudgetPct,
      typicalShares: currentTypicalShares,
    },
    soxl28d: {
      trades: sample.length,
      winRate,
      expectancy,
      avgWin,
      avgLoss,
      under15: { n: under15.length, pnl: under15Pnl },
      over15: { n: over15.length, pnl: over15Pnl },
      overnight: { n: overnight.length, pnl: overnightPnl },
    },
    gates,
    gatesPassed: passed,
    stance,
    headline,
    guidance: body,
    suggested: {
      holdShares: alreadyAboveCap ? consistencyShares : currentTypicalShares,
      consistencyCapShares: consistencyShares,
      nextSharesIfReady: consistencyShares + 2,
      sizeUpReady: readyToSizeUp,
    },
  };
}

function computeTradeMetrics(trades) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const flats = trades.filter((t) => t.pnl === 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const realizedPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length ? grossWin / wins.length : null;
  const avgLoss = losses.length ? grossLoss / losses.length : null;
  const winRate = trades.length ? wins.length / trades.length : null;
  const profitFactor =
    grossLoss > 0 ? grossWin / grossLoss : wins.length ? Number.POSITIVE_INFINITY : null;
  const rewardRisk =
    avgWin != null && avgLoss != null && avgLoss > 0 ? avgWin / avgLoss : null;
  const expectancy = trades.length ? realizedPnl / trades.length : null;
  const avgHold = trades.length
    ? trades.reduce((s, t) => s + (t.holdMinutes || 0), 0) / trades.length
    : null;
  const bestTrade = trades.length ? Math.max(...trades.map((t) => t.pnl)) : null;
  const worstTrade = trades.length ? Math.min(...trades.map((t) => t.pnl)) : null;

  // Running equity of closed trades (for sparkline)
  let run = 0;
  const equityCurve = trades
    .slice()
    .sort((a, b) => String(a.closedAt).localeCompare(String(b.closedAt)))
    .map((t) => {
      run += t.pnl;
      return { t: t.closedAt, pnl: run };
    });

  return {
    tradeCount: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    flatCount: flats.length,
    winRate,
    winPct: winRate == null ? null : winRate * 100,
    profitFactor: profitFactor == null ? null : profitFactor === Infinity ? null : profitFactor,
    profitFactorInfinite: profitFactor === Infinity,
    rewardRisk,
    expectancy,
    avgWin,
    avgLoss: avgLoss == null ? null : -avgLoss,
    avgLossAbs: avgLoss,
    grossWin,
    grossLoss: -grossLoss,
    realizedPnl,
    bestTrade,
    worstTrade,
    avgHoldMinutes: avgHold,
    equityCurve,
  };
}

function buildWeekReview(trades, existing, anchorDate) {
  const start = startOfWeekMonday(anchorDate);
  const endExclusive = addDays(start, 7);
  const endInclusive = addDays(start, 4);
  const id = isoWeekId(start);
  const weekTrades = tradesInWeek(trades, start, endExclusive);
  const priorTrades = tradesInWeek(trades, addDays(start, -7), start);
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayMap = new Map();
  for (let i = 0; i < 5; i++) {
    const date = addDays(start, i);
    dayMap.set(date, {
      date,
      label: WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()],
      pnl: 0,
      trades: 0,
    });
  }
  for (const t of weekTrades) {
    const date = dayKeyInZone(t.closedAt);
    const row = dayMap.get(date);
    if (!row) continue;
    row.pnl += t.pnl;
    row.trades += 1;
  }
  const tickerMap = new Map();
  for (const t of weekTrades) {
    const row = tickerMap.get(t.ticker) ?? { ticker: t.ticker, pnl: 0, trades: 0, wins: 0 };
    row.pnl += t.pnl;
    row.trades += 1;
    if (t.pnl > 0) row.wins += 1;
    tickerMap.set(t.ticker, row);
  }
  const weekBehavior = computeBehavior(weekTrades, []);
  const metrics = computeTradeMetrics(weekTrades);
  const soxlMetrics = computeTradeMetrics(weekTrades.filter((t) => t.ticker === "SOXL"));
  return {
    id,
    label: weekLabel(start, endInclusive),
    start,
    end: endExclusive,
    timeZone: TZ,
    updatedAt: new Date().toISOString(),
    realizedPnl: metrics.realizedPnl,
    tradeCount: metrics.tradeCount,
    winCount: metrics.winCount,
    lossCount: metrics.lossCount,
    priorWeekPnl: priorTrades.length ? priorTrades.reduce((s, t) => s + t.pnl, 0) : null,
    metrics,
    soxlMetrics,
    days: [...dayMap.values()],
    byTicker: [...tickerMap.values()].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)),
    tilt: weekBehavior.tilt,
    streaks: {
      current: weekBehavior.currentStreak,
      maxWin: weekBehavior.maxWinStreak,
      maxLoss: weekBehavior.maxLossStreak,
    },
    keep: existing?.keep ?? [],
    stop: existing?.stop ?? [],
    improve: existing?.improve ?? [],
    lesson: existing?.lesson ?? "",
    mistakes: existing?.mistakes ?? [],
    openNotes: existing?.openNotes ?? [],
  };
}

async function maybeLiveSync() {
  if (!LIVE) return;
  let token = process.env.SYNC_SECRET;
  if (!token) {
    try {
      const env = fs.readFileSync(path.join(root, ".env.local"), "utf8");
      const m = env.match(/^SYNC_SECRET=(.*)$/m);
      if (m) token = m[1].trim().replace(/^["']|["']$/g, "");
    } catch { /* ignore */ }
  }
  if (!token) {
    console.warn("--live: SYNC_SECRET missing; skipping.");
    return;
  }
  try {
    const res = await fetch("http://localhost:3000/api/sync", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text}`);
    console.log("Live sync ok");
  } catch (err) {
    console.warn("Live sync failed; using SQLite only.", err.message || err);
  }
}

function loadFillsFromDb(Database) {
  if (!fs.existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT external_id AS id, ticker, side, quantity, price, executed_at AS executedAt
    FROM executions
    WHERE quantity > 0 AND price > 0
    ORDER BY datetime(executed_at) ASC, id ASC
  `).all();
  db.close();
  return rows.map((r) => ({
    id: String(r.id),
    ticker: String(r.ticker).toUpperCase(),
    side: String(r.side).toUpperCase() === "SELL" ? "SELL" : "BUY",
    quantity: Number(r.quantity),
    price: Number(r.price),
    executedAt: String(r.executedAt),
  }));
}

function loadEquityFromDb(Database) {
  if (!fs.existsSync(dbPath)) return { updatedAt: new Date().toISOString(), latest: null, series: [] };
  const db = new Database(dbPath, { readonly: true });
  const series = db.prepare(`
    SELECT captured_at AS t, account_equity AS equity
    FROM position_snapshots
    ORDER BY captured_at ASC
  `).all().map((r) => ({ t: String(r.t), equity: Number(r.equity) }));
  db.close();
  return {
    updatedAt: new Date().toISOString(),
    latest: series.length ? series[series.length - 1] : null,
    series,
  };
}

async function main() {
  ensureDirs();
  await maybeLiveSync();

  if (!fs.existsSync(dbPath)) {
    if (fs.existsSync(path.join(dataDir, "fills.json"))) {
      console.log("No SQLite db; keeping existing data/*.json");
      return;
    }
    console.warn("No SQLite db and no fills.json — writing empty stubs.");
    writeJson(path.join(dataDir, "fills.json"), { updatedAt: new Date().toISOString(), fills: [] });
    writeJson(path.join(dataDir, "equity.json"), { updatedAt: new Date().toISOString(), latest: null, series: [] });
    writeJson(path.join(dataDir, "trades.json"), { updatedAt: new Date().toISOString(), openLots: 0, trades: [] });
    writeJson(path.join(dataDir, "weeks-index.json"), { updatedAt: new Date().toISOString(), weeks: [] });
    return;
  }

  const Database = require("better-sqlite3");
  const fills = loadFillsFromDb(Database);
  const equity = loadEquityFromDb(Database);
  const { trades, openLots } = buildClosedTrades(fills);
  const behavior = computeBehavior(trades, fills);

  writeJson(path.join(dataDir, "fills.json"), { updatedAt: new Date().toISOString(), fills });
  writeJson(path.join(dataDir, "equity.json"), equity);
  writeJson(path.join(dataDir, "trades.json"), { updatedAt: new Date().toISOString(), openLots, trades });
  writeJson(path.join(dataDir, "behavior.json"), behavior);
  writeJson(
    path.join(dataDir, "sizing.json"),
    buildSizingPlan(trades, equity.latest?.equity ?? null),
  );

  const today = dayKeyInZone(new Date().toISOString());

  // ---- Daily reviews (every day that has closes, forever) ----
  const dayKeys = new Set(trades.map((t) => dayKeyInZone(t.closedAt)));
  // Always refresh today even if flat
  dayKeys.add(today);
  // Keep any previously saved day notes even if no trades
  if (fs.existsSync(daysDir)) {
    for (const f of fs.readdirSync(daysDir)) {
      if (f.endsWith(".json")) dayKeys.add(f.replace(/\.json$/, ""));
    }
  }

  const daySummaries = [];
  for (const dateKey of [...dayKeys].sort()) {
    const existingPath = path.join(daysDir, `${dateKey}.json`);
    const existing = readJson(existingPath);
    const day = buildDayReview(trades, existing, dateKey);
    if (day.tradeCount === 0 && !existing && dateKey !== today) continue;
    writeJson(existingPath, day);
    daySummaries.push({
      date: day.date,
      weekday: day.weekday,
      weekId: day.weekId,
      realizedPnl: day.realizedPnl,
      tradeCount: day.tradeCount,
      lesson: day.lesson || "",
      hasNotes: Boolean(day.lesson || day.notes || day.keep?.length || day.stop?.length || day.improve?.length),
    });
  }

  // ---- Weekly reviews (every ISO week that has activity or saved notes) ----
  const weekStarts = new Set();
  for (const d of daySummaries) weekStarts.add(startOfWeekMonday(d.date));
  weekStarts.add(startOfWeekMonday(today));
  if (fs.existsSync(weeksDir)) {
    for (const f of fs.readdirSync(weeksDir)) {
      if (!f.endsWith(".json")) continue;
      const existing = readJson(path.join(weeksDir, f));
      if (existing?.start) weekStarts.add(existing.start);
    }
  }

  const weekSummaries = [];
  const weekFiles = [];
  for (const start of [...weekStarts].sort().reverse()) {
    const id = isoWeekId(start);
    const existingPath = path.join(weeksDir, `${id}.json`);
    const existing = readJson(existingPath);
    const week = buildWeekReview(trades, existing, start);
    if (week.tradeCount === 0 && !existing && start !== startOfWeekMonday(today)) continue;
    writeJson(existingPath, week);
    weekFiles.push(week);
    weekSummaries.push({
      id: week.id,
      label: week.label,
      start: week.start,
      end: week.end,
      realizedPnl: week.realizedPnl,
      tradeCount: week.tradeCount,
      winRate: week.metrics?.winRate ?? null,
      winPct: week.metrics?.winPct ?? null,
      profitFactor: week.metrics?.profitFactor ?? null,
      rewardRisk: week.metrics?.rewardRisk ?? null,
      expectancy: week.metrics?.expectancy ?? null,
      lesson: week.lesson || "",
      hasNotes: Boolean(week.lesson || week.keep?.length || week.stop?.length || week.improve?.length),
    });
  }

  // Forward metrics series from this review week onward (W29 = baseline)
  const FORWARD_FROM = "2026-W29";
  const forwardWeeks = weekFiles
    .filter((w) => w.id >= FORWARD_FROM)
    .sort((a, b) => a.id.localeCompare(b.id));
  const forwardTrades = [];
  for (const w of forwardWeeks) {
    forwardTrades.push(
      ...tradesInWeek(trades, w.start, w.end),
    );
  }
  let cum = 0;
  const forwardSeries = forwardWeeks.map((w) => {
    cum += w.realizedPnl;
    return {
      id: w.id,
      label: w.label,
      start: w.start,
      realizedPnl: w.realizedPnl,
      cumulativePnl: cum,
      tradeCount: w.metrics.tradeCount,
      winPct: w.metrics.winPct,
      profitFactor: w.metrics.profitFactor,
      rewardRisk: w.metrics.rewardRisk,
      expectancy: w.metrics.expectancy,
      avgWin: w.metrics.avgWin,
      avgLoss: w.metrics.avgLoss,
    };
  });
  writeJson(path.join(dataDir, "metrics-forward.json"), {
    updatedAt: new Date().toISOString(),
    fromWeek: FORWARD_FROM,
    note: "Tracked from this review week forward for consistency/growth.",
    cumulative: computeTradeMetrics(forwardTrades),
    weeks: forwardSeries,
  });

  // ---- Calendar index by month (for UI) ----
  const monthsMap = new Map();
  for (const d of daySummaries) {
    const month = d.date.slice(0, 7);
    const row = monthsMap.get(month) ?? { month, days: [], realizedPnl: 0, tradeCount: 0 };
    row.days.push(d);
    row.realizedPnl += d.realizedPnl;
    row.tradeCount += d.tradeCount;
    monthsMap.set(month, row);
  }
  const months = [...monthsMap.values()]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((m) => ({
      ...m,
      days: m.days.sort((a, b) => a.date.localeCompare(b.date)),
    }));

  writeJson(path.join(dataDir, "days-index.json"), {
    updatedAt: new Date().toISOString(),
    days: [...daySummaries].sort((a, b) => b.date.localeCompare(a.date)),
  });
  writeJson(path.join(dataDir, "weeks-index.json"), {
    updatedAt: new Date().toISOString(),
    weeks: weekSummaries,
  });
  writeJson(path.join(dataDir, "calendar-index.json"), {
    updatedAt: new Date().toISOString(),
    timeZone: TZ,
    months,
  });

  console.log(JSON.stringify({
    fills: fills.length,
    trades: trades.length,
    equityPoints: equity.series.length,
    latestEquity: equity.latest,
    days: daySummaries.length,
    weeks: weekSummaries.length,
    months: months.length,
    tilt: behavior.tilt.state,
    currentWeek: weekSummaries[0]?.id,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
