import { NextResponse } from "next/server";
import { computeCalendarMonth } from "@/lib/analytics";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const now = new Date();
    const year = Number(url.searchParams.get("year") || now.getUTCFullYear());
    const month = Number(url.searchParams.get("month") || now.getUTCMonth() + 1);
    const timeZone = url.searchParams.get("tz") || DEFAULT_TIMEZONE;
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      throw new Error("Invalid year or month.");
    }
    return NextResponse.json(computeCalendarMonth(year, month, timeZone));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Calendar failed." },
      { status: 400 },
    );
  }
}
