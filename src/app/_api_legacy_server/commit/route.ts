import { NextResponse } from "next/server";
import { commitPlan } from "@/lib/plans";
import { planSchema } from "@/lib/validation";
import type { Challenge } from "@/lib/types";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const draft = db.prepare("SELECT * FROM decision_drafts WHERE id=? AND datetime(created_at) >= datetime('now','-24 hours')").get(String(body.draftId || "")) as { plan_json: string; challenge_json: string; embedding_json: string | null } | undefined;
    if (!draft) throw new Error("This reviewed draft is missing or expired. Run the challenge again.");
    const plan = planSchema.parse(JSON.parse(draft.plan_json));
    const challenge = JSON.parse(draft.challenge_json) as Challenge;
    const embedding = draft.embedding_json ? JSON.parse(draft.embedding_json) as number[] : null;
    const result = commitPlan(plan, challenge, String(body.answers || ""), embedding);
    db.prepare("UPDATE attachments SET plan_version_id=?, draft_id=NULL WHERE draft_id=?").run(result.versionId, String(body.draftId));
    db.prepare("DELETE FROM decision_drafts WHERE id=?").run(String(body.draftId));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to commit plan." }, { status: 400 });
  }
}
