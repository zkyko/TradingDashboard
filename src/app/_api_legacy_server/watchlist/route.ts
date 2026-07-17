import { NextResponse } from "next/server";
import { db } from "@/lib/db";

function withAttachments() {
  const items = db.prepare("SELECT * FROM watchlist_items ORDER BY status,updated_at DESC").all() as Array<Record<string, unknown>>;
  const shots = db.prepare("SELECT id,watchlist_item_id,original_name,caption,created_at FROM attachments WHERE watchlist_item_id IS NOT NULL ORDER BY created_at").all() as Array<Record<string, unknown>>;
  return items.map((item) => ({
    ...item,
    attachments: shots
      .filter((shot) => Number(shot.watchlist_item_id) === Number(item.id))
      .map((shot) => ({
        id: String(shot.id),
        originalName: String(shot.original_name),
        caption: shot.caption ? String(shot.caption) : "",
        url: `/api/attachments/${shot.id}`,
        createdAt: String(shot.created_at),
      })),
  }));
}

export async function GET() {
  return NextResponse.json(withAttachments());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const symbol = String(body.symbol || "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error("Enter a valid ticker symbol.");
    if (String(body.thesis || "").trim().length < 10) throw new Error("Write a short reason for watching this symbol.");
    const result = db.prepare(`INSERT INTO watchlist_items (symbol,thesis,setup,timeframe,trigger_price,invalidation,target,status,last_price,previous_close,quote_time,bid,ask,quote_state,quote_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      symbol,
      String(body.thesis).trim(),
      String(body.setup || "Unclassified").trim(),
      String(body.timeframe || "Swing").trim(),
      body.triggerPrice ? Number(body.triggerPrice) : null,
      body.invalidation ? Number(body.invalidation) : null,
      body.target ? Number(body.target) : null,
      String(body.status || "WATCHING"),
      body.lastPrice != null ? Number(body.lastPrice) : null,
      body.previousClose != null ? Number(body.previousClose) : null,
      body.quoteTime ? String(body.quoteTime) : null,
      body.bid != null ? Number(body.bid) : null,
      body.ask != null ? Number(body.ask) : null,
      body.quoteState ? String(body.quoteState) : null,
      body.quoteJson ? JSON.stringify(body.quoteJson) : null,
    );
    return NextResponse.json({ id: Number(result.lastInsertRowid) });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("UNIQUE")
      ? "That symbol is already on your watchlist."
      : error instanceof Error ? error.message : "Unable to add symbol.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
