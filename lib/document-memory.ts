import { chatModel, getOpenAI } from "@/lib/openai";
import { getSupabase } from "@/lib/supabase";
import type { RawCell } from "@/lib/spreadsheet-parse";
import { saveExtractedMemory, type MemoryExtraction } from "@/lib/memory";
import { getCurrentUserId } from "@/lib/current-user";

type DocumentMemoryInput = {
  id: string | number;
  file_name: string;
  file_type: string;
  extracted_text: string;
  summary: string | null;
  metadata: Record<string, unknown>;
};

function spreadsheetCellFacts(
  fileName: string,
  documentId: string | number,
  cells: RawCell[]
) {
  return cells.slice(0, 400).map((cell) => ({
    content: `Файл «${fileName}», лист «${cell.sheet_name}»: ячейка ${cell.cell_address} (столбец ${cell.column}, строка ${cell.row}) = ${cell.formatted_value}`,
    metadata: {
      document_id: documentId,
      sheet_name: cell.sheet_name,
      cell_address: cell.cell_address,
      column: cell.column,
      row: cell.row,
      source: "spreadsheet_cell"
    }
  }));
}

function normalizeExtraction(value: unknown): MemoryExtraction {
  const input = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const facts = Array.isArray(input.facts)
    ? input.facts
        .filter((item) => typeof item === "object" && item !== null)
        .map((item) => ({
          content: String((item as Record<string, unknown>).content ?? "").trim()
        }))
        .filter((item) => item.content.length > 0)
    : [];

  const entities = Array.isArray(input.entities)
    ? input.entities
        .filter((item) => typeof item === "object" && item !== null)
        .map((item) => {
          const record = item as Record<string, unknown>;
          return {
            name: String(record.name ?? "").trim(),
            type: typeof record.type === "string" ? record.type : undefined,
            description: typeof record.description === "string" ? record.description : undefined
          };
        })
        .filter((item) => item.name.length > 0)
    : [];

  const tasks = Array.isArray(input.tasks)
    ? input.tasks
        .filter((item) => typeof item === "object" && item !== null)
        .map((item) => {
          const record = item as Record<string, unknown>;
          return {
            title: String(record.title ?? "").trim(),
            status: typeof record.status === "string" ? record.status : undefined,
            description: typeof record.description === "string" ? record.description : undefined
          };
        })
        .filter((item) => item.title.length > 0)
    : [];

  return { facts, entities, tasks };
}

async function extractMemoryWithModel(document: DocumentMemoryInput): Promise<MemoryExtraction> {
  const text = document.extracted_text.slice(0, 12_000);
  if (!text || text.startsWith("[Image file:")) {
    return { facts: [], entities: [], tasks: [] };
  }

  try {
    const result = await getOpenAI().chat.completions.create({
      model: chatModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Extract durable facts, entities, and tasks from an uploaded file.",
            "Facts: concrete values, numbers, dates, names, cell values, key statements.",
            "Entities: companies, people, projects, products, devices.",
            "Tasks: action items, deadlines, todos found in the file.",
            "Do not invent data absent from the file text.",
            "Return JSON: facts [{content}], entities [{name,type,description}], tasks [{title,status,description}].",
            "Use empty arrays when nothing durable is present."
          ].join(" ")
        },
        {
          role: "user",
          content: [
            `File: ${document.file_name}`,
            document.summary ? `Summary: ${document.summary}` : null,
            "Extracted content:",
            text
          ]
            .filter(Boolean)
            .join("\n")
        }
      ]
    });

    return normalizeExtraction(JSON.parse(result.choices[0]?.message.content ?? "{}"));
  } catch (error) {
    console.error("Document memory extraction failed:", error);
    return { facts: [], entities: [], tasks: [] };
  }
}

export async function extractAndSaveDocumentMemory(document: DocumentMemoryInput) {
  const metadata = document.metadata ?? {};
  const kind = String(metadata.kind ?? "");
  let extraction: MemoryExtraction = { facts: [], entities: [], tasks: [] };

  if (kind === "spreadsheet" && Array.isArray(metadata.non_empty_cells)) {
    const cells = metadata.non_empty_cells as RawCell[];
    extraction.facts = spreadsheetCellFacts(document.file_name, document.id, cells).map((fact) => ({
      content: fact.content
    }));
  }

  const modelExtraction = await extractMemoryWithModel(document);
  extraction = {
    facts: [...(extraction.facts ?? []), ...(modelExtraction.facts ?? [])],
    entities: modelExtraction.entities ?? [],
    tasks: modelExtraction.tasks ?? []
  };

  if (
    (extraction.facts?.length ?? 0) === 0 &&
    (extraction.entities?.length ?? 0) === 0 &&
    (extraction.tasks?.length ?? 0) === 0
  ) {
    return;
  }

  await saveExtractedMemory(extraction, { documentId: document.id, fileName: document.file_name });
}

