import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { runWithRequestUser } from "@/lib/request-context";

export class ApiUnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "ApiUnauthorizedError";
  }
}

function extractAccessToken(request: Request) {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;

  const url = new URL(request.url);
  return url.searchParams.get("access_token")?.trim() || null;
}

export async function resolveRequestUserId(request: Request) {
  const user = await resolveRequestUser(request);
  return user.id;
}

export async function resolveRequestUser(request: Request) {
  const token = extractAccessToken(request);
  if (!token) {
    throw new ApiUnauthorizedError("Missing access token.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase Auth is not configured.");
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user?.id) {
    throw new ApiUnauthorizedError("Invalid access token.");
  }

  return {
    id: data.user.id,
    email: data.user.email ?? null
  };
}

export type RequestUser = {
  id: string;
  email: string | null;
};

export async function runAsUser<T>(request: Request, fn: (user: RequestUser) => T | Promise<T>) {
  const user = await resolveRequestUser(request);
  return runWithRequestUser(user.id, () => fn(user), user.email);
}

export async function handleAuthenticatedRoute(
  request: Request,
  handler: (user: RequestUser) => Promise<Response>
) {
  try {
    return await runAsUser(request, handler);
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
