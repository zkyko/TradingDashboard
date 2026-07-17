import { NextResponse } from "next/server";
import { predictBars } from "@/lib/python-service";
import type { OhlcvBar } from "@/lib/technicals";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const bars = (Array.isArray(body.bars) ? body.bars : []) as OhlcvBar[];
    const result = await predictBars(bars);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Predict failed." },
      { status: 500 },
    );
  }
}
