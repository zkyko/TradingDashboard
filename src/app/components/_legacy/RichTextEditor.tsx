"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type Editor } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";

function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const startX = useRef(0);
  const startW = useRef(0);

  const onPointerDown = (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    startX.current = event.clientX;
    startW.current = Number.parseInt(String(node.attrs.width || "480"), 10) || 480;
    const onMove = (e: PointerEvent) => {
      const next = Math.max(120, Math.min(900, startW.current + (e.clientX - startX.current)));
      updateAttributes({ width: `${Math.round(next)}` });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <NodeViewWrapper className={`rte-image-wrap${selected ? " is-selected" : ""}`} data-drag-handle>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={String(node.attrs.src || "")}
        alt={String(node.attrs.alt || "")}
        title={String(node.attrs.title || "")}
        style={{ width: node.attrs.width ? `${node.attrs.width}px` : "min(100%, 480px)" }}
        draggable={false}
      />
      <span className="rte-image-handle" onPointerDown={onPointerDown} aria-hidden="true" />
    </NodeViewWrapper>
  );
}

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => element.getAttribute("width") || element.style.width?.replace("px", "") || null,
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return { width: attributes.width, style: `width: ${attributes.width}px` };
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

function Toolbar({ editor, onInsertImage }: { editor: Editor; onInsertImage: () => void }) {
  return (
    <div className="rte-toolbar">
      <button type="button" className={editor.isActive("bold") ? "on" : ""} onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
      <button type="button" className={editor.isActive("italic") ? "on" : ""} onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
      <button type="button" className={editor.isActive("underline") ? "on" : ""} onClick={() => editor.chain().focus().toggleUnderline().run()}>U</button>
      <button type="button" className={editor.isActive("bulletList") ? "on" : ""} onClick={() => editor.chain().focus().toggleBulletList().run()}>List</button>
      <button type="button" className={editor.isActive("orderedList") ? "on" : ""} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</button>
      <button type="button" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Table</button>
      <button type="button" disabled={!editor.can().addColumnAfter()} onClick={() => editor.chain().focus().addColumnAfter().run()}>+Col</button>
      <button type="button" disabled={!editor.can().addRowAfter()} onClick={() => editor.chain().focus().addRowAfter().run()}>+Row</button>
      <button type="button" disabled={!editor.can().deleteTable()} onClick={() => editor.chain().focus().deleteTable().run()}>Del table</button>
      <button type="button" onClick={onInsertImage}>Image</button>
    </div>
  );
}

export default function RichTextEditor({
  value,
  onChange,
  journalEntryId,
  placeholder = "Process notes, levels, what you will check tomorrow…",
}: {
  value: string;
  onChange: (html: string) => void;
  journalEntryId?: string | null;
  placeholder?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      ResizableImage.configure({ inline: false, allowBase64: false }),
    ],
    content: value || "",
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== current) editor.commands.setContent(value || "", { emitUpdate: false });
  }, [value, editor]);

  const uploadImage = useCallback(async (file: File) => {
    if (!editor) return;
    if (!journalEntryId) {
      window.alert("Save the entry once before attaching images.");
      return;
    }
    const form = new FormData();
    form.set("journalEntryId", journalEntryId);
    form.set("caption", file.name);
    form.set("file", file);
    const response = await fetch("/api/attachments", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Upload failed.");
    editor.chain().focus().setImage({ src: data.url, alt: file.name } as { src: string; alt: string }).run();
    editor.commands.updateAttributes("image", { width: "480" });
  }, [editor, journalEntryId]);

  if (!editor) return <div className="rte-shell loading">Loading editor…</div>;

  return (
    <div className="rte-shell">
      <Toolbar editor={editor} onInsertImage={() => fileRef.current?.click()} />
      <EditorContent editor={editor} className="rte-content" />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            await uploadImage(file);
          } catch (error) {
            window.alert(error instanceof Error ? error.message : "Upload failed.");
          }
        }}
      />
    </div>
  );
}
