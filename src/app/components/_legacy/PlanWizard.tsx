"use client";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Challenge, MemoryMatch } from "@/lib/types";
import ScreenshotUpload from "./ScreenshotUpload";

type Row = Record<string, string | number | null>;
type Reviewed = { draftId: string; challenge: Challenge; memories: MemoryMatch[] };

export default function PlanWizard({ playbooks, openPlans, initialPlanId, initialTicker = "" }: { playbooks: Row[]; openPlans: Row[]; initialPlanId: string; initialTicker?: string }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(initialPlanId);
  const existing = useMemo(() => openPlans.find((p) => String(p.id) === selectedId), [openPlans, selectedId]);
  const [reviewed, setReviewed] = useState<Reviewed | null>(null);
  const [answers, setAnswers] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const response = await fetch("/api/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) return setError(body.error);
    setReviewed(body);
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }
  async function commit() {
    if (!reviewed) return;
    setBusy(true); setError("");
    const response = await fetch("/api/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: reviewed.draftId, answers }) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) return setError(body.error);
    router.push("/"); router.refresh();
  }
  const field = (name: string, label: string, opts?: { type?: string; step?: string; fallback?: string; required?: boolean }) => {
    const type = opts?.type ?? "number";
    return (
      <label>
        <span>{label}</span>
        <input
          name={name}
          type={type}
          step={type === "number" ? (opts?.step ?? "0.01") : undefined}
          required={opts?.required ?? name !== "triggerPrice"}
          defaultValue={String(existing?.[name] ?? opts?.fallback ?? "")}
        />
      </label>
    );
  };
  return <div className="wizard">
    <form onSubmit={review}>
      <section className="form-section"><div className="form-number">01</div><div><h2>Action</h2><p>New plan or change an open one.</p></div>
        <label className="full"><span>Open plan</span><select name="tradePlanId" value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setReviewed(null); }}><option value="">New</option>{openPlans.map((p) => <option key={Number(p.id)} value={String(p.id)}>{p.ticker} · v{p.version}</option>)}</select></label>
        <div className="field-grid"><label><span>Type</span><select name="decisionType" defaultValue={existing ? "ADD" : "ENTRY"}><option>ENTRY</option><option>ADD</option><option>REDUCE</option><option>EXIT</option><option>STOP_CHANGE</option><option>TARGET_CHANGE</option><option>HOLD_EXTENSION</option></select></label><label><span>Direction</span><select name="direction" defaultValue={String(existing?.direction ?? "BULL")}><option>BULL</option><option>BEAR</option></select></label>{field("ticker", "Ticker", { type: "text", fallback: initialTicker })}</div>
        {existing && <label className="full"><span>Change reason</span><textarea name="changeReason" required placeholder="What changed" /></label>}
      </section>
      <section className="form-section"><div className="form-number">02</div><div><h2>Setup</h2><p>Facts and thesis.</p></div>
        <label className="full"><span>Playbook</span><select name="playbookId" defaultValue={String(existing?.playbook_id ?? playbooks[0]?.id)}>{playbooks.map((p) => <option key={Number(p.id)} value={String(p.id)}>{p.name}</option>)}</select></label>
        <label className="full"><span>Thesis</span><textarea name="thesis" required defaultValue={String(existing?.thesis ?? "")} placeholder="Thesis" /></label>
        <label className="full"><span>Market context</span><textarea name="marketContext" required defaultValue={String(existing?.market_context ?? "")} placeholder="Context" /></label>
        <label className="full"><span>Evidence</span><textarea name="evidence" required defaultValue={String(existing?.evidence ?? "")} placeholder="Evidence" /></label>
      </section>
      <section className="form-section"><div className="form-number">03</div><div><h2>Levels</h2><p>Prices and size. Planned loss is calculated.</p></div>
        <div className="field-grid">{field("val", "VAL")}{field("vah", "VAH")}{field("entry", "Entry")}{field("invalidation", "Invalidation")}{field("target", "Target")}{field("quantity", "Shares", { step: "0.001" })}{field("accountEquity", "Account equity")}{field("holdUntil", "Review by", { type: "datetime-local" })}{field("triggerPrice", "Trigger (optional)", { required: false })}</div>
      </section>
      <button className="primary wide" disabled={busy}>{busy ? "…" : "Review"}</button>
    </form>
    {reviewed && <section className="challenge"><p className="eyebrow">Review</p><h2>Before you save</h2><p>{reviewed.challenge.summary}</p>
      {reviewed.challenge.contradictions.length > 0 && <div className="contradictions"><h3>Conflicts</h3><ul>{reviewed.challenge.contradictions.map((c) => <li key={c}>{c}</li>)}</ul></div>}
      {reviewed.memories.length > 0 && <div><h3>Related plans</h3>{reviewed.memories.map((m) => <blockquote key={m.id}><b>{m.ticker} · {m.decisionType}</b><br/>{m.thesis}</blockquote>)}</div>}
      <ol className="questions">{reviewed.challenge.questions.map((q) => <li key={q}>{q}</li>)}</ol>
      <ScreenshotUpload draftId={reviewed.draftId} />
      <label><span>Answers</span><textarea value={answers} onChange={(e) => setAnswers(e.target.value)} placeholder="Answers to the questions above" /></label>
      <button className="primary wide" onClick={commit} disabled={busy}>{busy ? "…" : "Save plan"}</button>
    </section>}
    {error && <div className="error-box">{error}</div>}
  </div>;
}
