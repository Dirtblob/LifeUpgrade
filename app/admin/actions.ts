"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { productCatalog } from "@/data/seeds/productCatalog";
import { displayNameForMongoUser } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { getCurrentMongoUser } from "@/lib/devUser";
import { refreshPrices } from "@/lib/jobs/refreshPrices";
import { getPricesApiProviderName } from "@/lib/availability/pricesApiProvider";
import { deleteDevInventoryItems, replaceDevInventoryItems } from "@/lib/inventory/mongoInventory";
import { getPricesApiUsageSnapshot } from "@/lib/quota/pricesApiQuota";
import {
  buildHackathonDemoRecommendationInput,
  hackathonDemoInventoryRecords,
  serializeHackathonDemoProfile,
} from "@/lib/recommendation/demoMode";
import { rankProductsForInput } from "@/lib/recommendation/productEngine";
import { getCachedAvailabilitySummaries } from "@/lib/availability";
import { loadCachedRecommendationPriceSnapshots } from "@/lib/availability/priceSnapshots";
import { buildToastHref } from "@/lib/ui/toasts";
import { recordBackgroundJobError } from "@/lib/admin/debugState";
import { buildRecommendationNarrationId } from "@/lib/llm/explanationCache";
import { narrateRecommendation } from "@/lib/llm/recommendationNarrator";
import { getCategoryRecommendations } from "@/lib/recommendation/categoryEngine";

function priorityForScore(score: number): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 80) return "CRITICAL";
  if (score >= 65) return "HIGH";
  if (score >= 45) return "MEDIUM";
  return "LOW";
}

function revalidateAdminPaths(): void {
  revalidatePath("/");
  revalidatePath("/inventory");
  revalidatePath("/recommendations");
  revalidatePath("/settings");
  revalidatePath("/admin");
  revalidatePath("/admin/api-usage");
}

export async function runAdminDemoProfileAction(): Promise<void> {
  const mongoUser = await getCurrentMongoUser();
  const profileName = displayNameForMongoUser(mongoUser);
  const profileData = {
    ...serializeHackathonDemoProfile(),
    name: profileName,
  };
  const [availabilityByProductId, pricingByProductId] = await Promise.all([
    getCachedAvailabilitySummaries(productCatalog),
    loadCachedRecommendationPriceSnapshots(productCatalog),
  ]);
  const demoInput = buildHackathonDemoRecommendationInput();
  const recommendationInput = {
    ...demoInput,
    profile: {
      ...demoInput.profile,
      id: mongoUser.id,
      name: profileName,
    },
    availabilityByProductId,
    pricingByProductId,
  };
  const recommendations = rankProductsForInput(recommendationInput).slice(0, 8);

  await db.userProfile.upsert({
    where: { id: mongoUser.id },
    update: profileData,
    create: {
      id: mongoUser.id,
      ...profileData,
    },
  });

  await db.savedProduct.deleteMany({
    where: { userProfileId: mongoUser.id },
  });
  await db.watchlistAlert.deleteMany({
    where: { userProfileId: mongoUser.id },
  });
  await db.recommendation.deleteMany({
    where: { userProfileId: mongoUser.id },
  });

  if (recommendations.length > 0) {
    await db.recommendation.createMany({
      data: recommendations.map((recommendation) => ({
        userProfileId: mongoUser.id,
        category: recommendation.product.category,
        productModelId: recommendation.product.id,
        score: recommendation.score,
        priority: priorityForScore(recommendation.score),
        problemSolved: JSON.stringify(
          recommendationInput.profile.problems
            .filter((problem) => recommendation.product.solves.includes(problem))
            .slice(0, 4),
        ),
        explanation: recommendation.explanation.problemSolved,
      })),
    });
  }

  await replaceDevInventoryItems(
    hackathonDemoInventoryRecords.map((item) => ({
      ...item,
      brand: item.brand ?? "Unknown",
      catalogProductId: null,
      specsJson: null,
    })),
  );

  revalidateAdminPaths();
  redirect(buildToastHref("/admin", "demo_profile_ready"));
}

export async function runAdminPriceRefreshAction(): Promise<void> {
  const providerName = getPricesApiProviderName();
  const snapshot = await getPricesApiUsageSnapshot(providerName);
  const hasCapacity = snapshot.monthlyRemaining > 0 && snapshot.minuteRemaining > 0;

  if (!hasCapacity) {
    redirect(buildToastHref("/admin", "price_refresh_quota_blocked"));
  }

  try {
    const lowMonthlyQuota = snapshot.monthlyRemaining < 100;
    await refreshPrices();
    revalidateAdminPaths();
    redirect(buildToastHref("/admin", lowMonthlyQuota ? "price_refresh_low_quota" : "price_refresh_completed"));
  } catch (error) {
    await recordBackgroundJobError({
      jobName: "refreshPrices",
      message: error instanceof Error ? error.message : "Unknown refresh failure",
    });
    throw error;
  }
}

export async function testGemmaExplanationAction(): Promise<void> {
  const [availabilityByProductId, pricingByProductId] = await Promise.all([
    getCachedAvailabilitySummaries(productCatalog),
    loadCachedRecommendationPriceSnapshots(productCatalog),
  ]);
  const recommendationInput = {
    ...buildHackathonDemoRecommendationInput(),
    availabilityByProductId,
    pricingByProductId,
  };
  const categoryRecommendations = getCategoryRecommendations(recommendationInput);
  const productRecommendation = rankProductsForInput(recommendationInput)[0];

  if (!productRecommendation) {
    redirect(buildToastHref("/admin", "gemma_explanation_fallback", "info"));
  }

  const categoryRecommendation =
    categoryRecommendations.find((entry) => entry.category === productRecommendation.product.category) ?? {
      category: productRecommendation.product.category,
      score: productRecommendation.score,
      reasons: productRecommendation.reasons,
    };

  const result = await narrateRecommendation(
    {
      profile: recommendationInput.profile,
      inventory: recommendationInput.inventory,
      exactCurrentModelsProvided: recommendationInput.exactCurrentModelsProvided,
      categoryRecommendation,
      productRecommendation,
      availability: availabilityByProductId[productRecommendation.product.id],
    },
    {
      cache: {
        recommendationId: buildRecommendationNarrationId(recommendationInput.profile.id, categoryRecommendation.category),
      },
    },
  );

  revalidatePath("/admin");
  redirect(
    buildToastHref(
      "/admin",
      result.source === "gemma" ? "gemma_explanation_ready" : "gemma_explanation_fallback",
      result.source === "gemma" ? "success" : "info",
    ),
  );
}

export async function clearAdminDemoDataAction(): Promise<void> {
  const mongoUser = await getCurrentMongoUser();

  await db.$transaction([
    db.watchlistAlert.deleteMany({
      where: { userProfileId: mongoUser.id },
    }),
    db.savedProduct.deleteMany({
      where: { userProfileId: mongoUser.id },
    }),
    db.recommendation.deleteMany({
      where: { userProfileId: mongoUser.id },
    }),
    db.userProfile.deleteMany({
      where: { id: mongoUser.id },
    }),
  ]);
  await deleteDevInventoryItems();

  revalidateAdminPaths();
  redirect(buildToastHref("/admin", "profile_deleted"));
}
