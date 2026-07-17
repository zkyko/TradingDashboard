import { NextResponse } from "next/server";
import { optionsOrdersForMl } from "@/lib/options-reflection";
import { analyzeOptionsHistory } from "@/lib/python-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const orders = optionsOrdersForMl();
    const ml = await analyzeOptionsHistory(orders);
    return NextResponse.json(ml);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Options ML failed." },
      { status: 500 },
    );
  }
}

export async function POST() {
  return GET();
}
