"use client";
import { FormEvent, ClipboardEvent, useRef, useState } from "react";
import Image from "next/image";

type Upload = { id: string; originalName: string; url: string; caption: string };

export default function ScreenshotUpload({ draftId }: { draftId: string }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [caption, setCaption] = useState("");
  const [hint, setHint] = useState("Paste screenshot (⌘V)");
  const pasteRef = useRef<HTMLDivElement>(null);

  async function send(file: File, note?: string) {
    setBusy(true); setError("");
    const formData = new FormData();
    formData.set("draftId", draftId);
    formData.set("file", file);
    formData.set("caption", note || caption || file.name);
    const response = await fetch("/api/attachments", { method: "POST", body: formData });
    const body = await response.json(); setBusy(false);
    if (!response.ok) return setError(body.error);
    setUploads((current) => [...current, body]);
    setCaption("");
    setHint("Attached. Paste another if needed.");
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File)) return setError("Choose a screenshot.");
    await send(file, String(data.get("caption") || ""));
    form.reset();
  }

  async function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    const image = Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image/"));
    if (!image) return setHint("No image on clipboard.");
    event.preventDefault();
    const file = image.getAsFile();
    if (!file) return;
    await send(new File([file], `paste-${Date.now()}.png`, { type: file.type || "image/png" }));
  }

  async function remove(id: string) {
    const response = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    if (response.ok) setUploads((current) => current.filter((item) => item.id !== id));
  }

  return <div className="screenshot-uploader">
    <div className="terminal-label">Charts</div>
    <div className="paste-well" tabIndex={0} ref={pasteRef} onPaste={onPaste} onClick={() => pasteRef.current?.focus()}>
      <strong>{busy ? "Uploading…" : hint}</strong>
      <span>or pick a file</span>
    </div>
    <form onSubmit={upload}>
      <input name="file" type="file" accept="image/png,image/jpeg,image/webp" />
      <input name="caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption" />
      <button disabled={busy}>{busy ? "…" : "Upload"}</button>
    </form>
    {error && <p className="error">{error}</p>}
    {uploads.length > 0 && <div className="screenshot-strip">{uploads.map((item) => <figure key={item.id}><Image src={item.url} alt={item.caption || item.originalName} width={1200} height={675} unoptimized /><figcaption>{item.caption || item.originalName}</figcaption><button onClick={() => remove(item.id)} aria-label="Remove screenshot">×</button></figure>)}</div>}
  </div>;
}
