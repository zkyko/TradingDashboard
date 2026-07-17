import { NextResponse } from "next/server";
import { computeAnalytics } from "@/lib/analytics";
import { ACCOUNT_DATA_SINCE } from "@/lib/account-desk";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const since = url.searchParams.get("since") || ACCOUNT_DATA_SINCE;
    return NextResponse.json(computeAnalytics({ since }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analytics failed." },
      { status: 500 },
    );
  }
}
