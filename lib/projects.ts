import { getSupabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/current-user";

export type Project = {
  id: string | number;
  title: string;
  description: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type ProjectDocument = {
  id: string | number;
  file_name: string;
  file_type: string;
  file_size: number;
  created_at: string;
  metadata: Record<string, unknown>;
};

function isMissingProjectsSchema(message?: string) {
  return Boolean(message && /projects|project_id|schema cache/i.test(message));
}

export async function listProjects() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select("id, title, description, metadata, created_at, updated_at")
    .eq("user_id", getCurrentUserId())
    .order("updated_at", { ascending: false })
    .limit(50);

  if (isMissingProjectsSchema(error?.message)) return [];
  if (error) throw new Error(`Could not load projects: ${error.message}`);
  return (data ?? []) as Project[];
}

export async function createProject(input: { title?: string; description?: string | null }) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      title: input.title?.trim() || "Новый проект",
      description: input.description?.trim() || null,
      user_id: getCurrentUserId()
    })
    .select("id, title, description, metadata, created_at, updated_at")
    .single();

  if (isMissingProjectsSchema(error?.message)) {
    throw new Error("Projects table is missing. Run supabase/projects_migration.sql first.");
  }
  if (error) throw new Error(`Could not create project: ${error.message}`);
  return data as Project;
}

export async function getProjectView(projectId: string | number) {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, title, description, metadata, created_at, updated_at")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (projectError) {
    if (isMissingProjectsSchema(projectError.message)) {
      throw new Error("Projects table is missing. Run supabase/projects_migration.sql first.");
    }
    throw new Error(`Could not load project: ${projectError.message}`);
  }

  const [conversationsResult, documentsResult] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title, summary, metadata, created_at, updated_at, project_id")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("documents")
      .select("id, file_name, file_type, file_size, created_at, metadata")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100)
  ]);

  if (conversationsResult.error && !isMissingProjectsSchema(conversationsResult.error.message)) {
    throw new Error(`Could not load project conversations: ${conversationsResult.error.message}`);
  }
  if (documentsResult.error && !isMissingProjectsSchema(documentsResult.error.message)) {
    throw new Error(`Could not load project documents: ${documentsResult.error.message}`);
  }

  const documents = (documentsResult.data ?? []) as ProjectDocument[];
  const files = documents.filter((document) => !isImageDocument(document));
  const images = documents.filter((document) => isImageDocument(document));

  return {
    project: project as Project,
    conversations: conversationsResult.data ?? [],
    files,
    images
  };
}

export async function updateProject(
  projectId: string | number,
  input: { title?: string; description?: string | null }
) {
  const supabase = getSupabase();
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };
  if (input.title != null) payload.title = input.title.trim() || "Новый проект";
  if (input.description !== undefined) payload.description = input.description;

  const { data, error } = await supabase
    .from("projects")
    .update(payload)
    .eq("id", projectId)
    .eq("user_id", getCurrentUserId())
    .select("id, title, description, metadata, created_at, updated_at")
    .single();

  if (isMissingProjectsSchema(error?.message)) {
    throw new Error("Projects table is missing. Run supabase/projects_migration.sql first.");
  }
  if (error) throw new Error(`Could not update project: ${error.message}`);
  return data as Project;
}

export async function deleteProject(projectId: string | number) {
  const supabase = getSupabase();
  const userId = getCurrentUserId();

  const unassignConversations = await supabase
    .from("conversations")
    .update({ project_id: null, updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("user_id", userId);

  if (
    unassignConversations.error &&
    !isMissingProjectsSchema(unassignConversations.error.message) &&
    !/project_id/i.test(unassignConversations.error.message)
  ) {
    throw new Error(`Could not unassign project chats: ${unassignConversations.error.message}`);
  }

  await supabase
    .from("documents")
    .update({ project_id: null })
    .eq("project_id", projectId)
    .eq("user_id", userId);

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", userId);
  if (isMissingProjectsSchema(error?.message)) {
    throw new Error("Projects table is missing. Run supabase/projects_migration.sql first.");
  }
  if (error) throw new Error(`Could not delete project: ${error.message}`);
}

export async function assignConversationToProject(
  conversationId: string | number,
  projectId: string | number | null
) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("conversations")
    .update({
      project_id: projectId,
      updated_at: new Date().toISOString()
    })
    .eq("id", conversationId)
    .eq("user_id", getCurrentUserId())
    .select("id, title, summary, metadata, created_at, updated_at, project_id")
    .single();

  if (error && /project_id/i.test(error.message)) {
    const fallback = await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("user_id", getCurrentUserId())
      .select("id, title, summary, metadata, created_at, updated_at")
      .single();
    if (fallback.error) {
      throw new Error(`Could not assign conversation to project: ${fallback.error.message}`);
    }
    return { ...fallback.data, project_id: projectId } as {
      id: string | number;
      title: string | null;
      summary: string | null;
      metadata?: Record<string, unknown> | null;
      created_at: string;
      updated_at: string;
      project_id: typeof projectId;
    };
  }

  if (error) {
    if (isMissingProjectsSchema(error.message)) {
      throw new Error("Projects support is missing. Run supabase/projects_migration.sql first.");
    }
    throw new Error(`Could not assign conversation to project: ${error.message}`);
  }

  return data;
}

export function isImageDocument(document: Pick<ProjectDocument, "file_type" | "metadata">) {
  const kind = document.metadata?.kind;
  return (
    document.file_type.startsWith("image/") ||
    kind === "image" ||
    kind === "generated_image"
  );
}

export async function searchProjects(pattern: string, limit = 10) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select("id, title, description, created_at, updated_at")
    .eq("user_id", getCurrentUserId())
    .or(`title.ilike.${pattern},description.ilike.${pattern}`)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (isMissingProjectsSchema(error?.message)) return [];
  if (error) throw new Error(`Could not search projects: ${error.message}`);
  return data ?? [];
}
