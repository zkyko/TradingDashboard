import { NextResponse } from "next/server";
import { challengePlan } from "@/lib/plans";
import { planSchema } from "@/lib/validation";
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";

export async function POST(request: Request) {
  try {
    const plan = planSchema.parse(await request.json());
    const result = await challengePlan(plan);
    const draftId = randomUUID();
    db.prepare("DELETE FROM decision_drafts WHERE datetime(created_at) < datetime('now','-24 hours')").run();
    db.prepare("INSERT INTO decision_drafts (id,plan_json,challenge_json,embedding_json) VALUES (?,?,?,?)").run(
      draftId, JSON.stringify(plan), JSON.stringify(result.challenge), result.embedding ? JSON.stringify(result.embedding) : null
    );
    return NextResponse.json({ draftId, challenge: result.challenge, memories: result.memories });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to review plan." }, { status: 400 });
  }
}
