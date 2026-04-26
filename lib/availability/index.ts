import { db } from "@/lib/db";
import { getBestBuyProvider } from "./bestBuyProvider";
import { isFreshPriceCheck } from "./cachePolicy";
import { mockAvailabilityProvider } from "./mockProvider";
import { compareAvailabilityResults } from "./offerMatcher";
import { getPricesApiProvider, getPricesApiProviderName, isPricesApiQuotaLimitedError } from "./pricesApiProvider";
import type { AvailabilityProductModel, AvailabilityProvider, AvailabilityResult, AvailabilitySummary } from "./types";

export type {
  AvailabilityProductModel,
  AvailabilityProvider,
  AvailabilityRefreshSkipReason,
  AvailabilityResult,
  AvailabilitySummary,
} from "./types";

const availabilityProviders: Record<string, AvailabilityProvider> = {
  mock: mockAvailabilityProvider,
};

interface GetAvailabilitySummariesOptions {
  persistSnapshots?: boolean;
  provider?: AvailabilityProvider | null;
  manualRefresh?: boolean;
  forceRefresh?: boolean;
  refreshProductIds?: string[];
}

interface CachedSnapshot {
  productModelId: string;
  provider: string;
  title: string;
  brand: string | null;
  model: string | null;
  retailer: string | null;
  available: boolean;
  priceCents: number | null;
  shippingCents: number | null;
  totalPriceCents: number | null;
  condition: string | null;
  url: string | null;
  imageUrl: string | null;
  confidence: number | null;
  checkedAt: Date;
}

function getConfiguredProvider(
  options: Pick<GetAvailabilitySummariesOptions, "manualRefresh" | "forceRefresh"> = {},
): AvailabilityProvider | null {
  const configuredProvider = process.env.AVAILABILITY_PROVIDER?.toLowerCase() ?? "mock";
  const pricesApiProviderName = getPricesApiProviderName();

  if (configuredProvider === "none" || configuredProvider === "disabled") {
    return null;
  }

  if (configuredProvider === pricesApiProviderName || configuredProvider === "pricesapi" || configuredProvider === "priceapi") {
    return getPricesApiProvider({
      manualRefresh: options.manualRefresh,
      forceRefresh: options.forceRefresh,
    }) ?? mockAvailabilityProvider;
  }

  if (configuredProvider === "bestbuy" || configuredProvider === "best_buy") {
    return getBestBuyProvider({
      forceRefresh: options.forceRefresh,
    }) ?? mockAvailabilityProvider;
  }

  return availabilityProviders[configuredProvider] ?? null;
}

function buildCheckingSummary(
  productModelId: string,
  options: Pick<AvailabilitySummary, "refreshSource" | "refreshSkippedReason"> = {
    refreshSource: "not_configured",
  },
): AvailabilitySummary {
  return {
    provider: null,
    productModelId,
    status: "checking_not_configured",
    label: "Availability unknown",
    listings: [],
    bestListing: null,
    checkedAt: null,
    refreshSource: options.refreshSource,
    refreshSkippedReason: options.refreshSkippedReason,
    isStale: false,
  };
}

function chooseBestListing(listings: AvailabilityResult[]): AvailabilityResult | null {
  return [...listings].filter((listing) => listing.available).sort(compareAvailabilityResults)[0] ?? null;
}

function summarizeResults(
  productModelId: string,
  providerName: string,
  listings: AvailabilityResult[],
  checkedAt: Date,
  options: Pick<AvailabilitySummary, "refreshSource" | "refreshSkippedReason">,
): AvailabilitySummary {
  const sortedListings = [...listings].sort(compareAvailabilityResults);
  const bestListing = chooseBestListing(sortedListings);

  return {
    provider: providerName,
    productModelId,
    status: bestListing ? "available" : "unavailable",
    label: bestListing ? "Available" : "Unavailable",
    listings: sortedListings,
    bestListing,
    checkedAt,
    refreshSource: options.refreshSource,
    refreshSkippedReason: options.refreshSkippedReason,
    isStale: false,
  };
}

