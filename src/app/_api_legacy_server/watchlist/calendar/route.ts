import { NextResponse } from "next/server";
import { computeWatchCalendarMonth, listActivityForItem, timelineForWatchItem } from "@/lib/watchlist-activity";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase();
    const itemId = Number(url.searchParams.get("itemId") || 0);
    const tz = url.searchParams.get("tz") || DEFAULT_TIMEZONE;

    if (symbol || itemId) {
      if (itemId) {
        const item = db.prepare("SELECT id, symbol FROM watchlist_items WHERE id=?").get(itemId) as
          | { id: number; symbol: string }
          | undefined;
        if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
        return NextResponse.json({
          symbol: item.symbol,
          itemId: item.id,
          timeline: timelineForWatchItem(item.id, item.symbol),
        });
      }
      const item = db.prepare("SELECT id, symbol FROM watchlist_items WHERE symbol=?").get(symbol) as
        | { id: number; symbol: string }
        | undefined;
      if (item) {
        return NextResponse.json({
          symbol: item.symbol,
          itemId: item.id,
          timeline: timelineForWatchItem(item.id, item.symbol),
        });
      }
      return NextResponse.json({
        symbol,
        itemId: null,
        timeline: [],
      });
    }

    const now = new Date();
    const year = Number(url.searchParams.get("year") || now.getUTCFullYear());
    const month = Number(url.searchParams.get("month") || now.getUTCMonth() + 1);
    return NextResponse.json(computeWatchCalendarMonth(year, month, tz));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Watch calendar failed." },
      { status: 400 },
    );
  }
}
