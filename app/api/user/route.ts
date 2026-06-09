import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import { getUserProfile, getUserStats } from "@/lib/users";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAuthenticatedRoute(request, async () => {
    const userId = getCurrentUserId();
    const [profile, stats] = await Promise.all([getUserProfile(userId), getUserStats(userId)]);
    return NextResponse.json({ profile, stats });
  });
}
