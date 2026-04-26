import { productCatalog } from "@/data/seeds/productCatalog";
import type { AvailabilitySummary } from "@/lib/availability";
import { db, type UserProfileRecord } from "@/lib/db";
import { listDevInventoryItems, type MongoInventoryItem } from "@/lib/inventory/mongoInventory";
import { rerankProductRecommendationsWithAvailability } from "@/lib/recommendation/availabilityRanking";
import { getCategoryRecommendations } from "@/lib/recommendation/categoryEngine";
import { getProductRecommendations } from "@/lib/recommendation/productEngine";
import { buildWatchlistAlertDrafts } from "@/lib/recommendation/watchlistAlertRules";
import {
  normalizeInventoryCategories,
  normalizeRoomConstraints,
  normalizeUserPreferences,
  normalizeUserProblems,
  type InventoryItem,
  type ProductCategory,
  type RecommendationInput,
  type UserProfile,
} from "@/lib/recommendation/types";
import { productIdAliases } from "@/lib/userData";

interface CreateWatchlistAlertsOptions {
  previousSummaries: Record<string, AvailabilitySummary>;
  currentSummaries: Record<string, AvailabilitySummary>;
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

function findCatalogProduct(productModelId: string) {
  return productIdAliases(productModelId)
    .map((alias) => productCatalog.find((product) => product.id === alias))
    .find((product) => product !== undefined);
}

function getSummary(
  summaries: Record<string, AvailabilitySummary>,
  productModelId: string,
): AvailabilitySummary | undefined {
  return productIdAliases(productModelId)
    .map((alias) => summaries[alias])
    .find((summary) => summary !== undefined);
}

function getListingPrice(summary: AvailabilitySummary | undefined): number | null {
  return summary?.bestListing?.totalPriceCents ?? summary?.bestListing?.priceCents ?? null;
}

function findRecommendationRank(
  productModelId: string,
  recommendations: Array<{ product: { id: string }; score: number }>,
): { rank: number | null; score: number | null } {
  const aliases = new Set(productIdAliases(productModelId));
  const index = recommendations.findIndex((recommendation) => aliases.has(recommendation.product.id));

  if (index < 0) {
    return {
      rank: null,
      score: null,
    };
  }

  return {
    rank: index + 1,
    score: recommendations[index]?.score ?? null,
  };
}

function buildRecommendationInput(
  profileRecord: UserProfileRecord,
  inventoryRecords: MongoInventoryItem[],
): RecommendationInput {
  const profile = mapProfile(profileRecord);
  const inventory = inventoryRecords.map(mapInventoryItem);

  return {
    profile,
    inventory,
    usedItemsOkay: profileRecord.usedItemsOkay,
    exactCurrentModelsProvided: inventory.some((item) => item.name.trim().length > 0),
  };
}

export async function createWatchlistAlerts({
  previousSummaries,
  currentSummaries,
}: CreateWatchlistAlertsOptions): Promise<number> {
  const profiles = await db.userProfile.findMany({
    include: {
      savedProducts: true,
    },
  }) as Array<UserProfileRecord & { savedProducts: Array<{ id: string; productModelId: string; targetPriceCents: number | null }> }>;
  const inventoryRecords = await listDevInventoryItems();
  const alertRows: Array<{
    userProfileId: string;
    savedProductId: string;
    productModelId: string;
    title: string;
    message: string;
    oldPriceCents: number | null;
    newPriceCents: number;
    thresholdCents: number | null;
    scoreAtAlert: number;
    provider: string;
    url: string | null;
  }> = [];

  for (const profileRecord of profiles) {
    if (profileRecord.savedProducts.length === 0) {
      continue;
    }

    const recommendationInput = buildRecommendationInput(profileRecord, inventoryRecords);
    const categoryRecommendations = getCategoryRecommendations(recommendationInput);
    const watchedCategories = new Set<ProductCategory>();

    for (const savedProduct of profileRecord.savedProducts) {
      const catalogProduct = findCatalogProduct(savedProduct.productModelId);

      if (catalogProduct) {
        watchedCategories.add(catalogProduct.category);
      }
    }

    const previousRankingsByCategory = new Map<ProductCategory, ReturnType<typeof getProductRecommendations>>();
    const currentRankingsByCategory = new Map<ProductCategory, ReturnType<typeof getProductRecommendations>>();

    for (const category of watchedCategories) {
      const categoryRecommendation = categoryRecommendations.find((recommendation) => recommendation.category === category);

      if (!categoryRecommendation) {
        continue;
      }

      const recommendations = getProductRecommendations(recommendationInput, categoryRecommendation, productCatalog);
      previousRankingsByCategory.set(
        category,
        rerankProductRecommendationsWithAvailability(recommendations, previousSummaries),
      );
      currentRankingsByCategory.set(
        category,
        rerankProductRecommendationsWithAvailability(recommendations, currentSummaries),
      );
    }

    for (const savedProduct of profileRecord.savedProducts) {
      const catalogProduct = findCatalogProduct(savedProduct.productModelId);
      const currentSummary = getSummary(currentSummaries, savedProduct.productModelId);
      const currentPriceCents = getListingPrice(currentSummary);

      if (!catalogProduct || !currentSummary?.bestListing || currentPriceCents === null) {
        continue;
      }

      const previousSummary = getSummary(previousSummaries, savedProduct.productModelId);
      const previousRankInfo = findRecommendationRank(
        savedProduct.productModelId,
        previousRankingsByCategory.get(catalogProduct.category) ?? [],
      );
      const currentRankInfo = findRecommendationRank(
        savedProduct.productModelId,
        currentRankingsByCategory.get(catalogProduct.category) ?? [],
      );
      const drafts = buildWatchlistAlertDrafts({
        productName: catalogProduct.name,
        previousAvailable: previousSummary?.status === "available",
        currentAvailable: currentSummary.status === "available",
        previousPriceCents: getListingPrice(previousSummary),
        currentPriceCents,
        targetPriceCents: savedProduct.targetPriceCents,
        previousScore: previousRankInfo.score,
        currentScore: currentRankInfo.score,
        previousRank: previousRankInfo.rank,
        currentRank: currentRankInfo.rank,
        provider: currentSummary.provider ?? currentSummary.bestListing.provider,
        url: currentSummary.bestListing.url ?? null,
      });

      drafts.forEach((draft) => {
        alertRows.push({
          userProfileId: profileRecord.id,
          savedProductId: savedProduct.id,
          productModelId: catalogProduct.id,
          title: draft.title,
          message: draft.message,
          oldPriceCents: draft.oldPriceCents,
          newPriceCents: draft.newPriceCents,
          thresholdCents: draft.thresholdCents,
          scoreAtAlert: draft.scoreAtAlert,
          provider: draft.provider,
          url: draft.url,
        });
      });
    }
  }

  if (alertRows.length === 0) {
    return 0;
  }

  await db.watchlistAlert.createMany({
    data: alertRows,
  });

  // Future delivery channels can fan these rows out to email and push providers.
  return alertRows.length;
}
