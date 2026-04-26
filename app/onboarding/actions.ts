"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { displayNameForMongoUser } from "@/lib/currentUser";
import { getCurrentMongoUser } from "@/lib/devUser";
import { replaceDevInventoryItems } from "@/lib/inventory/mongoInventory";
import {
  buildRoomConstraints,
  demoOnboardingValues,
  type OnboardingActionResult,
  type OnboardingFormValues,
  validateOnboardingValues,
} from "@/lib/onboarding";

function serializeProfile(values: OnboardingFormValues, name: string) {
  return {
    name,
    ageRange: values.ageRange,
    profession: values.profession.trim(),
    budgetCents: Math.round(Number(values.budgetAmount) * 100),
    spendingStyle: values.spendingStyle,
    usedItemsOkay: values.usedItemsOkay,
    accessibilityNeeds: JSON.stringify([]),
    preferences: JSON.stringify(values.preferences),
    problems: JSON.stringify(values.problems),
    roomConstraints: JSON.stringify(buildRoomConstraints(values)),
  };
}

async function createProfile(
  values: OnboardingFormValues,
  options?: {
    demo?: boolean;
  },
): Promise<OnboardingActionResult> {
  const errors = validateOnboardingValues(values);

  if (Object.keys(errors).length > 0) {
    return {
      success: false,
      errors,
      error: "A few fields still need attention.",
    };
  }

  try {
    const mongoUser = await getCurrentMongoUser();
    const profileData = serializeProfile(values, displayNameForMongoUser(mongoUser));
    const profile = await db.userProfile.upsert({
      where: { id: mongoUser.id },
      update: profileData,
      create: {
        id: mongoUser.id,
        ...profileData,
      },
    });
    if (!profile) {
      throw new Error("Failed to save onboarding profile.");
    }

    await db.recommendation.deleteMany({
      where: { userProfileId: profile.id },
    });
    await db.savedProduct.deleteMany({
      where: { userProfileId: profile.id },
    });
    await db.watchlistAlert.deleteMany({
      where: { userProfileId: profile.id },
    });

    if (options?.demo) {
      await replaceDevInventoryItems([
        {
          category: "laptop",
          brand: "Campus setup",
          model: "13-inch laptop",
          exactModel: "Laptop-only student setup",
          catalogProductId: null,
          specsJson: null,
          condition: "GOOD",
          ageYears: null,
          notes: "Laptop-only setup for classes, coding labs, and study sessions.",
          source: "DEMO",
        },
      ]);
    }

    revalidatePath("/onboarding");
    revalidatePath("/inventory");
    revalidatePath("/recommendations");
    revalidatePath("/settings");
    revalidatePath("/alerts");

    return {
      success: true,
      profileId: profile.id,
    };
  } catch (error) {
    console.error("Failed to save onboarding profile", error);

    return {
      success: false,
      error: "We couldn't save the profile just now. Please try again.",
    };
  }
}

export async function saveOnboardingProfile(
  values: OnboardingFormValues,
): Promise<OnboardingActionResult> {
  return createProfile(values);
}

export async function createDemoOnboardingProfile(): Promise<OnboardingActionResult> {
  return createProfile(demoOnboardingValues, { demo: true });
}
