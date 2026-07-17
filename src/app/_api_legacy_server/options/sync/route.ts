import { NextResponse } from "next/server";
import { fetchRobinhoodSnapshot, reconcileSnapshot } from "@/lib/robinhood";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Pull the entire Robinhood options order history (all pages) into SQLite. */
export async function POST() {
  try {
    const snapshot = await fetchRobinhoodSnapshot({ fullOptions: true });
    const reconciliation = reconcileSnapshot(snapshot);
    const stats = db.prepare(`
      SELECT COUNT(*) AS total,
        MIN(created_at) AS earliest,
        MAX(created_at) AS latest
      FROM broker_option_orders
    `).get() as { total: number; earliest: string | null; latest: string | null };
    return NextResponse.json({
      ok: true,
      reconciliation,
      optionOrdersInSnapshot: snapshot.optionOrders.length,
      stored: stats,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Options sync failed." },
      { status: 500 },
    );
  }
}

export async function GET() {
  return POST();
}
