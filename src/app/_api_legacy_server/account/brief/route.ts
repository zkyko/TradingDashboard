import { NextResponse } from "next/server";
import { getAccountabilityBrief } from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const brief = await getAccountabilityBrief({ force });
    return NextResponse.json(brief);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Brief failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const brief = await getAccountabilityBrief({ force: Boolean(body.force ?? true) });
    return NextResponse.json(brief);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Brief failed." },
      { status: 500 },
    );
  }
}
