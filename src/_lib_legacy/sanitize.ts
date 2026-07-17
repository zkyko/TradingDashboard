import sanitizeHtmlLib from "sanitize-html";

/** Allowlist matching TipTap journal schema — strips scripts/events. */
export function sanitizeJournalHtml(html: string): string {
  return sanitizeHtmlLib(html || "", {
    allowedTags: [
      "p", "br", "strong", "em", "b", "i", "u", "s",
      "ul", "ol", "li",
      "h1", "h2", "h3", "blockquote", "hr",
      "table", "thead", "tbody", "tr", "th", "td", "colgroup", "col",
      "img", "a", "span", "div",
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "style"],
      td: ["colspan", "rowspan", "colwidth", "style"],
      th: ["colspan", "rowspan", "colwidth", "style"],
      col: ["style", "width"],
      "*": ["class", "style"],
    },
    allowedSchemes: ["http", "https", "data"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    transformTags: {
      a: sanitizeHtmlLib.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
  });
}

/** Reject model output that slips into trade directives. */
export function scrubTradeAdvice(text: string): string {
  const blocked = /\b(buy|sell|long|short|enter|exit|add to|size up|leverage)\b[^.]{0,80}\b(now|today|here|at|shares|contracts)\b/i;
  if (!blocked.test(text)) return text;
  return text.replace(blocked, "[process note redacted]");
}