function mapSnapshotsToSummary(
  productModelId: string,
  snapshots: CachedSnapshot[],
  options: Pick<AvailabilitySummary, "refreshSource" | "refreshSkippedReason">,
): AvailabilitySummary {
  const latestSnapshot = snapshots[0];
  const listings = snapshots
    .filter((snapshot) => snapshot.available || snapshot.url !== null || snapshot.priceCents !== null)
    .map((snapshot) => {
      return {
        provider: snapshot.provider,
        productModelId,
        title: snapshot.title,
        brand: snapshot.brand ?? "Unknown",
        model: snapshot.model ?? productModelId,
        retailer: snapshot.retailer ?? snapshot.provider,
        available: snapshot.available,
        priceCents: snapshot.priceCents ?? 0,
        shippingCents: snapshot.shippingCents ?? undefined,
        totalPriceCents: snapshot.totalPriceCents ?? snapshot.priceCents ?? 0,
        condition: snapshot.condition ?? "unknown",
        url: snapshot.url ?? "#",
        imageUrl: snapshot.imageUrl ?? undefined,
        confidence: snapshot.confidence ?? 0,
        checkedAt: snapshot.checkedAt,
      } satisfies AvailabilityResult;
    })
    .sort(compareAvailabilityResults);

  return {
    provider: latestSnapshot.provider,
    productModelId,
    status: chooseBestListing(listings) ? "available" : "unavailable",
    label: chooseBestListing(listings) ? "Available" : "Unavailable",
    listings,
    bestListing: chooseBestListing(listings),
    checkedAt: latestSnapshot.checkedAt,
    refreshSource: options.refreshSource,
    refreshSkippedReason: options.refreshSkippedReason,
    isStale: !isFreshPriceCheck(latestSnapshot.checkedAt),
  };
}

async function loadSnapshotGroups(
  productModelIds: string[],
  preferredProvider?: string,
): Promise<Map<string, CachedSnapshot[]>> {
  if (productModelIds.length === 0) {
    return new Map();
  }

  const preferredSnapshots = preferredProvider
    ? await db.availabilitySnapshot.findMany({
        where: {
          provider: preferredProvider,
          productModelId: {
            in: productModelIds,
          },
        },
        orderBy: { checkedAt: "desc" },
      })
    : [];
  const groupedPreferred = new Map<string, CachedSnapshot[]>();

  for (const snapshot of preferredSnapshots) {
    const grouped = groupedPreferred.get(snapshot.productModelId);

    if (!grouped) {
      groupedPreferred.set(snapshot.productModelId, [snapshot]);
      continue;
    }

    if (grouped[0]?.checkedAt.getTime() === snapshot.checkedAt.getTime()) {
      grouped.push(snapshot);
    }
  }

  const missingProductIds = productModelIds.filter((productModelId) => !groupedPreferred.has(productModelId));
  if (missingProductIds.length === 0) {
    return groupedPreferred;
  }

  const fallbackSnapshots = await db.availabilitySnapshot.findMany({
    where: {
      productModelId: {
        in: missingProductIds,
      },
    },
    orderBy: { checkedAt: "desc" },
  });

  for (const snapshot of fallbackSnapshots) {
    const grouped = groupedPreferred.get(snapshot.productModelId);

    if (!grouped) {
      groupedPreferred.set(snapshot.productModelId, [snapshot]);
      continue;
    }

    if (grouped[0]?.checkedAt.getTime() === snapshot.checkedAt.getTime()) {
      grouped.push(snapshot);
    }
  }

  return groupedPreferred;
}

export async function getCachedAvailabilitySummaries(
  productModels: AvailabilityProductModel[],
  options: Pick<GetAvailabilitySummariesOptions, "provider"> = {},
): Promise<Record<string, AvailabilitySummary>> {
  const preferredProvider = options.provider?.name;
  const snapshotGroups = await loadSnapshotGroups(
    productModels.map((productModel) => productModel.id),
    preferredProvider,
  );

  return Object.fromEntries(
    productModels.map((productModel) => {
      const snapshots = snapshotGroups.get(productModel.id);
      if (!snapshots || snapshots.length === 0) {
        return [productModel.id, buildCheckingSummary(productModel.id, { refreshSource: "cached", refreshSkippedReason: "cache_only" })];
      }

      return [
        productModel.id,
        mapSnapshotsToSummary(productModel.id, snapshots, {
          refreshSource: "cached",
          refreshSkippedReason: "cache_only",
        }),
      ];
    }),
  );
}

