import { db } from "@/lib/db";
import { dayKeyInZone, DEFAULT_TIMEZONE } from "@/lib/timezone";

/** Options reflection window — null means full stored history. */
export const OPTIONS_SINCE: string | null = null;

export type OptionOrderRow = {
  external_id: string;
  account_mask: string | null;
  underlying: string;
  direction: string;
  state: string;
  strategy: string | null;
  quantity: number;
  filled_quantity: number;
  premium: number | null;
  processed_premium: number | null;
  created_at: string;
  last_transaction_at: string | null;
  raw_json: string;
};

export type OptionUnderlyingBar = {
  underlying: string;
  orders: number;
  filled: number;
  canceled: number;
  netCashflow: number;
  debits: number;
  credits: number;
};

export type OptionMonthRow = {
  key: string;
  label: string;
  orders: number;
  filled: number;
  canceled: number;
  netCashflow: number;
  debits: number;
  credits: number;
  topUnderlying: string | null;
};

export type OptionStrategyBar = {
  strategy: string;
  count: number;
  netCashflow: number;
};

export type OptionDayBar = {
  date: string;
  orders: number;
  filled: number;
  canceled: number;
  netCashflow: number;
};

export type OptionHourBar = { hour: number; orders: number; filled: number; canceled: number; netCashflow: number };
export type OptionDowBar = { dow: number; label: string; orders: number; filled: number; canceled: number; netCashflow: number };

export type OptionDteBucket = {
  bucket: string;
  orders: number;
  filled: number;
  netCashflow: number;
};

export type OptionRoundTrip = {
  underlying: string;
  contract: string;
  openedAt: string;
  closedAt: string;
  holdHours: number;
  openPremium: number;
  closePremium: number;
  pnl: number;
  strategy: string | null;
};

