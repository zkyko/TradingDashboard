import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";

type Attachment = {
  stored_name: string;
  mime_type: string;
  original_name: string;
  draft_id: string | null;
  watchlist_item_id: number | null;
  journal_entry_id: string | null;
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = db.prepare("SELECT stored_name,mime_type,original_name FROM attachments WHERE id=?").get(id) as Attachment | undefined;
  if (!row) return NextResponse.json({ error: "Screenshot not found." }, { status: 404 });
  try {
    const bytes = await fs.readFile(path.join(process.cwd(), "data", "uploads", row.stored_name));
    return new NextResponse(bytes, { headers: { "content-type": row.mime_type, "content-disposition": `inline; filename="${row.original_name.replaceAll('"', "")}"`, "cache-control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "Screenshot file is missing." }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = db.prepare("SELECT stored_name,draft_id,watchlist_item_id,journal_entry_id FROM attachments WHERE id=?").get(id) as Attachment | undefined;
  if (!row) return NextResponse.json({ error: "Screenshot not found." }, { status: 404 });
  if (!row.draft_id && !row.watchlist_item_id && !row.journal_entry_id) {
    return NextResponse.json({ error: "Committed decision screenshots cannot be removed." }, { status: 400 });
  }
  db.prepare("DELETE FROM attachments WHERE id=?").run(id);
  if (row.watchlist_item_id) {
    db.prepare("UPDATE watchlist_items SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.watchlist_item_id);
  }
  if (row.journal_entry_id) {
    db.prepare("UPDATE journal_entries SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.journal_entry_id);
  }
  await fs.rm(path.join(process.cwd(), "data", "uploads", row.stored_name), { force: true });
  return NextResponse.json({ ok: true });
}
