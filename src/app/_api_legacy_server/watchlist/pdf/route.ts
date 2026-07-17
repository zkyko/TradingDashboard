import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Lightweight text/PDF-friendly export of the active workstation snapshot. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const symbol = String(body.symbol || "SYMBOL");
    const lines: string[] = [
      "Zkyko Watch Analysis",
      `Symbol: ${symbol}`,
      `Generated: ${new Date().toISOString()}`,
      "",
      "Descriptive market math — not a recommendation.",
      "",
    ];
    if (body.quote) {
      lines.push(`Price: ${body.quote.price ?? "—"}`);
      lines.push(`Change %: ${body.changePct ?? "—"}`);
      lines.push("");
    }
    if (body.analysis?.last) {
      lines.push(`RSI: ${body.analysis.last.rsi ?? "—"}`);
      lines.push(`SMA20: ${body.analysis.last.sma20 ?? "—"}`);
      lines.push(`Vol ratio: ${body.analysis.last.volRatio ?? "—"}`);
      lines.push("");
    }
    if (body.analysis?.volumeProfile) {
      const vp = body.analysis.volumeProfile;
      lines.push(`VP mode: ${vp.mode}`);
      lines.push(`POC: ${vp.poc ?? "—"}  VAH: ${vp.vah ?? "—"}  VAL: ${vp.val ?? "—"}`);
      lines.push("");
    }
    if (body.analysis?.risk) {
      const r = body.analysis.risk;
      lines.push(`Total return: ${r.totalReturn ?? "—"}`);
      lines.push(`Ann vol: ${r.annVol ?? "—"}`);
      lines.push(`Sharpe: ${r.sharpe ?? "—"}`);
      lines.push(`Max DD: ${r.maxDrawdown ?? "—"}`);
      lines.push("");
    }
    if (body.analysis?.ml) {
      lines.push("ML (experimental):");
      lines.push(`Predicted close: ${body.analysis.ml.predictedClose}`);
      lines.push(`Test R²: ${body.analysis.ml.testScore}`);
      lines.push(body.analysis.ml.disclaimer || "");
      lines.push("");
    }
    if (body.insight?.headline) {
      lines.push(`Note: ${body.insight.headline}`);
    }

    const text = lines.join("\n");
    // Minimal valid PDF with embedded text (Type1 Helvetica)
    const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const contentLines = escaped.split("\n").map((line, i) => `BT /F1 10 Tf 50 ${750 - i * 14} Td (${line}) Tj ET`);
    const stream = contentLines.join("\n");
    const objects = [
      "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj",
      "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj",
      "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj",
      `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream endobj`,
      "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [0];
    for (const obj of objects) {
      offsets.push(Buffer.byteLength(pdf, "utf8"));
      pdf += `${obj}\n`;
    }
    const xref = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    for (let i = 1; i < offsets.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    return new NextResponse(pdf, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="zkyko-${symbol}-analysis.pdf"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PDF failed." },
      { status: 500 },
    );
  }
}