export type OptionsReflection = {
  since: string;
  earliest: string | null;
  latest: string | null;
  orderCount: number;
  filledCount: number;
  canceledCount: number;
  netCashflow: number;
  debitSpend: number;
  creditReceive: number;
  uniqueUnderlyings: number;
  cancelRate: number | null;
  byUnderlying: OptionUnderlyingBar[];
  byMonth: OptionMonthRow[];
  byStrategy: OptionStrategyBar[];
  dailyBars: OptionDayBar[];
  cashflowCurve: Array<{ t: string; pnl: number }>;
  byHour: OptionHourBar[];
  byDow: OptionDowBar[];
  byDte: OptionDteBucket[];
  roundTrips: OptionRoundTrip[];
  roundTripPnl: number;
  roundTripCount: number;
  avgHoldHours: number | null;
  bullets: string[];
  orders: Array<Omit<OptionOrderRow, "raw_json"> & {
    legSummary: string;
    cashflow: number | null;
    effect: string | null;
    dte: number | null;
    optionType: string | null;
    strike: number | null;
    expiration: string | null;
  }>;
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function isFilledState(state: string) {
  const s = state.toLowerCase();
  return s === "filled" || s === "partially_filled" || s.includes("filled");
}

function isCanceledState(state: string) {
  const s = state.toLowerCase();
  return s.includes("cancel") || s === "rejected" || s === "failed";
}

/** Premium cashflow: credits in, debits out. Order-level — not closed-trade PnL. */
export function optionCashflow(direction: string, premium: number | null | undefined, state: string): number | null {
  if (premium == null || !Number.isFinite(premium)) return null;
  if (!isFilledState(state)) return null;
  const dir = direction.toLowerCase();
  if (dir === "credit") return Math.abs(premium);
  if (dir === "debit") return -Math.abs(premium);
  return null;
}

function dteBucket(dte: number | null): string {
  if (dte == null || !Number.isFinite(dte)) return "unknown";
  if (dte <= 0) return "0d / expired";
  if (dte <= 2) return "0–2d";
  if (dte <= 7) return "3–7d";
  if (dte <= 21) return "8–21d";
  if (dte <= 45) return "22–45d";
  return "45d+";
}

type LegInfo = {
  summary: string;
  effect: string | null;
  dte: number | null;
  optionType: string | null;
  strike: number | null;
  expiration: string | null;
  contractKey: string | null;
};

function legInfoFromRaw(rawJson: string, createdAt: string): LegInfo {
  try {
    const raw = JSON.parse(rawJson) as Record<string, unknown>;
    const legs = Array.isArray(raw.legs) ? (raw.legs as Array<Record<string, unknown>>) : [];
    if (!legs.length) {
      return { summary: "—", effect: null, dte: null, optionType: null, strike: null, expiration: null, contractKey: null };
    }
    const effects = new Set(legs.map((leg) => String(leg.position_effect || "").toLowerCase()).filter(Boolean));
    const effect = effects.size === 1 ? [...effects][0] : effects.size > 1 ? "mixed" : null;
    const first = legs[0];
    const optionType = first.option_type || first.type ? String(first.option_type || first.type).toLowerCase() : null;
    const strike = first.strike_price != null || first.strike != null ? Number(first.strike_price ?? first.strike) : null;
    const expiration = first.expiration_date || first.expiry ? String(first.expiration_date || first.expiry).slice(0, 10) : null;
    let dte: number | null = null;
    if (expiration) {
      const expMs = Date.parse(`${expiration}T21:00:00Z`);
      const createdMs = Date.parse(createdAt);
      if (Number.isFinite(expMs) && Number.isFinite(createdMs)) {
        dte = Math.round((expMs - createdMs) / 86400000);
      }
    }
    const chain = String(raw.chain_symbol || raw.symbol || "").toUpperCase();
    const contractKey = expiration && strike != null && optionType
      ? `${chain}|${expiration}|${strike}|${optionType}`
      : null;
    const parts = legs.map((leg) => {
      const side = String(leg.side || "?").toUpperCase();
      const pe = String(leg.position_effect || "").toLowerCase();
      const type = String(leg.option_type || leg.type || "").toLowerCase();
      const st = leg.strike_price ?? leg.strike;
      const exp = leg.expiration_date || leg.expiry;
      const bits = [side, pe].filter(Boolean);
      if (type) bits.push(type);
      if (st != null) bits.push(String(Number(st)));
      if (exp) bits.push(String(exp).slice(0, 10));
      return bits.join(" ");
    });
    return {
      summary: parts.join(" · ") || `${legs.length} leg(s)`,
      effect,
      dte,
      optionType,
      strike,
      expiration,
      contractKey,
    };
  } catch {
    return { summary: "—", effect: null, dte: null, optionType: null, strike: null, expiration: null, contractKey: null };
  }
}

function matchRoundTrips(
  filledAsc: Array<{
    underlying: string;
    created_at: string;
    cashflow: number;
    effect: string | null;
    contractKey: string | null;
    strategy: string | null;
    expiration: string | null;
    strike: number | null;
    optionType: string | null;
  }>,
): OptionRoundTrip[] {
  type OpenLot = { openedAt: string; premium: number; strategy: string | null };
  const stacks = new Map<string, OpenLot[]>();
  const trips: OptionRoundTrip[] = [];

  for (const row of filledAsc) {
    if (!row.contractKey || row.cashflow == null) continue;
    const stack = stacks.get(row.contractKey) ?? [];
    if (row.effect === "open") {
      stack.push({ openedAt: row.created_at, premium: Math.abs(row.cashflow), strategy: row.strategy });
      stacks.set(row.contractKey, stack);
      continue;
    }
    if (row.effect === "close" && stack.length) {
      const open = stack.shift()!;
      const closePremium = Math.abs(row.cashflow);
      // Long: open debit + close credit → pnl = close - open
      // Short: open credit + close debit → pnl = open - close
      // Using signed cashflows already: open CF + close CF
      const openSigned = -open.premium; // approximate: opens were mostly debits for this book
      // Better: use actual signed values stored on open via stack — store signed
      const pnl = row.cashflow + (open.premium * (row.cashflow > 0 ? -1 : 1));
      // Prefer: store signed cashflow on open
      void openSigned;
      const holdHours = Math.max(0, (Date.parse(row.created_at) - Date.parse(open.openedAt)) / 3600000);
      const contract = [
        row.underlying,
        row.expiration,
        row.strike != null ? String(row.strike) : null,
        row.optionType,
      ].filter(Boolean).join(" ");
      trips.push({
        underlying: row.underlying,
        contract,
        openedAt: open.openedAt,
        closedAt: row.created_at,
        holdHours,
        openPremium: open.premium,
        closePremium,
        pnl: row.cashflow - open.premium, // close credit - open debit (typical long)
        strategy: open.strategy || row.strategy,
      });
      stacks.set(row.contractKey, stack);
    }
  }

  // Fix PnL properly with signed open premiums
  return trips;
}

/** Re-match with signed open cashflow for accurate round-trip PnL. */
function matchRoundTripsSigned(
  filledAsc: Array<{
    underlying: string;
    created_at: string;
    cashflow: number;
    effect: string | null;
    contractKey: string | null;
    strategy: string | null;
    expiration: string | null;
    strike: number | null;
    optionType: string | null;
  }>,
): OptionRoundTrip[] {
  type OpenLot = { openedAt: string; signedCf: number; strategy: string | null };
  const stacks = new Map<string, OpenLot[]>();
  const trips: OptionRoundTrip[] = [];

  for (const row of filledAsc) {
    if (!row.contractKey) continue;
    const stack = stacks.get(row.contractKey) ?? [];
    if (row.effect === "open") {
      stack.push({ openedAt: row.created_at, signedCf: row.cashflow, strategy: row.strategy });
      stacks.set(row.contractKey, stack);
      continue;
    }
    if (row.effect === "close" && stack.length) {
      const open = stack.shift()!;
      const holdHours = Math.max(0, (Date.parse(row.created_at) - Date.parse(open.openedAt)) / 3600000);
      const contract = [
        row.underlying,
        row.expiration,
        row.strike != null ? String(row.strike) : null,
        row.optionType,
      ].filter(Boolean).join(" ");
      trips.push({
        underlying: row.underlying,
        contract,
        openedAt: open.openedAt,
        closedAt: row.created_at,
        holdHours,
        openPremium: Math.abs(open.signedCf),
        closePremium: Math.abs(row.cashflow),
        pnl: open.signedCf + row.cashflow,
        strategy: open.strategy || row.strategy,
      });
      stacks.set(row.contractKey, stack);
    }
  }
  return trips.sort((a, b) => b.closedAt.localeCompare(a.closedAt));
}

export function loadOptionsReflection(timeZone = DEFAULT_TIMEZONE): OptionsReflection {
  const rows = db
    .prepare(
      `SELECT external_id, account_mask, underlying, direction, state, strategy, quantity, filled_quantity,
              premium, processed_premium, created_at, last_transaction_at, raw_json
       FROM broker_option_orders
       ORDER BY datetime(created_at) DESC
       LIMIT 5000`,
    )
    .all() as OptionOrderRow[];

  const earliest = rows.length
    ? rows.reduce((min, r) => (r.created_at < min ? r.created_at : min), rows[0].created_at)
    : null;
  const latest = rows.length
    ? rows.reduce((max, r) => (r.created_at > max ? r.created_at : max), rows[0].created_at)
    : null;
  const sinceLabel = earliest ? earliest.slice(0, 10) : "—";

  const underMap = new Map<string, OptionUnderlyingBar>();
  const monthMap = new Map<string, {
    key: string;
    orders: number;
    filled: number;
    canceled: number;
    netCashflow: number;
    debits: number;
    credits: number;
    tickers: Map<string, number>;
  }>();
  const stratMap = new Map<string, OptionStrategyBar>();
  const dayMap = new Map<string, OptionDayBar>();
  const hourMap = new Map<number, OptionHourBar>();
  const dowMap = new Map<number, OptionDowBar>();
  const dteMap = new Map<string, OptionDteBucket>();

  for (let h = 0; h < 24; h++) hourMap.set(h, { hour: h, orders: 0, filled: 0, canceled: 0, netCashflow: 0 });
  for (let d = 0; d < 7; d++) dowMap.set(d, { dow: d, label: DOW_LABELS[d], orders: 0, filled: 0, canceled: 0, netCashflow: 0 });

  let netCashflow = 0;
  let debitSpend = 0;
  let creditReceive = 0;
  let filledCount = 0;
  let canceledCount = 0;

  const filledForMatch: Array<{
    underlying: string;
    created_at: string;
    cashflow: number;
    effect: string | null;
    contractKey: string | null;
    strategy: string | null;
    expiration: string | null;
    strike: number | null;
    optionType: string | null;
  }> = [];

  const orders = rows.map((row) => {
    const premium = row.processed_premium ?? row.premium;
    const cashflow = optionCashflow(row.direction, premium, row.state);
    const info = legInfoFromRaw(row.raw_json, row.created_at);
    const filled = isFilledState(row.state) && Number(row.filled_quantity || 0) > 0;
    const canceled = isCanceledState(row.state);
    if (filled) filledCount += 1;
    if (canceled) canceledCount += 1;

    if (cashflow != null) {
      netCashflow += cashflow;
      if (cashflow < 0) debitSpend += Math.abs(cashflow);
      if (cashflow > 0) creditReceive += cashflow;
    }

    if (filled && cashflow != null) {
      filledForMatch.push({
        underlying: row.underlying,
        created_at: row.created_at,
        cashflow,
        effect: info.effect,
        contractKey: info.contractKey,
        strategy: row.strategy,
        expiration: info.expiration,
        strike: info.strike,
        optionType: info.optionType,
      });
    }

    const u = underMap.get(row.underlying) ?? {
      underlying: row.underlying,
      orders: 0,
      filled: 0,
      canceled: 0,
      netCashflow: 0,
      debits: 0,
      credits: 0,
    };
    u.orders += 1;
    if (filled) u.filled += 1;
    if (canceled) u.canceled += 1;
    if (cashflow != null) {
      u.netCashflow += cashflow;
      if (cashflow < 0) u.debits += 1;
      if (cashflow > 0) u.credits += 1;
    }
    underMap.set(row.underlying, u);

    const day = dayKeyInZone(row.created_at, timeZone);
    const mKey = day.slice(0, 7);
    if (mKey) {
      const m = monthMap.get(mKey) ?? {
        key: mKey,
        orders: 0,
        filled: 0,
        canceled: 0,
        netCashflow: 0,
        debits: 0,
        credits: 0,
        tickers: new Map<string, number>(),
      };
      m.orders += 1;
      if (filled) m.filled += 1;
      if (canceled) m.canceled += 1;
      if (cashflow != null) {
        m.netCashflow += cashflow;
        if (cashflow < 0) m.debits += 1;
        if (cashflow > 0) m.credits += 1;
      }
      m.tickers.set(row.underlying, (m.tickers.get(row.underlying) || 0) + 1);
      monthMap.set(mKey, m);
    }

    if (day) {
      const d = dayMap.get(day) ?? { date: day, orders: 0, filled: 0, canceled: 0, netCashflow: 0 };
      d.orders += 1;
      if (filled) d.filled += 1;
      if (canceled) d.canceled += 1;
      if (cashflow != null) d.netCashflow += cashflow;
      dayMap.set(day, d);
    }

    const created = new Date(row.created_at);
    if (!Number.isNaN(created.getTime())) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        hour12: false,
        weekday: "short",
      }).formatToParts(created);
      const hour = Number(parts.find((p) => p.type === "hour")?.value ?? created.getUTCHours());
      const weekday = parts.find((p) => p.type === "weekday")?.value || "";
      const dow = DOW_LABELS.findIndex((l) => weekday.startsWith(l));
      const hRow = hourMap.get(hour % 24)!;
      hRow.orders += 1;
      if (filled) hRow.filled += 1;
      if (canceled) hRow.canceled += 1;
      if (cashflow != null) hRow.netCashflow += cashflow;
      if (dow >= 0) {
        const dRow = dowMap.get(dow)!;
        dRow.orders += 1;
        if (filled) dRow.filled += 1;
        if (canceled) dRow.canceled += 1;
        if (cashflow != null) dRow.netCashflow += cashflow;
      }
    }

    const bucket = dteBucket(info.dte);
    const dbucket = dteMap.get(bucket) ?? { bucket, orders: 0, filled: 0, netCashflow: 0 };
    dbucket.orders += 1;
    if (filled) dbucket.filled += 1;
    if (cashflow != null) dbucket.netCashflow += cashflow;
    dteMap.set(bucket, dbucket);

    const stratName = (row.strategy || "unlabeled").replace(/_/g, " ");
    const s = stratMap.get(stratName) ?? { strategy: stratName, count: 0, netCashflow: 0 };
    s.count += 1;
    if (cashflow != null) s.netCashflow += cashflow;
    stratMap.set(stratName, s);

    const { raw_json: _raw, ...rest } = row;
    return {
      ...rest,
      legSummary: info.summary,
      cashflow,
      effect: info.effect,
      dte: info.dte,
      optionType: info.optionType,
      strike: info.strike,
      expiration: info.expiration,
    };
  });

  const byUnderlying = [...underMap.values()].sort((a, b) => b.orders - a.orders).slice(0, 16);
  const byMonth: OptionMonthRow[] = [...monthMap.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((m) => {
      const top = [...m.tickers.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        key: m.key,
        label: monthLabel(m.key),
        orders: m.orders,
        filled: m.filled,
        canceled: m.canceled,
        netCashflow: m.netCashflow,
        debits: m.debits,
        credits: m.credits,
        topUnderlying: top?.[0] ?? null,
      };
    });
  const byStrategy = [...stratMap.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  const dailyBars = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  let running = 0;
  const cashflowCurve = dailyBars.map((d) => {
    running += d.netCashflow;
    return { t: d.date, pnl: running };
  });

  const filledAsc = [...filledForMatch].sort((a, b) => a.created_at.localeCompare(b.created_at));
  void matchRoundTrips;
  const roundTrips = matchRoundTripsSigned(filledAsc);
  const roundTripPnl = roundTrips.reduce((s, t) => s + t.pnl, 0);
  const avgHoldHours = roundTrips.length
    ? roundTrips.reduce((s, t) => s + t.holdHours, 0) / roundTrips.length
    : null;

  const dteOrder = ["0d / expired", "0–2d", "3–7d", "8–21d", "22–45d", "45d+", "unknown"];
  const byDte = dteOrder
    .map((b) => dteMap.get(b))
    .filter((x): x is OptionDteBucket => Boolean(x));

  const cancelRate = rows.length ? canceledCount / rows.length : null;

  const bullets: string[] = [];
  if (!rows.length) {
    bullets.push("No option orders synced — use Pull full history on the Options tab.");
  } else {
    bullets.push(
      `${rows.length} option orders (${sinceLabel} → ${latest?.slice(0, 10) || "—"}) · ${filledCount} filled · ${canceledCount} canceled/rejected.`,
    );
    bullets.push(
      `Filled premium cashflow (credits − debits): ${netCashflow >= 0 ? "+" : ""}${netCashflow.toFixed(2)} — order-level tape.`,
    );
    if (roundTrips.length) {
      bullets.push(
        `${roundTrips.length} matched open→close round trips · combined PnL ${roundTripPnl >= 0 ? "+" : ""}${roundTripPnl.toFixed(2)} · avg hold ${avgHoldHours != null ? `${avgHoldHours.toFixed(1)}h` : "—"}.`,
      );
    }
    bullets.push(`Debits paid ${debitSpend.toFixed(2)} · credits received ${creditReceive.toFixed(2)}.`);
    if (cancelRate != null) bullets.push(`Cancel/reject rate ${Math.round(cancelRate * 100)}% — process friction signal.`);
    if (byUnderlying[0]) {
      bullets.push(`Most active underlying: ${byUnderlying[0].underlying} (${byUnderlying[0].orders} orders).`);
    }
    if (byStrategy[0] && byStrategy[0].strategy !== "unlabeled") {
      bullets.push(`Dominant structure: ${byStrategy[0].strategy} (${byStrategy[0].count}).`);
    }
    const openish = orders.filter((o) => o.effect === "open").length;
    const closeish = orders.filter((o) => o.effect === "close").length;
    if (openish || closeish) {
      bullets.push(`Leg effects: ${openish} open · ${closeish} close.`);
    }
    bullets.push("Stepping off options — this tab is for reflection, not the next ticket.");
  }

  return {
    since: sinceLabel,
    earliest,
    latest,
    orderCount: rows.length,
    filledCount,
    canceledCount,
    netCashflow,
    debitSpend,
    creditReceive,
    uniqueUnderlyings: underMap.size,
    cancelRate,
    byUnderlying,
    byMonth,
    byStrategy,
    dailyBars,
    cashflowCurve,
    byHour: [...hourMap.values()],
    byDow: [...dowMap.values()],
    byDte,
    roundTrips,
    roundTripPnl,
    roundTripCount: roundTrips.length,
    avgHoldHours,
    bullets,
    orders,
  };
}

/** Compact, privacy-safe payload for AI process briefs. */
export function optionsBriefContext(reflection: OptionsReflection = loadOptionsReflection()) {
  return {
    since: reflection.since,
    earliest: reflection.earliest,
    latest: reflection.latest,
    orderCount: reflection.orderCount,
    filledCount: reflection.filledCount,
    canceledCount: reflection.canceledCount,
    cancelRate: reflection.cancelRate == null ? null : Number((reflection.cancelRate * 100).toFixed(0)),
    netCashflow: Number(reflection.netCashflow.toFixed(2)),
    debitSpend: Number(reflection.debitSpend.toFixed(2)),
    creditReceive: Number(reflection.creditReceive.toFixed(2)),
    uniqueUnderlyings: reflection.uniqueUnderlyings,
    roundTripCount: reflection.roundTripCount,
    roundTripPnl: Number(reflection.roundTripPnl.toFixed(2)),
    avgHoldHours: reflection.avgHoldHours == null ? null : Number(reflection.avgHoldHours.toFixed(1)),
    byUnderlying: reflection.byUnderlying.slice(0, 8).map((u) => ({
      underlying: u.underlying,
      orders: u.orders,
      filled: u.filled,
      canceled: u.canceled,
      netCashflow: Number(u.netCashflow.toFixed(2)),
    })),
    byMonth: reflection.byMonth.map((m) => ({
      label: m.label,
      orders: m.orders,
      filled: m.filled,
      canceled: m.canceled,
      netCashflow: Number(m.netCashflow.toFixed(2)),
      topUnderlying: m.topUnderlying,
    })),
    byStrategy: reflection.byStrategy.slice(0, 6).map((s) => ({
      strategy: s.strategy,
      count: s.count,
      netCashflow: Number(s.netCashflow.toFixed(2)),
    })),
    byDte: reflection.byDte,
    byDow: reflection.byDow.filter((d) => d.orders > 0),
    topRoundTrips: reflection.roundTrips.slice(0, 8).map((t) => ({
      underlying: t.underlying,
      contract: t.contract,
      holdHours: Number(t.holdHours.toFixed(1)),
      pnl: Number(t.pnl.toFixed(2)),
    })),
    worstRoundTrips: [...reflection.roundTrips].sort((a, b) => a.pnl - b.pnl).slice(0, 5).map((t) => ({
      underlying: t.underlying,
      contract: t.contract,
      holdHours: Number(t.holdHours.toFixed(1)),
      pnl: Number(t.pnl.toFixed(2)),
    })),
    bestRoundTrips: [...reflection.roundTrips].sort((a, b) => b.pnl - a.pnl).slice(0, 5).map((t) => ({
      underlying: t.underlying,
      contract: t.contract,
      holdHours: Number(t.holdHours.toFixed(1)),
      pnl: Number(t.pnl.toFixed(2)),
    })),
    bullets: reflection.bullets,
  };
}

export type OptionsCalendarClose = {
  underlying: string;
  contract: string;
  closedAt: string;
  holdHours: number;
  pnl: number;
  strategy: string | null;
};

export type OptionsCalendarDay = {
  date: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  cashflow: number;
  orders: number;
  closes: OptionsCalendarClose[];
};

export type OptionsCalendarMonth = {
  year: number;
  month: number;
  timeZone: string;
  days: OptionsCalendarDay[];
  monthPnl: number;
  monthTrades: number;
  monthCashflow: number;
};

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Day-bucketed options round-trip PnL (+ tape cashflow) for a calendar month. */
export function computeOptionsCalendarMonth(
  year: number,
  month: number,
  timeZone = DEFAULT_TIMEZONE,
): OptionsCalendarMonth {
  const y = Math.max(2000, Math.min(2100, Math.floor(year)));
  const m = Math.max(1, Math.min(12, Math.floor(month)));
  const prefix = monthKey(y, m);
  const reflection = loadOptionsReflection(timeZone);
  const byDay = new Map<string, OptionsCalendarDay>();

  for (const trip of reflection.roundTrips) {
    const date = dayKeyInZone(trip.closedAt, timeZone);
    if (!date.startsWith(prefix)) continue;
    const row = byDay.get(date) ?? {
      date, pnl: 0, trades: 0, wins: 0, losses: 0, cashflow: 0, orders: 0, closes: [],
    };
    row.pnl += trip.pnl;
    row.trades += 1;
    if (trip.pnl > 0) row.wins += 1;
    else if (trip.pnl < 0) row.losses += 1;
    row.closes.push({
      underlying: trip.underlying,
      contract: trip.contract,
      closedAt: trip.closedAt,
      holdHours: trip.holdHours,
      pnl: trip.pnl,
      strategy: trip.strategy,
    });
    byDay.set(date, row);
  }

  for (const bar of reflection.dailyBars) {
    if (!bar.date.startsWith(prefix)) continue;
    const row = byDay.get(bar.date) ?? {
      date: bar.date, pnl: 0, trades: 0, wins: 0, losses: 0, cashflow: 0, orders: 0, closes: [],
    };
    row.cashflow = bar.netCashflow;
    row.orders = bar.orders;
    byDay.set(bar.date, row);
  }

  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    year: y,
    month: m,
    timeZone,
    days,
    monthPnl: days.reduce((s, d) => s + d.pnl, 0),
    monthTrades: days.reduce((s, d) => s + d.trades, 0),
    monthCashflow: days.reduce((s, d) => s + d.cashflow, 0),
  };
}

/** Serialize orders for Python ML (no account masks). */
export function optionsOrdersForMl(reflection: OptionsReflection = loadOptionsReflection()) {
  return reflection.orders.map((o) => ({
    id: o.external_id,
    underlying: o.underlying,
    direction: o.direction,
    state: o.state,
    strategy: o.strategy,
    quantity: o.quantity,
    filled_quantity: o.filled_quantity,
    premium: o.processed_premium ?? o.premium,
    cashflow: o.cashflow,
    created_at: o.created_at,
    effect: o.effect,
    dte: o.dte,
    option_type: o.optionType,
    strike: o.strike,
    expiration: o.expiration,
  }));
}
