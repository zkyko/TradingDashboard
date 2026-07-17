import { NextResponse } from "next/server";
import { refreshWatchlistSnapshots } from "@/lib/ticker-cache";

export async function POST(request: Request) {
  try {
    const isCron = request.headers.get("x-thesis-loop-cron") === "1";
    const secret = process.env.SYNC_SECRET;
    if (isCron) {
      const auth = request.headers.get("authorization");
      if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
      }
    }
    const result = await refreshWatchlistSnapshots(isCron ? "hourly" : "manual");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Quote refresh failed." }, { status: 500 });
  }
}
