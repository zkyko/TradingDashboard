import { NextResponse } from "next/server";
import { fetchRobinhoodSnapshot, reconcileSnapshot } from "@/lib/robinhood";
import { runNotificationTick } from "@/lib/notifications";
import { getAccountabilityBrief } from "@/lib/insights";
import { refreshWatchlistSnapshots } from "@/lib/ticker-cache";
import { isMorningScanWindow, runMorningScan } from "@/lib/morning-scan";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.SYNC_SECRET;
  const auth = request.headers.get("authorization");
  const isCron = request.headers.get("x-thesis-loop-cron") === "1";
  if (isCron) return Boolean(secret && auth === `Bearer ${secret}`);
  // Session users also allowed via middleware
  return true;
}

/**
 * Regular tick for launchd/cron:
 * - price + setup notifications
 * - optional morning RH movers/volume → VP setups (?morning=1 or 7:30 window)
 * - optional account sync + watchlist quotes + AI brief refresh
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const syncAccount = url.searchParams.get("sync") === "1" || url.searchParams.get("full") === "1";
    const refreshAi = url.searchParams.get("ai") === "1" || url.searchParams.get("full") === "1";
    const refreshWatch = url.searchParams.get("watch") !== "0";
    const morningForced = url.searchParams.get("morning") === "1";
    const morningAuto = !morningForced && url.searchParams.get("morning") !== "0" && isMorningScanWindow();

    const tick = await runNotificationTick();
    let morning: unknown = null;
    let account: unknown = null;
    let watch: unknown = null;
    let brief: unknown = null;

    if (morningForced || morningAuto) {
      try {
        morning = await runMorningScan({ force: morningForced });
      } catch (err) {
        morning = { error: err instanceof Error ? err.message : "morning scan failed" };
      }
    }

    if (refreshWatch) {
      try {
        watch = await refreshWatchlistSnapshots("hourly");
      } catch (err) {
        watch = { error: err instanceof Error ? err.message : "watch refresh failed" };
      }
    }

    if (syncAccount) {
      try {
        const snapshot = await fetchRobinhoodSnapshot();
        account = reconcileSnapshot(snapshot);
      } catch (err) {
        account = { error: err instanceof Error ? err.message : "account sync failed" };
      }
    }

    if (refreshAi) {
      try {
        brief = await getAccountabilityBrief({ force: true });
      } catch (err) {
        brief = { error: err instanceof Error ? err.message : "AI brief failed" };
      }
    }

    return NextResponse.json({ ok: true, tick, morning, watch, account, brief });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cron tick failed." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
