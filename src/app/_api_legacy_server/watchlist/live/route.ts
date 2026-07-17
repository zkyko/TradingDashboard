import { NextResponse } from "next/server";
import { fetchLiveBoard, LIVE_DEFAULT_SYMBOLS, type LiveInterval } from "@/lib/python-service";

export const dynamic = "force-dynamic";

const ALLOWED = new Set<LiveInterval>(["10m", "15m", "30m"]);

async function handle(intervalRaw: string, symbolsRaw: string[] | null, includeMl: boolean) {
  const interval = ALLOWED.has(intervalRaw as LiveInterval) ? (intervalRaw as LiveInterval) : "15m";
  const symbols = symbolsRaw?.length ? symbolsRaw : [...LIVE_DEFAULT_SYMBOLS];
  return fetchLiveBoard(interval, symbols, includeMl);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbolsParam = url.searchParams.get("symbols");
    const symbols = symbolsParam
      ? symbolsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    const board = await handle(
      String(url.searchParams.get("interval") || "15m"),
      symbols,
      url.searchParams.get("includeMl") !== "false",
    );
    return NextResponse.json(board);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Live board failed.",
        hint: "Start the Python service: npm run dev:python",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const symbols = Array.isArray(body.symbols)
      ? body.symbols.map((s: unknown) => String(s).trim()).filter(Boolean)
      : null;
    const board = await handle(
      String(body.interval || "15m"),
      symbols,
      body.includeMl !== false && body.include_ml !== false,
    );
    return NextResponse.json(board);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Live board failed.",
        hint: "Start the Python service: npm run dev:python",
      },
      { status: 500 },
    );
  }
}
