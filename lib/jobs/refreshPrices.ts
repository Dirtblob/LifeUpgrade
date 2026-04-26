import { productCatalog } from "@/data/seeds/productCatalog";
import {
  getAvailabilitySummaries,
  getCachedAvailabilitySummaries,
  type AvailabilityRefreshSkipReason,
  type AvailabilitySummary,
} from "@/lib/availability";
import { catalogProductToAvailabilityModel } from "@/lib/availability/catalogModels";
import { selectProductsForRefresh } from "@/lib/jobs/selectProductsForRefresh";
import { getPricesApiProviderName, isPricesApiConfigured } from "@/lib/availability/pricesApiProvider";
import { db } from "@/lib/db";
import { rerankRecommendations } from "@/lib/jobs/rerankRecommendations";
import { createWatchlistAlerts } from "@/lib/jobs/watchlistAlerts";
import { getPricesApiUsageSnapshot } from "@/lib/quota/pricesApiQuota";

export interface JobRunSummary {
  productsEligible: number;
  productsChecked: number;
  productsSkippedDueToQuota: number;
  apiCallsUsed: number;
  pricesApiCallsUsed: number;
  remainingMonthlyCalls: number;
  remainingDailyCalls: number;
  remainingMinuteCalls: number;
  availableCount: number;
  summaries: Record<string, AvailabilitySummary>;
  recommendationCount: number;
  alertsCreated: number;
  jobRunId: string;
}

export type RefreshPricesResult = JobRunSummary;

function catalogToAvailabilityModel(product: (typeof productCatalog)[number]) {
  return {
    ...catalogProductToAvailabilityModel(product),
  };
}

function withCachedSkipReason(
  summary: AvailabilitySummary | undefined,
  productModelId: string,
  refreshSkippedReason: AvailabilityRefreshSkipReason,
): AvailabilitySummary {
  if (summary) {
    return {
      ...summary,
      refreshSource: "cached",
      refreshSkippedReason,
    };
  }

  return {
    provider: null,
    productModelId,
    status: "checking_not_configured",
    label: "Availability unknown",
    listings: [],
    bestListing: null,
    checkedAt: null,
    refreshSource: "cached",
    refreshSkippedReason,
  };
}

export async function refreshPrices(
  products = productCatalog,
  options: { persistSnapshots?: boolean; forceRefresh?: boolean } = { persistSnapshots: true, forceRefresh: true },
): Promise<JobRunSummary> {
  const models = products.map(catalogToAvailabilityModel);
  const currentDate = new Date();
  const providerName = getPricesApiProviderName();
  const configuredProvider = (process.env.AVAILABILITY_PROVIDER?.trim().toLowerCase() ?? "mock") || "mock";
  const usesPricesApi =
    isPricesApiConfigured() && (configuredProvider === providerName || configuredProvider === "pricesapi" || configuredProvider === "priceapi");
  const initialQuota = await getPricesApiUsageSnapshot(providerName, currentDate);
  const refreshProductIds = await selectProductsForRefresh({
    currentDate,
    remainingQuota: {
      dailyRemaining: initialQuota.monthlyRemaining,
      monthlyRemaining: initialQuota.monthlyRemaining,
    },
    provider: providerName,
    candidateProductIds: models.map((model) => model.id),
  });
  const cachedSummaries = await getCachedAvailabilitySummaries(models);
  const refreshProductIdSet = new Set(refreshProductIds);
  const summaries = new Map<string, AvailabilitySummary>(
    models.map((model) => [
      model.id,
      refreshProductIdSet.has(model.id)
        ? cachedSummaries[model.id]
        : withCachedSkipReason(cachedSummaries[model.id], model.id, "refresh_window"),
    ]),
  );
  const modelsById = new Map(models.map((model) => [model.id, model]));
  let productsChecked = 0;
  let productsSkippedDueToQuota = 0;

  for (const [index, productId] of refreshProductIds.entries()) {
    const model = modelsById.get(productId);

    if (!model) {
      continue;
    }

    if (usesPricesApi) {
      const quotaBeforeCall = await getPricesApiUsageSnapshot(providerName, new Date());
      if (quotaBeforeCall.monthlyRemaining <= 0 || quotaBeforeCall.minuteRemaining <= 0) {
        const remainingProductIds = refreshProductIds.slice(index);
        productsSkippedDueToQuota = remainingProductIds.length;

        remainingProductIds.forEach((remainingProductId) => {
          summaries.set(
            remainingProductId,
            withCachedSkipReason(cachedSummaries[remainingProductId], remainingProductId, "free_tier_quota"),
          );
        });
        break;
      }
    }

    const liveSummaries = await getAvailabilitySummaries([model], {
      persistSnapshots: options.persistSnapshots,
      forceRefresh: options.forceRefresh,
      refreshProductIds: [model.id],
    });

    summaries.set(model.id, liveSummaries[model.id]);
    productsChecked += 1;
  }

  const finalSummaries = Object.fromEntries(models.map((model) => [model.id, summaries.get(model.id) ?? cachedSummaries[model.id]]));
  const rerankResult = await rerankRecommendations();
  const alertsCreated = await createWatchlistAlerts({
    previousSummaries: cachedSummaries,
    currentSummaries: finalSummaries,
  });
  const finalQuota = await getPricesApiUsageSnapshot(providerName, new Date());
  const availableCount = Object.values(finalSummaries).filter((summary) => summary.status === "available").length;
  const apiCallsUsed = Math.max(0, finalQuota.monthlyCallsUsed - initialQuota.monthlyCallsUsed);
  const pricesApiCallsUsed = apiCallsUsed;
  const jobRun = await db.jobRun.create({
    data: {
      jobName: "refreshPrices",
      status: "COMPLETED",
      productsEligible: refreshProductIds.length,
      productsChecked,
      productsSkippedDueToQuota,
      apiCallsUsed,
      pricesApiCallsUsed,
      remainingMonthlyCalls: finalQuota.monthlyRemaining,
      remainingDailyCalls: finalQuota.monthlyRemaining,
      remainingMinuteCalls: finalQuota.minuteRemaining,
    },
  });

  return {
    productsEligible: refreshProductIds.length,
    productsChecked,
    productsSkippedDueToQuota,
    apiCallsUsed,
    pricesApiCallsUsed,
    remainingMonthlyCalls: finalQuota.monthlyRemaining,
    remainingDailyCalls: finalQuota.monthlyRemaining,
    remainingMinuteCalls: finalQuota.minuteRemaining,
    availableCount,
    summaries: finalSummaries,
    recommendationCount: rerankResult.recommendationCount,
    alertsCreated,
    jobRunId: jobRun.id,
  };
}
