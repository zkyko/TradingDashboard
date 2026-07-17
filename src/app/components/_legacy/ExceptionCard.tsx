"use client";
import { useState } from "react";

export default function ExceptionCard({ exception }: { exception: Record<string, string | number | null> }) {
  const [classification, setClassification] = useState("IMPULSIVE");
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/exceptions/${exception.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ classification, explanation }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setError(body.error);
    window.location.reload();
  }

  return (
    <article className="exception-card">
      <p>{exception.summary}</p>
      <select value={classification} onChange={(e) => setClassification(e.target.value)}>
        <option value="IMPULSIVE">Outside plan</option>
        <option value="OPERATIONAL">Ops fix</option>
        <option value="MISSING_JOURNAL">Plan existed, not logged</option>
      </select>
      <textarea placeholder="What happened" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      <button onClick={resolve} disabled={busy}>{busy ? "…" : "Resolve"}</button>
      {error && <p className="error">{error}</p>}
    </article>
  );
}
