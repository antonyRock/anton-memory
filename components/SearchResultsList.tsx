"use client";

type SearchResult = {
  type: string;
  typeLabel: string;
  id: string | number;
  conversationId?: string | number | null;
  documentId?: string | number | null;
  title: string;
  snippet: string;
  fileName?: string;
  conversationTitle?: string;
  projectTitle?: string;
  matchText?: string;
};

type SearchResultRow = {
  key: string;
  icon: string;
  label: string;
  result: SearchResult;
};

const ICONS: Record<string, string> = {
  project: "📁",
  document: "📄",
  image: "🖼",
  conversation: "💬",
  message: "💬",
  entity: "🏷",
  fact: "🏷",
  task: "✓",
  tag: "🏷"
};

function displayLabel(result: SearchResult) {
  if (result.type === "project") {
    const title = result.title.trim();
    return title.toLowerCase().startsWith("проект") ? title : `Проект ${title}`;
  }
  if (result.type === "document" || result.type === "image") {
    return result.fileName ?? result.title;
  }
  if (result.type === "message" && result.conversationTitle) {
    return result.conversationTitle;
  }
  return result.title;
}

function tagLabelFromMatch(result: SearchResult, query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return result.matchText ?? "";

  const queryLower = trimmedQuery.toLowerCase();
  const matchLower = (result.matchText ?? "").toLowerCase();
  if (matchLower.includes(queryLower)) return trimmedQuery;

  const token = trimmedQuery.split(/\s+/).find((part) => matchLower.includes(part.toLowerCase()));
  return token ?? trimmedQuery;
}

export function buildSearchResultRows(results: SearchResult[], query: string): SearchResultRow[] {
  const rows: SearchResultRow[] = [];
  const seenTagLabels = new Set<string>();

  for (const result of results) {
    rows.push({
      key: `${result.type}-${result.id}`,
      icon: ICONS[result.type] ?? "•",
      label: displayLabel(result),
      result
    });

    const isFileMatch =
      (result.type === "document" || result.type === "image") &&
      result.matchText &&
      !displayLabel(result).toLowerCase().includes(query.trim().toLowerCase());

    if (isFileMatch) {
      const tagLabel = tagLabelFromMatch(result, query);
      const tagKey = tagLabel.toLowerCase();
      if (tagLabel && !seenTagLabels.has(tagKey)) {
        seenTagLabels.add(tagKey);
        rows.push({
          key: `${result.type}-${result.id}-tag-${tagKey}`,
          icon: ICONS.tag,
          label: tagLabel,
          result
        });
      }
    }
  }

  return rows;
}

type SearchResultsListProps = {
  query: string;
  results: SearchResult[];
  onSelect: (result: SearchResult) => void;
};

export function SearchResultsList({ query, results, onSelect }: SearchResultsListProps) {
  const rows = buildSearchResultRows(results, query);

  if (rows.length === 0) {
    return <div className="search-results-empty">Ничего не найдено</div>;
  }

  return (
    <div className="search-results">
      <div className="sidebar-section-title">Результаты</div>
      {rows.slice(0, 16).map((row) => (
        <button
          className="search-result search-result-compact"
          key={row.key}
          onClick={() => onSelect(row.result)}
          title={row.result.snippet || row.label}
          type="button"
        >
          <span aria-hidden="true" className="search-result-icon">
            {row.icon}
          </span>
          <span className="search-result-label">{row.label}</span>
        </button>
      ))}
    </div>
  );
}
