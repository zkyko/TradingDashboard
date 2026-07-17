import { NextResponse } from "next/server";
import { getOptionsProcessBrief } from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("force") === "1";
    const brief = await getOptionsProcessBrief({ force });
    return NextResponse.json(brief);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Options brief failed." },
      { status: 500 },
    );
  }
}
