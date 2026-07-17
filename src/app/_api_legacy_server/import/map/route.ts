import { NextResponse } from "next/server";
import { mapImportColumns } from "@/lib/insights";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const columns = Array.isArray(body.columns) ? body.columns.map(String) : [];
    const rows = Array.isArray(body.rows) ? body.rows as Array<Record<string, string>> : [];
    if (!columns.length) throw new Error("No CSV columns provided.");
    const result = await mapImportColumns(columns, rows);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Mapping failed." }, { status: 400 });
  }
}
