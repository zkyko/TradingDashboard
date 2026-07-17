import { NextResponse } from "next/server";
import { optionsAnalyze, optionsChain } from "@/lib/python-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase();
    if (!symbol) throw new Error("symbol required");
    const chain = await optionsChain(symbol);
    return NextResponse.json(chain);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Options chain failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const symbol = String(body.symbol || "").trim().toUpperCase();
    if (!symbol) throw new Error("symbol required");
    const analysis = await optionsAnalyze(symbol, Boolean(body.includeMl));
    return NextResponse.json(analysis);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Options analyze failed." },
      { status: 500 },
    );
  }
}
