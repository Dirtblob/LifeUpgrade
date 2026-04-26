import { productCatalog } from "@/data/seeds/productCatalog";
import { getPricesApiProviderName } from "@/lib/availability/pricesApiProvider";
import { db, type RecommendationRecord } from "@/lib/db";
import { getGemmaProviderFromEnv } from "@/lib/llm/gemmaProvider";
import { buildPricesApiDashboardMetrics } from "@/lib/quota/dashboard";
import { getGeminiUsageSnapshot } from "@/lib/quota/geminiUsage";
import { getPricesApiUsageSnapshot } from "@/lib/quota/pricesApiQuota";
import { rerankProductRecommendationsWithAvailability } from "@/lib/recommendation/availabilityRanking";
import { rankProductsForInput } from "@/lib/recommendation/productEngine";
import { loadRecommendationContext } from "@/lib/userData";
import { readAdminDebugState } from "./debugState";

export interface CatalogHealthSummary {
  productCount: number;
  missingSpecsCount: number;
  missingSearchQueriesCount: number;
}

export interface RecommendationScoreChange {
  productId: string;
  productName: string;
  beforeScore: number;
  afterScore: number;
  delta: number;
  currentBestPriceCents: number | null;
  priceDeltaFromExpected: number | null;
  rankingChangedReason: string;
}

type RecommendationWithProfile = RecommendationRecord & {
  userProfile: {
    name: string | null;
    profession: string;
  } | null;
};

function hasSpecs(product: (typeof productCatalog)[number]): boolean {
  return Object.keys(product.features ?? {}).length > 0;
}

function hasSearchQueries(product: (typeof productCatalog)[number]): boolean {
  return Array.isArray(product.searchQueries) && product.searchQueries.length > 0;
}

export function summarizeCatalogHealth(
  catalog: typeof productCatalog = productCatalog,
): CatalogHealthSummary {
  return {
    productCount: catalog.length,
    missingSpecsCount: catalog.filter((product) => !hasSpecs(product)).length,
    missingSearchQueriesCount: catalog.filter((product) => !hasSearchQueries(product)).length,
  };
}

export async function buildAdminDashboardData() {
  const providerName = getPricesApiProviderName();
  const gemmaProvider = getGemmaProviderFromEnv();
  const now = new Date();
  const [
    quotaSnapshot,
    lastRefreshJob,
    latestRecommendations,
    recommendationContext,
    debugState,
    geminiUsage,
  ] = await Promise.all([
    getPricesApiUsageSnapshot(providerName, now),
    db.jobRun.findFirst({
      where: { jobName: "refreshPrices" },
      orderBy: { createdAt: "desc" },
    }),
    db.recommendation.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        userProfile: {
          select: {
            name: true,
            profession: true,
          },
        },
      },
    }) as Promise<RecommendationWithProfile[]>,
    loadRecommendationContext(),
    readAdminDebugState(),
    getGeminiUsageSnapshot(now),
  ]);

  let scoreChanges: RecommendationScoreChange[] = [];

  if (recommendationContext) {
    const input = {
      profile: recommendationContext.profile,
      inventory: recommendationContext.inventory,
      exactCurrentModelsProvided: recommendationContext.exactCurrentModelsProvided,
      usedItemsOkay: recommendationContext.usedItemsOkay,
      ports: recommendationContext.ports,
      deviceType: recommendationContext.deviceType,
      privateProfile: recommendationContext.privateProfile,
      candidateProducts: recommendationContext.candidateProducts,
      pricingByProductId: recommendationContext.pricingByProductId,
    } as const;
    const baseline = rankProductsForInput(input).slice(0, 16);
    const reranked = rerankProductRecommendationsWithAvailability(
      baseline,
      recommendationContext.availabilityByProductId,
    );
    const rerankedById = new Map(reranked.map((recommendation) => [recommendation.product.id, recommendation]));

    scoreChanges = baseline
      .map((recommendation) => {
        const updated = rerankedById.get(recommendation.product.id);
        if (!updated) return null;

        return {
          productId: recommendation.product.id,
          productName: recommendation.product.name,
          beforeScore: recommendation.score,
          afterScore: updated.score,
          delta: updated.score - recommendation.score,
          currentBestPriceCents: updated.currentBestPriceCents,
          priceDeltaFromExpected: updated.priceDeltaFromExpected,
          rankingChangedReason: updated.rankingChangedReason,
        } satisfies RecommendationScoreChange;
      })
      .filter((entry): entry is RecommendationScoreChange => Boolean(entry))
      .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || right.afterScore - left.afterScore)
      .slice(0, 5);
  }

  return {
    catalogHealth: summarizeCatalogHealth(),
    quotaSnapshot,
    quotaMetrics: buildPricesApiDashboardMetrics(quotaSnapshot, now),
    lastRefreshJob,
    latestRecommendations,
    scoreChanges,
    narratorStatus: {
      configured: Boolean(gemmaProvider),
      mode: gemmaProvider ? "Gemma configured" : "Fallback mode",
      usage: geminiUsage,
    },
    visionStatus: debugState.visionScan,
    latestNarrationErrors: debugState.latestNarrationErrors,
    lastBackgroundJobError: debugState.lastBackgroundJobError,
  };
}
