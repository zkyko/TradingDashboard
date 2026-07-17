import { NextResponse } from "next/server";
import { getPremarketSymbolBrief } from "@/lib/insights";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const symbol = String(body.symbol || "").trim();
    if (!symbol) throw new Error("symbol required");
    const brief = await getPremarketSymbolBrief({
      symbol,
      name: body.name ? String(body.name) : undefined,
      group: body.group ? String(body.group) : undefined,
      changePct: body.changePct == null ? null : Number(body.changePct),
      weekChangePct: body.weekChangePct == null ? null : Number(body.weekChangePct),
      price: body.price == null ? null : Number(body.price),
      force: Boolean(body.force),
      board: body.board && typeof body.board === "object" ? body.board : undefined,
    });
    return NextResponse.json(brief);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Premarket insight failed." },
      { status: 500 },
    );
  }
}
