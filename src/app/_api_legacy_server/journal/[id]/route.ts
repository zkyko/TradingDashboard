import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { deleteJournalEntry, getJournalEntry, saveJournalEntry } from "@/lib/insights";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const entry = getJournalEntry(id);
  if (!entry) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(entry);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const existing = getJournalEntry(id);
    if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const body = await request.json();
    const entry = saveJournalEntry({
      id,
      title: body.title != null ? String(body.title) : String(existing.title || "Untitled"),
      bodyHtml: body.bodyHtml != null ? String(body.bodyHtml) : String(existing.body_html || ""),
      source: body.source != null ? String(body.source) : undefined,
      ticker: body.ticker !== undefined ? (body.ticker ? String(body.ticker).toUpperCase() : null) : undefined,
      sentiment: body.sentiment !== undefined ? (body.sentiment ? String(body.sentiment) : null) : undefined,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
      meta: body.meta && typeof body.meta === "object" ? body.meta : undefined,
    });
    return NextResponse.json(entry);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed." }, { status: 400 });
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const shots = deleteJournalEntry(id);
  await Promise.all(
    shots.map((shot) => fs.rm(path.join(process.cwd(), "data", "uploads", shot.stored_name), { force: true })),
  );
  return NextResponse.json({ ok: true });
}
