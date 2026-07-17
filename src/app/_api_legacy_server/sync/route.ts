import { NextResponse } from "next/server";
import { sendReviewDigest } from "@/lib/email";
import { fetchRobinhoodSnapshot, reconcileSnapshot } from "@/lib/robinhood";
import { generateReport, scheduledReportTypes } from "@/lib/reports";

async function sync(request: Request) {
  if (process.env.SYNC_SECRET && request.headers.get("authorization") !== `Bearer ${process.env.SYNC_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const snapshot = await fetchRobinhoodSnapshot();
    const reconciliation = reconcileSnapshot(snapshot);
    const reports = scheduledReportTypes().map((type) => generateReport(type)).map(({ id, type }) => ({ id, type }));
    const email = await sendReviewDigest();
    return NextResponse.json({ reconciliation, reports, email });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed." }, { status: 500 });
  }
}

export const POST = sync;
export const GET = sync;
