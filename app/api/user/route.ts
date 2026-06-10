import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import { getUserProfile, getUserStats, updateUserDisplayName } from "@/lib/users";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAuthenticatedRoute(request, async () => {
    const userId = getCurrentUserId();
    const [profile, stats] = await Promise.all([getUserProfile(userId), getUserStats(userId)]);
    return NextResponse.json({ profile, stats });
  });
}

export async function PATCH(request: Request) {
  return handleAuthenticatedRoute(request, async () => {
    const userId = getCurrentUserId();
    let body: { displayName?: unknown };
    try {
      body = (await request.json()) as { displayName?: unknown };
    } catch {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    if (typeof body.displayName !== "string") {
      return NextResponse.json({ error: "Укажите displayName" }, { status: 400 });
    }

    const profile = await updateUserDisplayName(userId, body.displayName);
    return NextResponse.json({ profile });
  });
}
