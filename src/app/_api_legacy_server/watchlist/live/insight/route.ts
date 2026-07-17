import { NextResponse } from "next/server";
import { interpretLiveTape } from "@/lib/memory";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const tapes = Array.isArray(body.tapes) ? body.tapes : body.symbol ? [body] : [];
    if (!tapes.length) throw new Error("tapes required");

    const insights = [];
    for (const tape of tapes.slice(0, 12)) {
      const symbol = String(tape.symbol || "").trim().toUpperCase();
      if (!symbol) continue;
      const insight = await interpretLiveTape({
        symbol,
        changePct: tape.changePct == null ? null : Number(tape.changePct),
        price: tape.price == null ? null : Number(tape.price),
        last: tape.last || null,
        states: tape.states || null,
        ml: tape.ml || null,
        interval: tape.interval ? String(tape.interval) : undefined,
        profiles: tape.profiles || null,
        plays: Array.isArray(tape.plays) ? tape.plays : null,
      });
      insights.push({ symbol, ...insight });
    }
    return NextResponse.json({ insights });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Live insight failed." },
      { status: 500 },
    );
  }
}
