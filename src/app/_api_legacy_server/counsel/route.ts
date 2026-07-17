import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { counselJournal } from "@/lib/memory";
import { listSparSessions, pushSparSession } from "@/lib/desk-cache";

export async function GET() {
  try {
    return NextResponse.json({ sessions: listSparSessions(20) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Spar history failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const question = String(body.question || "").trim();
    if (question.length < 10) throw new Error("Give Spar a specific decision or behavior to examine.");
    if (question.length > 4000) throw new Error("Keep the prompt under 4,000 characters.");
    const result = await counselJournal(question);
    const session = {
      id: randomUUID(),
      question,
      result: result as Record<string, unknown>,
      createdAt: new Date().toISOString(),
    };
    pushSparSession(session);
    return NextResponse.json({ ...result, sessionId: session.id, sessions: listSparSessions(12) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Spar failed." },
      { status: 400 },
    );
  }
}
