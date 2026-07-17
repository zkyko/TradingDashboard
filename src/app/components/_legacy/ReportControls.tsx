"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReportControls() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  async function generate(type: "EOD" | "EOW" | "EOM") {
    setBusy(type);
    setError("");
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type }),
    });
    const body = await response.json();
    setBusy("");
    if (!response.ok) return setError(body.error);
    router.push(`/reports/${body.id}`);
    router.refresh();
  }
  return (
    <div className="report-controls">
      <button onClick={() => generate("EOD")} disabled={!!busy}>{busy === "EOD" ? "…" : "Day"}</button>
      <button onClick={() => generate("EOW")} disabled={!!busy}>{busy === "EOW" ? "…" : "Week"}</button>
      <button onClick={() => generate("EOM")} disabled={!!busy}>{busy === "EOM" ? "…" : "Month"}</button>
      {error && <span className="terminal-error">{error}</span>}
    </div>
  );
}
