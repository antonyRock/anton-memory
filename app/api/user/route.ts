import { NextResponse } from "next/server";
import {
  getUserProfile,
  getUserStats,
  updateUserDisplayName
} from "@/lib/users";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAuthenticatedRoute(request, async (user) => {
    const [profile, stats] = await Promise.all([
      getUserProfile(user.id, { email: user.email }),
      getUserStats(user.id)
    ]);
    return NextResponse.json({ profile, stats });
  });
}

export async function PATCH(request: Request) {
  return handleAuthenticatedRoute(request, async (user) => {
    let body: { displayName?: unknown };
    try {
      body = (await request.json()) as { displayName?: unknown };
    } catch {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    if (typeof body.displayName !== "string") {
      return NextResponse.json({ error: "Укажите displayName" }, { status: 400 });
    }

    const profile = await updateUserDisplayName(user.id, body.displayName);
    return NextResponse.json({ profile });
  });
}
