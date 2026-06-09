import { NextResponse } from "next/server";
import { getCurrentUserId, getUserProfile, getUserStats } from "@/lib/users";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = getCurrentUserId();
    const [profile, stats] = await Promise.all([getUserProfile(userId), getUserStats(userId)]);
    return NextResponse.json({ profile, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected user load error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
