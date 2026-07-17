"use client";
import { FormEvent, useEffect, useState } from "react";
import { useFormat } from "@/app/components/useFormat";
import { useI18n } from "@/locales/client";
import type { SparSession } from "@/lib/desk-cache";

type Result = {
  offline?: boolean;
  reflection?: string;
  patterns?: string[];
  questions?: string[];
  commitments?: string[];
  context?: Array<{ id: string; kind: string; date: string; text: string; score: number }>;
  sessionId?: string;
};

export default function CounselorTerminal() {
  const format = useFormat();
  const t = useI18n();
  const [result, setResult] = useState<Result | null>(null);
  const [sessions, setSessions] = useState<SparSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/counsel");
        const body = await response.json();
        if (response.ok) {
          const list = (body.sessions || []) as SparSession[];
          setSessions(list);
          if (list[0]?.result) {
            setResult(list[0].result as Result);
            setQuestion(list[0].question);
          }
        }
      } catch { /* ignore */ }
    })();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/counsel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setError(body.error);
    setResult(body);
    setSessions((body.sessions || []) as SparSession[]);
  }

  return (
    <div className="counsel-layout">
      <section className="terminal-panel counsel-input">
        <div className="panel-head"><span>{t("spar.eyebrow")}</span><span>AI</span></div>
        <form onSubmit={(e) => void submit(e)}>
          <textarea
            name="question"
            required
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("spar.question")}
          />
          <div className="counsel-rules">
            <span>No signals</span>
            <span>No size advice</span>
            <span>Local notes only</span>
          </div>
          <button className="primary" disabled={busy}>{busy ? "…" : t("spar.ask")}</button>
          {error && <div className="error-box">{error}</div>}
        </form>
        {!!sessions.length && (
          <div className="spar-history">
            <div className="panel-head" style={{ paddingLeft: 0 }}><span>{t("spar.history")}</span></div>
            <ul>
              {sessions.slice(0, 8).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setQuestion(s.question);
                      setResult(s.result as Result);
                    }}
                  >
                    <b>{s.question.slice(0, 72)}{s.question.length > 72 ? "…" : ""}</b>
                    <span className="muted">{format.dateTime(s.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      {result && (
        <section className="counsel-output">
          <div className="terminal-panel">
            <div className="panel-head">
              <span>Reply</span>
              <span className={result.offline ? "amber" : "positive"}>{result.offline ? "Offline" : "Saved"}</span>
            </div>
            <p className="reflection">{result.reflection}</p>
          </div>
          <div className="counsel-columns">
            <section className="terminal-panel">
              <div className="panel-head"><span>Patterns</span></div>
              <ul>{result.patterns?.map((item) => <li key={item}>{item}</li>) || <li>None</li>}</ul>
            </section>
            <section className="terminal-panel">
              <div className="panel-head"><span>Questions</span></div>
              <ol>{result.questions?.map((item) => <li key={item}>{item}</li>)}</ol>
            </section>
          </div>
          <section className="terminal-panel">
            <div className="panel-head"><span>To consider</span></div>
            <ul>{result.commitments?.map((item) => <li key={item}>{item}</li>) || <li>None</li>}</ul>
          </section>
          <section className="terminal-panel">
            <div className="panel-head"><span>Matched notes</span><span>{result.context?.length || 0}</span></div>
            <div className="memory-stack">
              {result.context?.map((item) => (
                <article key={item.id}>
                  <div>
                    <b>{item.kind}</b>
                    <span className="muted">{item.date}</span>
                  </div>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </section>
        </section>
      )}
    </div>
  );
}