async function persistSummaries(
  productModels: AvailabilityProductModel[],
  summaries: Map<string, AvailabilitySummary>,
): Promise<void> {
  const snapshotRows: Array<{
    productModelId: string;
    provider: string;
    title: string;
    brand: string | null;
    model: string | null;
    retailer: string | null;
    available: boolean;
    priceCents: number | null;
    shippingCents: number | null;
    totalPriceCents: number | null;
    condition: string | null;
    url: string | null;
    imageUrl: string | null;
    confidence: number | null;
    checkedAt: Date;
  }> = [];

  productModels.forEach((productModel) => {
    const summary = summaries.get(productModel.id);
    if (!summary?.provider || !summary.checkedAt || summary.refreshSource !== "live") {
      return;
    }

    if (summary.listings.length === 0) {
      snapshotRows.push({
        productModelId: productModel.id,
        provider: summary.provider,
        title: `No listings found for ${productModel.displayName ?? productModel.id}`,
        brand: productModel.brand,
        model: productModel.model ?? productModel.displayName ?? productModel.id,
        retailer: null,
        available: false,
        priceCents: null,
        shippingCents: null,
        totalPriceCents: null,
        condition: null,
        url: null,
        imageUrl: null,
        confidence: 0,
        checkedAt: summary.checkedAt,
      });
      return;
    }

    summary.listings.forEach((listing) => {
      snapshotRows.push({
        productModelId: listing.productModelId,
        provider: listing.provider,
        title: listing.title,
        brand: listing.brand,
        model: listing.model,
        retailer: listing.retailer,
        available: listing.available,
        priceCents: listing.priceCents,
        shippingCents: listing.shippingCents ?? null,
        totalPriceCents: listing.totalPriceCents,
        condition: listing.condition,
        url: listing.url,
        imageUrl: listing.imageUrl ?? null,
        confidence: listing.confidence,
        checkedAt: listing.checkedAt,
      });
    });
  });

  if (snapshotRows.length === 0) {
    return;
  }

  await db.availabilitySnapshot.createMany({
    data: snapshotRows,
  });
}

function cachedOrCheckingSummary(
  productModelId: string,
  cachedSummary: AvailabilitySummary | undefined,
  refreshSkippedReason: NonNullable<AvailabilitySummary["refreshSkippedReason"]>,
): AvailabilitySummary {
  return cachedSummary?.checkedAt
    ? {
        ...cachedSummary,
        refreshSource: "cached",
        refreshSkippedReason,
      }
    : buildCheckingSummary(productModelId, {
        refreshSource: "cached",
        refreshSkippedReason,
      });
}

export async function getAvailabilitySummaries(
  productModels: AvailabilityProductModel[],
  options: GetAvailabilitySummariesOptions = {},
): Promise<Record<string, AvailabilitySummary>> {
  const provider = Object.prototype.hasOwnProperty.call(options, "provider")
    ? options.provider ?? null
    : getConfiguredProvider({ manualRefresh: options.manualRefresh, forceRefresh: options.forceRefresh });
  const cachedSummaries = await getCachedAvailabilitySummaries(productModels, { provider: provider ?? undefined });
  const refreshProductIds = new Set(options.refreshProductIds ?? productModels.map((productModel) => productModel.id));

  if (!provider) {
    return Object.fromEntries(
      productModels.map((productModel) => [
        productModel.id,
        cachedSummaries[productModel.id] ?? buildCheckingSummary(productModel.id),
      ]),
    );
  }

  const isRateLimitedProvider = provider.name === getPricesApiProviderName() || provider.name === "bestbuy";
  const summarizeProductModel = async (productModel: AvailabilityProductModel) => {
    const cachedSummary = cachedSummaries[productModel.id];
    const isRefreshEligible = refreshProductIds.has(productModel.id);

    if (!isRefreshEligible) {
      return [
        productModel.id,
        cachedOrCheckingSummary(productModel.id, cachedSummary, "refresh_window"),
      ] as const;
    }

    try {
      const startedAt = new Date();
      const response = await provider.search(productModel);
      const listings = response.listings;
      const checkedAt = response.checkedAt ?? listings[0]?.checkedAt ?? startedAt;

      return [
        productModel.id,
        {
          ...summarizeResults(productModel.id, provider.name, listings, checkedAt, {
            refreshSource: response.refreshSource,
            refreshSkippedReason: response.refreshSkippedReason,
          }),
          isStale: response.isStale ?? false,
        },
      ] as const;
    } catch (error) {
      if (isPricesApiQuotaLimitedError(error)) {
        return [
          productModel.id,
          cachedOrCheckingSummary(productModel.id, cachedSummary, "free_tier_quota"),
        ] as const;
      }

      throw error;
    }
  };
  const summaryEntries = isRateLimitedProvider
    ? []
    : await Promise.all(productModels.map((productModel) => summarizeProductModel(productModel)));

  if (isRateLimitedProvider) {
    for (const productModel of productModels) {
      summaryEntries.push(await summarizeProductModel(productModel));
    }
  }

  const summaries = new Map(summaryEntries);

  if (options.persistSnapshots) {
    await persistSummaries(productModels, summaries);
  }

  return Object.fromEntries(summaryEntries);
}
