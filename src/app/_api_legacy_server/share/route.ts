import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();
    const body = await request.json();
    const title = String(body.title || "Watch snapshot").slice(0, 120);
    const payload = body.payload;
    if (!payload || typeof payload !== "object") throw new Error("payload required");
    const slug = randomBytes(6).toString("hex");
    db.prepare(
      `INSERT INTO shared_snapshots (slug, title, payload_json, is_public, created_by)
       VALUES (?, ?, ?, 1, ?)`,
    ).run(slug, title, JSON.stringify(payload), session?.user?.email ?? null);
    return NextResponse.json({ slug, url: `/shared/${slug}` });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Share failed." },
      { status: 400 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const slug = String(url.searchParams.get("slug") || "").trim();
    if (!slug) throw new Error("slug required");
    const row = db.prepare(
      `SELECT slug, title, payload_json, is_public, created_at FROM shared_snapshots WHERE slug=? AND is_public=1`,
    ).get(slug) as { slug: string; title: string; payload_json: string; created_at: string } | undefined;
    if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({
      slug: row.slug,
      title: row.title,
      createdAt: row.created_at,
      payload: JSON.parse(row.payload_json),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Share lookup failed." },
      { status: 400 },
    );
  }
}
