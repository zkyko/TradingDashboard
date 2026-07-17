import { NextResponse } from "next/server";
import { counselWatchlistItem } from "@/lib/memory";
import { db } from "@/lib/db";
import { logWatchActivity } from "@/lib/watchlist-activity";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const question = body.question ? String(body.question).trim() : undefined;
    if (question && question.length > 2000) throw new Error("Keep the watchlist question under 2,000 characters.");
    const result = await counselWatchlistItem(Number(id), question);
    const item = db.prepare("SELECT symbol FROM watchlist_items WHERE id=?").get(Number(id)) as { symbol: string } | undefined;
    if (item) {
      logWatchActivity({
        watchlistItemId: Number(id),
        symbol: item.symbol,
        kind: "counsel",
        summary: question || "Process check-in",
        payload: { readiness: (result as { readiness?: string }).readiness, offline: (result as { offline?: boolean }).offline },
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Watchlist counsel failed." }, { status: 400 });
  }
}
