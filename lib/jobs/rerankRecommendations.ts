import { productCatalogToAvailabilityModels } from "@/lib/availability/catalogModels";
import { getCachedAvailabilitySummaries } from "@/lib/availability";
import { loadCachedRecommendationPriceSnapshots } from "@/lib/availability/priceSnapshots";
import { db, type UserProfileRecord } from "@/lib/db";
import { listDevInventoryItems, type MongoInventoryItem } from "@/lib/inventory/mongoInventory";
import { getCategoryRecommendations } from "@/lib/recommendation/categoryEngine";
import { rankProductsForInput } from "@/lib/recommendation/productEngine";
import {
  normalizeInventoryCategories,
  normalizeRoomConstraints,
  normalizeUserPreferences,
  normalizeUserProblems,
  type InventoryItem,
  type UserProfile,
} from "@/lib/recommendation/types";

export interface RerankRecommendationsResult {
  profileCount: number;
  recommendationCount: number;
}

function mapInventoryItem(item: MongoInventoryItem): InventoryItem {
  const category = normalizeInventoryCategories(item.category)[0] ?? "unknown";

  return {
    id: String(item._id),
    name: item.exactModel ?? ([item.brand, item.model].filter(Boolean).join(" ") || category),
    category,
    condition: item.condition.toLowerCase() as InventoryItem["condition"],
    painPoints: [],
  };
}

function mapProfile(record: UserProfileRecord): UserProfile {
  const roomConstraints = normalizeRoomConstraints(record.roomConstraints);

  return {
    id: record.id,
    name: record.name ?? "User",
    ageRange: record.ageRange ?? "Unknown",
    profession: record.profession,
    budgetUsd: Math.round(record.budgetCents / 100),
    spendingStyle: record.spendingStyle.toLowerCase() as UserProfile["spendingStyle"],
    preferences: normalizeUserPreferences(record.preferences),
    problems: normalizeUserProblems(record.problems),
    accessibilityNeeds: normalizeUserPreferences(record.accessibilityNeeds),
    roomConstraints,
    constraints: {
      deskWidthInches: roomConstraints.includes("limited_desk_width") ? 36 : 44,
      roomLighting: roomConstraints.includes("low_light") ? "low" : roomConstraints.includes("bright_lighting") ? "bright" : "mixed",
      sharesSpace: roomConstraints.includes("shared_space"),
      portableSetup: roomConstraints.includes("portable_setup"),
    },
  };
}

export async function rerankRecommendations(): Promise<RerankRecommendationsResult> {
  const profiles = await db.userProfile.findMany();
  const availabilityModels = productCatalogToAvailabilityModels();
  const [cachedAvailabilityByProductId, pricingByProductId] = await Promise.all([
    getCachedAvailabilitySummaries(availabilityModels),
    loadCachedRecommendationPriceSnapshots(availabilityModels),
  ]);
  const inventoryRecords = await listDevInventoryItems();
  const inventory = inventoryRecords.map(mapInventoryItem);
  let recommendationCount = 0;

  for (const profileRecord of profiles) {
    const profile = mapProfile(profileRecord);
    const input = {
      profile,
      inventory,
      usedItemsOkay: profileRecord.usedItemsOkay,
      exactCurrentModelsProvided: inventory.some((item) => item.name.trim().length > 0),
      availabilityByProductId: cachedAvailabilityByProductId,
      pricingByProductId,
    };
    const categories = getCategoryRecommendations(input);
    const products = rankProductsForInput(input);

    await db.recommendation.deleteMany({ where: { userProfileId: profile.id } });
    await db.recommendation.createMany({
      data: categories.slice(0, 8).map((category) => {
        const product = products.find((candidate) => candidate.product.category === category.category);
        recommendationCount += 1;

        return {
          userProfileId: profile.id,
          category: category.category,
          productModelId: product?.product.id,
          score: Math.round(product?.score ?? category.score),
          priority: category.priority.toUpperCase(),
          problemSolved: category.problemsAddressed[0] ?? "low_productivity",
          explanation: product?.explanation.problemSolved ?? category.explanation,
        };
      }),
    });
  }

  return {
    profileCount: profiles.length,
    recommendationCount,
  };
}
