"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentMongoUser } from "@/lib/devUser";
import { deleteDevInventoryItems } from "@/lib/inventory/mongoInventory";
import { buildToastHref } from "@/lib/ui/toasts";

function revalidateLocalProfileViews(): void {
  revalidatePath("/");
  revalidatePath("/onboarding");
  revalidatePath("/inventory");
  revalidatePath("/recommendations");
  revalidatePath("/settings");
  revalidatePath("/alerts");
}

export async function deleteLocalProfileAction(): Promise<void> {
  const user = await getCurrentMongoUser();

  await Promise.all([
    deleteDevInventoryItems(),
    db.userProfile.deleteMany({
      where: { id: user.id },
    }),
  ]);

  revalidateLocalProfileViews();
  redirect(buildToastHref("/onboarding", "profile_deleted"));
}

export async function deleteLocalInventoryAction(): Promise<void> {
  const user = await getCurrentMongoUser();

  await Promise.all([
    deleteDevInventoryItems(),
    db.recommendation.deleteMany({
      where: { userProfileId: user.id },
    }),
    db.savedProduct.deleteMany({
      where: { userProfileId: user.id },
    }),
    db.watchlistAlert.deleteMany({
      where: { userProfileId: user.id },
    }),
  ]);

  revalidateLocalProfileViews();
  redirect(buildToastHref("/settings", "inventory_deleted"));
}
