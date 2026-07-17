import { NextResponse } from "next/server";
import { autoJournalFromRecent } from "@/lib/insights";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(12, Number(body.limit || 5)));
    const result = await autoJournalFromRecent(limit);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Auto journal failed." }, { status: 400 });
  }
}
