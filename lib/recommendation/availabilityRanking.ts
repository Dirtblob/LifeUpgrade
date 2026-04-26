import type { AvailabilitySummary } from "@/lib/availability";
import type { ProductRecommendation } from "./types";

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function listingPriceCents(summary: AvailabilitySummary | undefined): number | null {
  return summary?.bestListing?.totalPriceCents ?? summary?.bestListing?.priceCents ?? null;
}

function availabilityStatus(summary: AvailabilitySummary | undefined): ProductRecommendation["availabilityStatus"] {
  if (summary?.status === "available") return "available";
  if (summary?.status === "unavailable") return "unavailable";
  return "unknown";
}

function productExpectedPriceCents(recommendation: ProductRecommendation): number {
  const cents = recommendation.product.estimatedPriceCents
    ?? recommendation.product.typicalUsedPriceCents
    ?? (recommendation.product.priceUsd > 0 ? recommendation.product.priceUsd * 100 : 0);
  return cents > 0 ? Math.round(cents) : 0;
}

function getSummary(
  availabilityByProductId: Map<string, AvailabilitySummary> | Record<string, AvailabilitySummary | undefined>,
  productId: string,
): AvailabilitySummary | undefined {
  if (availabilityByProductId instanceof Map) {
    return availabilityByProductId.get(productId);
  }

  return availabilityByProductId[productId];
}

export function scoreAvailabilityAdjustment(
  recommendation: ProductRecommendation,
  summary: AvailabilitySummary | undefined,
): number {
  if (!summary) return 0;
  if (summary.refreshSkippedReason === "free_tier_quota") return -4;
  if (summary.status === "unavailable") return -18;

  const bestPriceCents = listingPriceCents(summary);
  if (bestPriceCents === null) {
    return summary.refreshSource === "live" ? 2 : 0;
  }

  const expectedPriceCents = productExpectedPriceCents(recommendation);
  const priceDeltaRatio = (expectedPriceCents - bestPriceCents) / expectedPriceCents;
  const freshnessAdjustment = summary.refreshSource === "live" ? 4 : 1;

  return clampScore(50 + priceDeltaRatio * 28 + freshnessAdjustment) - 50;
}

export function rerankProductRecommendationsWithAvailability(
  recommendations: ProductRecommendation[],
  availabilityByProductId: Map<string, AvailabilitySummary> | Record<string, AvailabilitySummary | undefined>,
): ProductRecommendation[] {
  return recommendations
    .map((recommendation) => {
      const summary = getSummary(availabilityByProductId, recommendation.product.id);
      const bestPriceCents = listingPriceCents(summary);
      const adjustment = scoreAvailabilityAdjustment(recommendation, summary);
      const score = clampScore(recommendation.score + adjustment);

      return {
        ...recommendation,
        score,
        finalRecommendationScore: score,
        scoreBreakdown: {
          ...recommendation.scoreBreakdown,
          finalScore: score,
        },
        currentBestPriceCents: bestPriceCents ?? recommendation.currentBestPriceCents,
        priceDeltaFromExpected:
          bestPriceCents === null
            ? recommendation.priceDeltaFromExpected
            : bestPriceCents - productExpectedPriceCents(recommendation),
        lastCheckedAt: summary?.checkedAt ?? recommendation.lastCheckedAt,
        availabilityStatus: availabilityStatus(summary),
        rankingChangedReason:
          summary?.refreshSkippedReason === "free_tier_quota"
            ? "Using cached price data because the quota system limited a fresh refresh."
            : recommendation.rankingChangedReason,
      };
    })
    .sort((left, right) => {
      return (
        right.score - left.score ||
        (left.currentBestPriceCents ?? productExpectedPriceCents(left)) -
          (right.currentBestPriceCents ?? productExpectedPriceCents(right))
      );
    });
}