export async function getDocumentLinkedMemoryForPrompt(
  documentIds: Array<string | number>,
  query: string
) {
  if (documentIds.length === 0 && !query.trim()) return "";

  const supabase = getSupabase();
  const userId = getCurrentUserId();
  const idSet = new Set(documentIds.map(String));
  const sections: string[] = [];

  const [factsResult, entitiesResult, tasksResult] = await Promise.all([
    supabase
      .from("facts")
      .select("content, fact, metadata")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("entities")
      .select("name, type, description, metadata")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("tasks")
      .select("title, status, description, metadata")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100)
  ]);

  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/[^a-zа-яё0-9]+/i).filter((term) => term.length >= 2);
  const asksAboutFile = /(?:файл|таблиц|excel|xlsx|csv|лист|непуст|ячей|столбец|строк|sheet|cell)/i.test(
    query
  );

  function matchesDocument(record: Record<string, unknown>) {
    const metadata =
      typeof record.metadata === "object" && record.metadata !== null
        ? (record.metadata as Record<string, unknown>)
        : {};
    const docId = metadata.document_id != null ? String(metadata.document_id) : "";
    return Boolean(docId && idSet.has(docId));
  }

  function matchesQuery(text: string) {
    const lower = text.toLowerCase();
    if (!query.trim()) return true;
    if (asksAboutFile) return true;
    return queryTerms.some((term) => lower.includes(term));
  }

  const facts = (factsResult.data ?? []).filter(
    (record) => matchesDocument(record) && matchesQuery(String(record.content ?? record.fact ?? ""))
  );
  const entities = (entitiesResult.data ?? []).filter(
    (record) =>
      matchesDocument(record) &&
      matchesQuery(`${record.name ?? ""} ${record.description ?? ""}`)
  );
  const tasks = (tasksResult.data ?? []).filter(
    (record) =>
      matchesDocument(record) &&
      matchesQuery(`${record.title ?? ""} ${record.description ?? ""}`)
  );

  if (facts.length) {
    sections.push(
      `Facts from uploaded files:\n${facts
        .slice(0, 20)
        .map((record, index) => `${index + 1}. ${String(record.content ?? record.fact ?? "")}`)
        .join("\n")}`
    );
  }
  if (entities.length) {
    sections.push(
      `Entities from uploaded files:\n${entities
        .slice(0, 12)
        .map(
          (record, index) =>
            `${index + 1}. ${record.name}${record.type ? ` (${record.type})` : ""}${record.description ? `: ${record.description}` : ""}`
        )
        .join("\n")}`
    );
  }
  if (tasks.length) {
    sections.push(
      `Tasks from uploaded files:\n${tasks
        .slice(0, 10)
        .map(
          (record, index) =>
            `${index + 1}. ${record.title}${record.status ? ` [${record.status}]` : ""}${record.description ? `: ${record.description}` : ""}`
        )
        .join("\n")}`
    );
  }

  return sections.join("\n\n");
}

export async function searchDocumentIdsByQuery(query: string, limit = 5) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((term) => term.length >= 2)
    .slice(0, 6);

  const numericTerms = query.match(/\d{2,}/g) ?? [];
  const searchTerms = [...new Set([...terms, ...numericTerms])];
  if (searchTerms.length === 0) return [];

  const supabase = getSupabase();
  const found = new Set<string>();

  for (const term of searchTerms) {
    const pattern = `%${term}%`;
    const { data } = await supabase
      .from("documents")
      .select("id")
      .eq("user_id", getCurrentUserId())
      .or(`file_name.ilike.${pattern},summary.ilike.${pattern},extracted_text.ilike.${pattern}`)
      .order("created_at", { ascending: false })
      .limit(limit * 2);

    for (const row of data ?? []) {
      found.add(String(row.id));
      if (found.size >= limit) break;
    }
    if (found.size >= limit) break;
  }

  return [...found];
}
