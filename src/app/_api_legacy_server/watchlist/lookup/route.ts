import { NextResponse } from "next/server";
import { lookupAndStageTicker, writeTickerSnapshot, applyQuoteToWatchlist } from "@/lib/ticker-cache";
import { interpretTickerPage } from "@/lib/memory";
import { analyzeBars } from "@/lib/python-service";
import { logWatchActivity } from "@/lib/watchlist-activity";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const withInsight = body.insight !== false;
    const days = Number(body.days || 90);
    const interval = (["day", "hour", "10minute", "5minute"].includes(String(body.interval))
      ? String(body.interval)
      : "day") as "day" | "hour" | "10minute" | "5minute";
    const result = await lookupAndStageTicker(String(body.symbol || ""), days, interval);
    let snapshot = result.snapshot;
    let analysis = null as Awaited<ReturnType<typeof analyzeBars>> | null;

    const bars = snapshot.market?.historicals || [];
    if (bars.length) {
      try {
        analysis = await analyzeBars(bars, {
          vpMode: body.vpMode || "daily",
          includeMl: Boolean(body.includeMl),
        });
      } catch {
        analysis = null;
      }
    }

    if (withInsight) {
      try {
        const insight = await interpretTickerPage({
          symbol: snapshot.symbol,
          quote: snapshot.quote as unknown as Record<string, unknown>,
          changePct: snapshot.changePct,
          market: snapshot.market as unknown as Record<string, unknown> | null,
          local: snapshot.local as unknown as Record<string, unknown>,
        });
        snapshot = { ...snapshot, insight };
        writeTickerSnapshot(snapshot);
        if (result.draftId) {
          const { db } = await import("@/lib/db");
          db.prepare("UPDATE watchlist_drafts SET payload_json=? WHERE id=?").run(JSON.stringify(snapshot), result.draftId);
        }
        if (result.onWatchlist) {
          applyQuoteToWatchlist(snapshot.quote, JSON.stringify(snapshot));
        }
      } catch {
        // Insight is additive
      }
    }

    if (result.onWatchlist && result.watchlistId) {
      const change = snapshot.changePct;
      logWatchActivity({
        watchlistItemId: result.watchlistId,
        symbol: snapshot.symbol,
        kind: "refresh",
        summary: [
          `Price ${snapshot.quote.price}`,
          change == null ? null : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`,
          analysis?.last?.rsi != null ? `RSI ${analysis.last.rsi.toFixed(1)}` : null,
        ].filter(Boolean).join(" · "),
        payload: {
          price: snapshot.quote.price,
          changePct: snapshot.changePct,
          rsi: analysis?.last?.rsi ?? null,
          sma20: analysis?.last?.sma20 ?? null,
          volRatio: analysis?.last?.volRatio ?? null,
          vp: analysis?.volumeProfile
            ? {
              poc: analysis.volumeProfile.poc,
              vah: analysis.volumeProfile.vah,
              val: analysis.volumeProfile.val,
              mode: analysis.volumeProfile.mode,
            }
            : null,
          risk: analysis?.risk
            ? {
              sharpe: analysis.risk.sharpe,
              maxDrawdown: analysis.risk.maxDrawdown,
              totalReturn: analysis.risk.totalReturn,
            }
            : null,
          source: analysis?.source || null,
        },
      });
    }

    return NextResponse.json({
      symbol: snapshot.symbol,
      draftId: result.draftId,
      onWatchlist: result.onWatchlist,
      watchlistId: result.watchlistId,
      status: result.status,
      capturedAt: snapshot.capturedAt,
      quote: snapshot.quote,
      changePct: snapshot.changePct,
      local: snapshot.local,
      market: snapshot.market,
      insight: snapshot.insight,
      analysis,
      cacheFile: `data/ticker-cache/${snapshot.symbol}.json`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ticker lookup failed." },
      { status: 500 },
    );
  }
}
