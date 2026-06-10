import type { ReactNode } from "react";
import { MessagePasteBlock } from "@/components/MessagePasteBlock";

type MessageSegment =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language?: string };

type HighlightOptions = {
  term: string;
  activeMatchIndex: number;
  startIndex: number;
};

export type RenderMessageContentOptions = {
  highlight?: HighlightOptions;
  onCopyNotify?: (message: string) => void;
};

export function stripInlineMarkdown(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, "").replace(/```$/g, ""))
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
}

function splitFencedCodeBlocks(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const pattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, index) });
    }

    const language = match[1]?.trim() || undefined;
    segments.push({
      type: "code",
      content: (match[2] ?? "").replace(/\n$/, ""),
      language
    });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", content: text }];
}

function renderInlineMarkdown(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*.+?\*\*|__.+?__)/g;
  let cursor = 0;
  let key = 0;

  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push(text.slice(cursor, index));
    }

    if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code className="message-inline-code" key={`code-${key++}`}>
          {token.slice(1, -1)}
        </code>
      );
    } else {
      const inner = token.startsWith("**")
        ? token.slice(2, -2)
        : token.startsWith("__")
          ? token.slice(2, -2)
          : token;
      parts.push(<strong key={`md-${key++}`}>{inner}</strong>);
    }

    cursor = index + token.length;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.length > 0 ? parts : text;
}

function renderHighlightedText(
  text: string,
  term: string,
  activeMatchIndex: number,
  startIndex: number
): { node: ReactNode; nextMatchIndex: number } {
  const query = term.trim();
  if (!query) {
    return { node: text, nextMatchIndex: startIndex };
  }

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
  return {
    node: parts.length > 0 ? parts : text,
    nextMatchIndex: matchIndex
  };
}

function renderTextSegment(text: string, highlight?: HighlightOptions, matchIndex = 0) {
  if (!highlight?.term.trim()) {
    return { node: renderInlineMarkdown(text), nextMatchIndex: matchIndex };
  }

  const plain = stripInlineMarkdown(text);
  const { node, nextMatchIndex } = renderHighlightedText(
    plain,
    highlight.term,
    highlight.activeMatchIndex,
    matchIndex
  );
  return { node, nextMatchIndex };
}

function renderCodeSegment(
  content: string,
  key: number,
  onCopyNotify?: (message: string) => void,
  highlight?: HighlightOptions,
  matchIndex = 0
) {
  if (!highlight?.term.trim()) {
    return {
      node: (
        <MessagePasteBlock content={content} key={`paste-${key}`} onNotify={onCopyNotify}>
          {content}
        </MessagePasteBlock>
      ),
      nextMatchIndex: matchIndex
    };
  }

  const { node, nextMatchIndex } = renderHighlightedText(
    content,
    highlight.term,
    highlight.activeMatchIndex,
    matchIndex
  );

  return {
    node: (
      <MessagePasteBlock content={content} key={`paste-${key}`} onNotify={onCopyNotify}>
        {node}
      </MessagePasteBlock>
    ),
    nextMatchIndex
  };
}

export function renderMessageContent(text: string, options?: RenderMessageContentOptions): ReactNode {
  const highlight = options?.highlight;
  const segments = splitFencedCodeBlocks(text);
  const parts: ReactNode[] = [];
  let matchIndex = highlight?.startIndex ?? 0;

  segments.forEach((segment, index) => {
    if (segment.type === "code") {
      const rendered = renderCodeSegment(
        segment.content,
        index,
        options?.onCopyNotify,
        highlight,
        matchIndex
      );
      parts.push(rendered.node);
      matchIndex = rendered.nextMatchIndex;
      return;
    }

    const rendered = renderTextSegment(segment.content, highlight, matchIndex);
    parts.push(<span key={`text-${index}`}>{rendered.node}</span>);
    matchIndex = rendered.nextMatchIndex;
  });

  return parts.length === 1 ? parts[0] : parts;
}
