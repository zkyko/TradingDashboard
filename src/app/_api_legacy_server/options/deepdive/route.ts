import { NextResponse } from "next/server";
import { getOptionsDeepDive } from "@/lib/insights";
import { optionsOrdersForMl } from "@/lib/options-reflection";
import { analyzeOptionsHistory } from "@/lib/python-service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("force") === "1";
    const ml = await analyzeOptionsHistory(optionsOrdersForMl());
    const dive = await getOptionsDeepDive({ force, ml });
    return NextResponse.json(dive);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Deep dive failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("force") === "1";
    let ml: unknown = null;
    try {
      const body = await request.json();
      if (body?.ml) ml = body.ml;
    } catch {
      /* no body */
    }
    if (!ml) ml = await analyzeOptionsHistory(optionsOrdersForMl());
    const dive = await getOptionsDeepDive({ force, ml });
    return NextResponse.json(dive);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Deep dive failed." },
      { status: 500 },
    );
  }
}
