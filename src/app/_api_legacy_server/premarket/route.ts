import { NextResponse } from "next/server";
import { fetchPremarketBoard } from "@/lib/premarket";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const days = Number(new URL(request.url).searchParams.get("days") || 7);
    const board = await fetchPremarketBoard(Number.isFinite(days) ? days : 7);
    return NextResponse.json(board);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Premarket failed." },
      { status: 500 },
    );
  }
}
