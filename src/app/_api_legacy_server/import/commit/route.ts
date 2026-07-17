import { NextResponse } from "next/server";
import { applyMappedRows, type FieldMapping } from "@/lib/insights";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rows = Array.isArray(body.rows) ? body.rows as Array<Record<string, string>> : [];
    const mapping = (body.mapping || {}) as FieldMapping;
    if (!rows.length) throw new Error("No rows to import.");
    const result = applyMappedRows(rows, mapping);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed." }, { status: 400 });
  }
}
