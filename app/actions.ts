"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCachedAvailabilitySummaries } from "@/lib/availability";
import { maybeAutoRefreshTopRecommendationPrice } from "@/lib/availability/autoRefresh";
import { loadCachedRecommendationPriceSnapshots } from "@/lib/availability/priceSnapshots";
import { displayNameForMongoUser } from "@/lib/currentUser";
import { getCurrentMongoUser } from "@/lib/devUser";
import { replaceDevInventoryItems } from "@/lib/inventory/mongoInventory";
import { recommendationProductToAvailabilityModel } from "@/lib/recommendation/mongoDeviceProducts";
import { productCatalog } from "@/data/seeds/productCatalog";
import {
  buildHackathonDemoRecommendationInput,
  hackathonDemoInventoryRecords,
  serializeHackathonDemoProfile,
} from "@/lib/recommendation/demoMode";
import { rankProductsForInput } from "@/lib/recommendation/productEngine";
import { saveRecommendationRunLog } from "@/lib/recommendation/recommendationLogs";
import { buildToastHref } from "@/lib/ui/toasts";
import { getCurrentUserPrivateProfile } from "@/lib/userPrivateProfiles";

const DEMO_WATCHED_PRODUCT_ID = "stand-nexstand-k2";
const DEMO_WATCHED_PRODUCT_TARGET_CENTS = 2500;
const DEMO_WATCHED_PRODUCT_OLD_PRICE_CENTS = 4499;

function priorityForScore(score: number): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 80) return "CRITICAL";
  if (score >= 65) return "HIGH";
  if (score >= 45) return "MEDIUM";
  return "LOW";
}

export async function runLaptopOnlyStudentDemoAction(): Promise<void> {
  const mongoUser = await getCurrentMongoUser();
  const profileName = displayNameForMongoUser(mongoUser);
  const profileData = {
    ...serializeHackathonDemoProfile(),
    name: profileName,
  };
  const candidateProducts = productCatalog;
  const availabilityProductModels = candidateProducts.map((product) =>
    recommendationProductToAvailabilityModel(product, { allowUsed: true }),
  );
  const availabilityModelsByProductId = new Map(availabilityProductModels.map((productModel) => [productModel.id, productModel]));
  let [availabilityByProductId, pricingByProductId] = await Promise.all([
    getCachedAvailabilitySummaries(availabilityProductModels),
    loadCachedRecommendationPriceSnapshots(availabilityProductModels),
  ]);
  const demoInput = buildHackathonDemoRecommendationInput();
  const recommendationInput = {
    ...demoInput,
    profile: {
      ...demoInput.profile,
      id: mongoUser.id,
      name: profileName,
    },
    candidateProducts,
    availabilityByProductId,
    pricingByProductId,
  };
  const privateProfile = await getCurrentUserPrivateProfile();
  let recommendations = rankProductsForInput(recommendationInput).slice(0, 8);
  const refreshedTopPrice = await maybeAutoRefreshTopRecommendationPrice({
    productModel: availabilityModelsByProductId.get(recommendations[0]?.product.id ?? ""),
    availabilityByProductId,
    userId: mongoUser.id,
  });

  if (refreshedTopPrice) {
    availabilityByProductId = {
      ...availabilityByProductId,
      [refreshedTopPrice.productModelId]: refreshedTopPrice.availabilitySummary,
    };
    pricingByProductId = refreshedTopPrice.priceSnapshot
      ? {
          ...pricingByProductId,
          [refreshedTopPrice.productModelId]: refreshedTopPrice.priceSnapshot,
        }
      : pricingByProductId;
    recommendations = rankProductsForInput({
      ...recommendationInput,
      availabilityByProductId,
      pricingByProductId,
    }).slice(0, 8);
  }
  const watchedRecommendation =
    recommendations.find((recommendation) => recommendation.product.id === DEMO_WATCHED_PRODUCT_ID) ??
    recommendations.find((recommendation) => recommendation.product.category === "laptop_stand") ??
    recommendations[0];
  const watchedProduct = watchedRecommendation?.product;

  await saveRecommendationRunLog({
    userId: mongoUser.id,
    inventory: recommendationInput.inventory,
    recommendations,
    allowRecommendationHistory: privateProfile?.privacy.allowRecommendationHistory ?? true,
    privateTextRedactions: [
      recommendationInput.profile.ageRange,
      recommendationInput.profile.profession,
      privateProfile?.profession,
    ].filter((value): value is string => Boolean(value?.trim())),
  });

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

  if (watchedRecommendation && watchedProduct) {
    await db.savedProduct.create({
      data: {
        userProfileId: mongoUser.id,
        productModelId: watchedRecommendation.product.id,
        targetPriceCents: DEMO_WATCHED_PRODUCT_TARGET_CENTS,
        notifyThreshold: 80,
      },
    });

    await db.availabilitySnapshot.deleteMany({
      where: {
        productModelId: watchedRecommendation.product.id,
        provider: "mock",
      },
    });
    await db.availabilitySnapshot.create({
      data: {
        productModelId: watchedRecommendation.product.id,
        provider: "mock",
        title: `${watchedProduct.name} older demo listing`,
        brand: watchedProduct.brand,
        model: watchedProduct.name,
        retailer: "Mock Marketplace",
        available: true,
        priceCents: DEMO_WATCHED_PRODUCT_OLD_PRICE_CENTS,
        totalPriceCents: DEMO_WATCHED_PRODUCT_OLD_PRICE_CENTS,
        url: `https://mock-marketplace.example/listings/${watchedRecommendation.product.id}-demo-old`,
        condition: "new",
        confidence: 88,
        checkedAt: new Date(Date.now() - 1000 * 60 * 60 * 14),
      },
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

  revalidatePath("/");
  revalidatePath("/inventory");
  revalidatePath("/recommendations");
  revalidatePath("/alerts");
  revalidatePath("/admin/api-usage");
  redirect(buildToastHref("/recommendations", "recommendations_ready"));
}
