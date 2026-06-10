import type { ReactNode } from "react";

export function stripInlineMarkdown(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
}

export function renderInlineMarkdown(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*.+?\*\*|__.+?__)/g;
  let cursor = 0;
  let key = 0;

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push(text.slice(cursor, index));
    }

    const inner = token.startsWith("**")
      ? token.slice(2, -2)
      : token.startsWith("__")
        ? token.slice(2, -2)
        : token;

    parts.push(<strong key={`md-${key++}`}>{inner}</strong>);
    cursor = index + token.length;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.length > 0 ? parts : text;
}

export function renderMessageContent(
  text: string,
  highlight?: {
    term: string;
    activeMatchIndex: number;
    startIndex: number;
  }
): ReactNode {
  if (highlight?.term.trim()) {
    return renderHighlightedText(
      stripInlineMarkdown(text),
      highlight.term,
      highlight.activeMatchIndex,
      highlight.startIndex
    );
  }

  return renderInlineMarkdown(text);
}

function renderHighlightedText(
  text: string,
  term: string,
  activeMatchIndex: number,
  startIndex: number
) {
  const query = term.trim();
  if (!query) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = startIndex;

  while (true) {
    const found = lowerText.indexOf(lowerQuery, cursor);
    if (found === -1) break;

    if (found > cursor) parts.push(text.slice(cursor, found));

    const value = text.slice(found, found + query.length);
    const isActive = matchIndex === activeMatchIndex;
    parts.push(
      <mark className={`search-highlight ${isActive ? "active" : ""}`} key={`${found}-${matchIndex}`}>
        {value}
      </mark>
    );
    cursor = found + query.length;
    matchIndex += 1;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length > 0 ? parts : text;
}
