import { NextResponse } from "next/server";
import { analyzeBars } from "@/lib/python-service";
import type { OhlcvBar } from "@/lib/technicals";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const bars = (Array.isArray(body.bars) ? body.bars : []) as OhlcvBar[];
    const analysis = await analyzeBars(bars, {
      bins: Number(body.bins || 32),
      vpMode: body.vpMode || body.vp_mode || "daily",
      includeMl: Boolean(body.includeMl ?? body.include_ml),
    });
    return NextResponse.json(analysis);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analyze failed." },
      { status: 500 },
    );
  }
}
