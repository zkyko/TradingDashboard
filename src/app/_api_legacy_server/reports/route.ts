import { NextResponse } from "next/server";
import { generateReport, type ReportPeriod } from "@/lib/reports";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!["EOD", "EOW", "EOM"].includes(body.type)) throw new Error("Report type must be EOD, EOW, or EOM.");
    const report = generateReport(body.type as ReportPeriod, body.anchor ? new Date(body.anchor) : new Date());
    return NextResponse.json({ id: report.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Report generation failed." }, { status: 400 });
  }
}
