import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteTickerSnapshot } from "@/lib/ticker-cache";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = db.prepare("SELECT symbol FROM watchlist_items WHERE id=?").get(Number(id)) as { symbol: string } | undefined;
  db.prepare("DELETE FROM watchlist_items WHERE id=?").run(Number(id));
  if (row) {
    const draft = db.prepare("SELECT 1 FROM watchlist_drafts WHERE symbol=?").get(row.symbol);
    if (!draft) deleteTickerSnapshot(row.symbol);
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    if (body.status) {
      if (!["WATCHING", "READY", "PASSED", "ARCHIVED"].includes(body.status)) throw new Error("Invalid status.");
      db.prepare("UPDATE watchlist_items SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(body.status, Number(id));
    }
    if (body.setup != null || body.thesis != null || body.timeframe != null || body.triggerPrice !== undefined || body.invalidation !== undefined || body.target !== undefined) {
      const current = db.prepare("SELECT * FROM watchlist_items WHERE id=?").get(Number(id)) as Record<string, unknown> | undefined;
      if (!current) throw new Error("Watchlist item not found.");
      db.prepare(`UPDATE watchlist_items SET
        setup=?, thesis=?, timeframe=?,
        trigger_price=?, invalidation=?, target=?,
        updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
        body.setup != null ? String(body.setup).trim() : current.setup,
        body.thesis != null ? String(body.thesis).trim() : current.thesis,
        body.timeframe != null ? String(body.timeframe).trim() : current.timeframe,
        body.triggerPrice !== undefined ? (body.triggerPrice === "" || body.triggerPrice == null ? null : Number(body.triggerPrice)) : current.trigger_price,
        body.invalidation !== undefined ? (body.invalidation === "" || body.invalidation == null ? null : Number(body.invalidation)) : current.invalidation,
        body.target !== undefined ? (body.target === "" || body.target == null ? null : Number(body.target)) : current.target,
        Number(id),
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed." }, { status: 400 });
  }
}
