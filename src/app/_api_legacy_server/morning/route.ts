import { NextResponse } from "next/server";
import { getMorningScan, listRecentMorningScans, runMorningScan } from "@/lib/morning-scan";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const day = url.searchParams.get("day") || undefined;
    const latest = getMorningScan(day);
    return NextResponse.json({
      ok: true,
      morning: latest,
      recent: listRecentMorningScans(5),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Morning scan read failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const force = body.force !== false;
    const morning = await runMorningScan({ force });
    return NextResponse.json({ ok: true, morning });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Morning scan failed." },
      { status: 500 },
    );
  }
}
