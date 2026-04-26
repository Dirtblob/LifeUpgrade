import { NextResponse } from "next/server";
import { getCurrentUserProfileRecord } from "@/lib/currentUser";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await getCurrentUserProfileRecord();
    if (!profile) {
      return NextResponse.json({ unreadCount: 0, configured: true });
    }

    const unreadCount = await db.watchlistAlert.count({
      where: {
        userProfileId: profile.id,
        seen: false,
      },
    });

    return NextResponse.json({ unreadCount, configured: true });
  } catch (error) {
    console.warn("Failed to load unread alert count.", error);
    return NextResponse.json({ unreadCount: 0, configured: false });
  }
}
