import { NextResponse } from "next/server";
import { interpretTickerPage } from "@/lib/memory";
import { readTickerSnapshot, writeTickerSnapshot } from "@/lib/ticker-cache";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const symbol = String(body.symbol || "").trim().toUpperCase();
    if (!symbol) throw new Error("Symbol required.");
    const snapshot = readTickerSnapshot(symbol);
    if (!snapshot) throw new Error("Pull the ticker from Robinhood before asking DeepSeek to read the page.");
    const insight = await interpretTickerPage({
      symbol: snapshot.symbol,
      quote: snapshot.quote as unknown as Record<string, unknown>,
      changePct: snapshot.changePct,
      market: snapshot.market as unknown as Record<string, unknown> | null,
      local: snapshot.local as unknown as Record<string, unknown>,
    });
    const next = { ...snapshot, insight };
    writeTickerSnapshot(next);
    const { applyQuoteToWatchlist } = await import("@/lib/ticker-cache");
    const onList = (await import("@/lib/db")).db.prepare("SELECT 1 FROM watchlist_items WHERE symbol=?").get(symbol);
    if (onList) applyQuoteToWatchlist(next.quote, JSON.stringify(next));
    return NextResponse.json(insight);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Insight failed." }, { status: 400 });
  }
}
