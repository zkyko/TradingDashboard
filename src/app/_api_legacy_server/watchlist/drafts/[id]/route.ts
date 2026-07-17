import { NextResponse } from "next/server";
import { commitTickerDraft, discardTickerDraft } from "@/lib/ticker-cache";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const result = commitTickerDraft(id, {
      setup: body.setup ? String(body.setup) : undefined,
      thesis: body.thesis ? String(body.thesis) : undefined,
      timeframe: body.timeframe ? String(body.timeframe) : undefined,
      triggerPrice: body.triggerPrice != null && body.triggerPrice !== "" ? Number(body.triggerPrice) : null,
      invalidation: body.invalidation != null && body.invalidation !== "" ? Number(body.invalidation) : null,
      target: body.target != null && body.target !== "" ? Number(body.target) : null,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error && error.message.includes("UNIQUE")
      ? "That symbol is already on your watchlist."
      : error instanceof Error ? error.message : "Unable to add to watchlist.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(discardTickerDraft(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Discard failed." }, { status: 400 });
  }
}
