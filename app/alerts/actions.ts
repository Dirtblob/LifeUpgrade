"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUserProfileRecord } from "@/lib/currentUser";
import { db } from "@/lib/db";

export async function markAlertSeenAction(formData: FormData): Promise<void> {
  const alertId = String(formData.get("alertId") ?? "").trim();

  if (!alertId) {
    redirect("/alerts");
  }

  const profile = await getCurrentUserProfileRecord();
  if (!profile) {
    redirect("/alerts");
  }

  await db.watchlistAlert.updateMany({
    where: {
      id: alertId,
      userProfileId: profile.id,
    },
    data: { seen: true },
  });

  revalidatePath("/alerts");
  revalidatePath("/");
  redirect("/alerts");
}
