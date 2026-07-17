import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";

const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
const uploadDir = path.join(process.cwd(), "data", "uploads");

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const draftId = String(form.get("draftId") || "").trim();
    const watchlistItemId = String(form.get("watchlistItemId") || "").trim();
    const journalEntryId = String(form.get("journalEntryId") || "").trim();
    const caption = String(form.get("caption") || "").trim();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a screenshot.");
    const targets = [draftId, watchlistItemId, journalEntryId].filter(Boolean);
    if (targets.length !== 1) throw new Error("Attach to exactly one of: decision draft, watchlist item, or journal entry.");
    if (draftId && !db.prepare("SELECT 1 FROM decision_drafts WHERE id=?").get(draftId)) throw new Error("The reviewed draft no longer exists.");
    if (watchlistItemId && !db.prepare("SELECT 1 FROM watchlist_items WHERE id=?").get(Number(watchlistItemId))) throw new Error("Watchlist item not found.");
    if (journalEntryId && !db.prepare("SELECT 1 FROM journal_entries WHERE id=?").get(journalEntryId)) throw new Error("Journal entry not found.");
    if (!allowed.has(file.type)) throw new Error("Screenshots must be PNG, JPEG, or WebP.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Screenshot must be 10 MB or smaller.");
    const id = randomUUID();
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const storedName = `${id}.${ext}`;
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(path.join(uploadDir, storedName), Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    db.prepare(`INSERT INTO attachments
      (id,draft_id,watchlist_item_id,journal_entry_id,original_name,stored_name,mime_type,byte_size,caption)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(
        id,
        draftId || null,
        watchlistItemId ? Number(watchlistItemId) : null,
        journalEntryId || null,
        file.name,
        storedName,
        file.type,
        file.size,
        caption || null,
      );
    if (watchlistItemId) {
      db.prepare("UPDATE watchlist_items SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(watchlistItemId));
      const item = db.prepare("SELECT symbol FROM watchlist_items WHERE id=?").get(Number(watchlistItemId)) as { symbol: string } | undefined;
      if (item) {
        const { logWatchActivity } = await import("@/lib/watchlist-activity");
        logWatchActivity({
          watchlistItemId: Number(watchlistItemId),
          symbol: item.symbol,
          kind: "shot",
          summary: caption || file.name,
          payload: { attachmentId: id, url: `/api/attachments/${id}` },
        });
      }
    }
    if (journalEntryId) {
      db.prepare("UPDATE journal_entries SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(journalEntryId);
    }
    return NextResponse.json({ id, originalName: file.name, mimeType: file.type, byteSize: file.size, caption, url: `/api/attachments/${id}` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed." }, { status: 400 });
  }
}
