import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    if (String(body.explanation || "").trim().length < 20) throw new Error("Explain the unplanned activity in at least 20 characters.");
    if (!body.classification) throw new Error("Classify the exception.");
    const result = db.prepare(`UPDATE reconciliation_exceptions SET status='RESOLVED', explanation=?, classification=?, resolved_at=CURRENT_TIMESTAMP WHERE id=? AND status='OPEN'`)
      .run(String(body.explanation).trim(), String(body.classification), Number(id));
    if (!result.changes) throw new Error("Exception not found or already resolved.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to resolve exception." }, { status: 400 });
  }
}
