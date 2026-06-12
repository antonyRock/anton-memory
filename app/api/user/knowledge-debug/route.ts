import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

type ScopeCount = {
  scoped: number | null;
  legacy: number | null;
  scopedError: string | null;
  legacyError: string | null;
};

export async function GET(request: Request) {
  return handleAuthenticatedRoute(request, async (user) => {
    const [documents, facts, entities, tasks, links] = await Promise.all([
      countWithScopes("documents", user.id),
      countWithScopes("facts", user.id),
      countWithScopes("entities", user.id),
      countWithScopes("tasks", user.id),
      linksWithScopes(user.id)
    ]);

    return NextResponse.json({
      userId: user.id,
      knowledgeDebug: {
        documents,
        facts,
        entities,
        tasks,
        links
      }
    });
  });
}

async function countWithScopes(
  table: "documents" | "facts" | "entities" | "tasks",
  userId: string
): Promise<ScopeCount> {
  const supabase = getSupabase();
  const scoped = await supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
  const legacy = await supabase.from(table).select("id", { count: "exact", head: true });

  return {
    scoped: scoped.error ? null : (scoped.count ?? 0),
    legacy: legacy.error ? null : (legacy.count ?? 0),
    scopedError: scoped.error?.message ?? null,
    legacyError: legacy.error?.message ?? null
  };
}

async function linksWithScopes(userId: string) {
  const scoped = await collectLinks({
    useUserFilter: true,
    userId
  });
  const legacy = await collectLinks({
    useUserFilter: false,
    userId
  });

  return {
    scoped: scoped.error ? null : scoped.count,
    legacy: legacy.error ? null : legacy.count,
    scopedError: scoped.error ?? null,
    legacyError: legacy.error ?? null
  };
}

async function collectLinks(input: { useUserFilter: boolean; userId: string }) {
  const supabase = getSupabase();
  const pageSize = 500;
  const links = new Set<string>();
  let offset = 0;

  while (true) {
    const query = input.useUserFilter
      ? supabase
          .from("messages")
          .select("content")
          .eq("user_id", input.userId)
          .range(offset, offset + pageSize - 1)
      : supabase
          .from("messages")
          .select("content")
          .range(offset, offset + pageSize - 1);
    const { data, error } = await query;

    if (error) {
      return { count: 0, error: error.message };
    }

    const rows = data ?? [];
    for (const row of rows) {
      for (const match of String(row.content ?? "").match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []) {
        links.add(match.trim().replace(/[),.;!?]+$/g, ""));
      }
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return { count: links.size, error: null as string | null };
}
