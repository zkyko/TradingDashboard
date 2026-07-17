import { NextResponse } from "next/server";
import { listJournalEntries, saveJournalEntry } from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listJournalEntries(100));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.id) throw new Error("Omit id when creating; use PATCH to update.");
    const entry = saveJournalEntry({
      title: String(body.title || "Untitled"),
      bodyHtml: String(body.bodyHtml || ""),
      source: body.source ? String(body.source) : "manual",
      ticker: body.ticker ? String(body.ticker).toUpperCase() : null,
      sentiment: body.sentiment ? String(body.sentiment) : null,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      meta: body.meta && typeof body.meta === "object" ? body.meta : {},
      createOnly: true,
    });
    return NextResponse.json(entry);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed." }, { status: 400 });
  }
}
