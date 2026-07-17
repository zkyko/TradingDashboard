import { db } from "./db";

export type ReportPeriod = "EOD" | "EOW" | "EOM";

export type ReportContent = {
  generatedAt: string;
  headline: string;
  metrics: { openingEquity: number | null; closingEquity: number | null; equityChange: number | null; cash: number | null; buyingPower: number | null; unleveragedBuyingPower: number | null; marginCapacity: number | null; decisions: number; planChanges: number; fills: number; exceptions: number; adherenceRate: number | null };
  decisions: Array<Record<string, string | number | null>>;
  fills: Array<Record<string, string | number | null>>;
  exceptions: Array<Record<string, string | number | null>>;
  attachments: Array<Record<string, string | number | null>>;
  observations: string[];
};

export function periodRange(type: ReportPeriod, anchor = new Date()) {
  const start = new Date(anchor);
  const end = new Date(anchor);
  if (type === "EOD") {
    start.setHours(0, 0, 0, 0); end.setHours(23, 59, 59, 999);
  } else if (type === "EOW") {
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1)); start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime()); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999);
  } else {
    start.setDate(1); start.setHours(0, 0, 0, 0);
    end.setMonth(start.getMonth() + 1, 0); end.setHours(23, 59, 59, 999);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

export function scheduledReportTypes(anchor = new Date()): ReportPeriod[] {
  const types: ReportPeriod[] = ["EOD"];
  if (anchor.getDay() === 5) types.push("EOW");
  const nextWeekday = new Date(anchor);
  do { nextWeekday.setDate(nextWeekday.getDate() + 1); } while (nextWeekday.getDay() === 0 || nextWeekday.getDay() === 6);
  if (nextWeekday.getMonth() !== anchor.getMonth()) types.push("EOM");
  return types;
}

export function generateReport(type: ReportPeriod, anchor = new Date()) {
  const range = periodRange(type, anchor);
  const decisions = db.prepare(`SELECT pv.id,tp.ticker,tp.direction,pv.version,pv.decision_type,pv.thesis,pv.change_reason,pv.planned_risk,pv.account_equity,pv.created_at,p.name AS playbook
    FROM plan_versions pv JOIN trade_plans tp ON tp.id=pv.trade_plan_id JOIN playbooks p ON p.id=tp.playbook_id
    WHERE datetime(pv.created_at) BETWEEN datetime(?) AND datetime(?) ORDER BY pv.created_at`).all(range.start, range.end) as ReportContent["decisions"];
  const fills = db.prepare("SELECT ticker,side,quantity,price,executed_at,decision_id FROM executions WHERE datetime(executed_at) BETWEEN datetime(?) AND datetime(?) ORDER BY executed_at").all(range.start, range.end) as ReportContent["fills"];
  const exceptions = db.prepare("SELECT summary,status,classification,explanation,created_at FROM reconciliation_exceptions WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?) ORDER BY created_at").all(range.start, range.end) as ReportContent["exceptions"];
  const attachments = db.prepare(`SELECT a.id,a.original_name,a.caption,a.created_at,tp.ticker,pv.decision_type
    FROM attachments a JOIN plan_versions pv ON pv.id=a.plan_version_id JOIN trade_plans tp ON tp.id=pv.trade_plan_id
    WHERE datetime(a.created_at) BETWEEN datetime(?) AND datetime(?) ORDER BY a.created_at`).all(range.start, range.end) as ReportContent["attachments"];
  const snapshots = db.prepare("SELECT account_equity,captured_at FROM position_snapshots WHERE datetime(captured_at) BETWEEN datetime(?) AND datetime(?) ORDER BY captured_at").all(range.start, range.end) as Array<{ account_equity: number; captured_at: string }>;
  const brokerage = db.prepare("SELECT portfolios_json FROM brokerage_snapshots WHERE datetime(captured_at) BETWEEN datetime(?) AND datetime(?) ORDER BY captured_at DESC LIMIT 1").get(range.start, range.end) as { portfolios_json: string } | undefined;
  const portfolios = brokerage ? JSON.parse(brokerage.portfolios_json) as Array<{ data: Record<string, unknown> }> : [];
  const cash = portfolios.length ? portfolios.reduce((sum, item) => sum + Number(item.data.cash ?? 0), 0) : null;
  const buyingPower = portfolios.length ? portfolios.reduce((sum, item) => sum + Number((item.data.buying_power as Record<string, unknown> | undefined)?.buying_power ?? 0), 0) : null;
  const unleveragedBuyingPower = portfolios.length ? portfolios.reduce((sum, item) => sum + Number((item.data.buying_power as Record<string, unknown> | undefined)?.unleveraged_buying_power ?? 0), 0) : null;
  const reviewStats = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN adhered=1 THEN 1 ELSE 0 END) AS adhered FROM reviews WHERE datetime(reviewed_at) BETWEEN datetime(?) AND datetime(?)`).get(range.start, range.end) as { total: number; adhered: number | null };
  const openingEquity = snapshots[0]?.account_equity ?? null;
  const closingEquity = snapshots.at(-1)?.account_equity ?? null;
  const planChanges = decisions.filter((item) => Number(item.version) > 1).length;
  const unresolved = exceptions.filter((item) => item.status === "OPEN").length;
  const observations: string[] = [];
  if (!decisions.length) observations.push("No journal decisions were committed in this period.");
  if (planChanges) observations.push(`${planChanges} committed plan change${planChanges === 1 ? "" : "s"} require retrospective review.`);
  if (unresolved) observations.push(`${unresolved} brokerage exception${unresolved === 1 ? " remains" : "s remain"} unresolved.`);
  const unlinked = fills.filter((fill) => !fill.decision_id).length;
  if (unlinked) observations.push(`${unlinked} fill${unlinked === 1 ? " has" : "s have"} no linked journal decision.`);
  if (attachments.length) observations.push(`${attachments.length} chart screenshot${attachments.length === 1 ? " was" : "s were"} preserved as evidence.`);
  const content: ReportContent = {
    generatedAt: new Date().toISOString(),
    headline: unresolved ? "Open exceptions" : planChanges ? "Plan changes this period" : "No flags",
    metrics: { openingEquity, closingEquity, equityChange: openingEquity != null && closingEquity != null ? closingEquity - openingEquity : null, cash, buyingPower, unleveragedBuyingPower, marginCapacity: buyingPower != null && unleveragedBuyingPower != null ? Math.max(0, buyingPower-unleveragedBuyingPower) : null, decisions: decisions.length, planChanges, fills: fills.length, exceptions: exceptions.length, adherenceRate: reviewStats.total ? Number(reviewStats.adhered ?? 0) / reviewStats.total : null },
    decisions, fills, exceptions, attachments, observations,
  };
  const label = type === "EOD" ? "DAILY" : type === "EOW" ? "WEEKLY" : "MONTHLY";
  const title = `${label} ACCOUNTABILITY // ${new Date(range.end).toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" }).toUpperCase()}`;
  const result = db.prepare(`INSERT INTO reports (period_type,period_start,period_end,title,content_json) VALUES (?,?,?,?,?)
    ON CONFLICT(period_type,period_start,period_end) DO UPDATE SET title=excluded.title,content_json=excluded.content_json,created_at=CURRENT_TIMESTAMP RETURNING id`)
    .get(type, range.start, range.end, title, JSON.stringify(content)) as { id: number };
  return { id: result.id, type, title, range, content };
}
