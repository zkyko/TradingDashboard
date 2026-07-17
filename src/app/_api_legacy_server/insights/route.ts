import { NextResponse } from "next/server";
import { analyzeSentiment, recognizeProcessPatterns } from "@/lib/insights";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") || "all";
    const force = url.searchParams.get("force") === "1";
    if (kind === "sentiment") return NextResponse.json(await analyzeSentiment({ force }));
    if (kind === "patterns") return NextResponse.json(await recognizeProcessPatterns({ force }));
    const [sentiment, patterns] = await Promise.all([
      analyzeSentiment({ force }),
      recognizeProcessPatterns({ force }),
    ]);
    return NextResponse.json({ sentiment, patterns });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Insights failed." }, { status: 400 });
  }
}
