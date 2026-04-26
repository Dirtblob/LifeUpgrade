import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  findPriceSnapshot,
  isPriceSnapshotExpired,
  normalizePriceSnapshotQuery,
  type PriceSnapshotDocument,
} from "@/lib/availability/priceSnapshots";
import { getBestBuyProvider, isBestBuyConfigured } from "@/lib/availability/bestBuyProvider";
import {
  getPricesApiProvider,
  isPricesApiConfigured,
  isPricesApiQuotaLimitedError,
} from "@/lib/availability/pricesApiProvider";
import type {
  LivePriceOfferDetails,
  PricesCheckQuotaSummary,
  PricesCheckResponse,
  PricesCheckStatus,
} from "@/lib/availability/livePrice";
import type { AvailabilityProductModel, AvailabilityResult, AvailabilitySearchResponse } from "@/lib/availability/types";
import { getCurrentMongoUser, UnauthorizedMongoUserError } from "@/lib/devUser";
import { findMongoDeviceByIdentifier } from "@/lib/devices/mongoDeviceCatalog";
import { getPricesApiUsageSnapshot } from "@/lib/quota/pricesApiQuota";
import { productCatalog } from "@/data/seeds/productCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRICES_API_PROVIDER = "pricesapi";
const PRICES_API_LOOKUP_REQUEST_COST = 2;

interface PricesCheckRequestBody {
  deviceCatalogId?: unknown;
  slug?: unknown;
  forceRefresh?: unknown;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function authEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() && env.CLERK_SECRET_KEY?.trim());
}

function positiveIntegerFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

function buildQuery(device: { brand: string; model: string; variant?: string | null }): string {
  return [device.brand, device.model, device.variant ?? undefined].filter(Boolean).join(" ").trim();
}

function cacheSlug(device: { slug?: string; id: string; _id: string }, requestedSlug: string | null): string {
  return requestedSlug ?? device.slug ?? device.id ?? device._id;
}

function catalogEstimateCents(device: {
  estimatedPriceCents: number;
  typicalUsedPriceCents?: number;
}): number | null {
  const estimate = device.estimatedPriceCents || device.typicalUsedPriceCents || 0;
  return estimate > 0 ? estimate : null;
}

function toOfferDetails(offer: {
  retailer?: string;
  seller?: string;
  title: string;
  priceCents: number;
  totalPriceCents: number;
  url: string;
  condition?: string;
}): LivePriceOfferDetails {
  return {
    seller: offer.seller ?? offer.retailer ?? "Unknown seller",
    title: offer.title,
    priceCents: offer.priceCents,
    totalPriceCents: offer.totalPriceCents,
    url: offer.url,
    condition: offer.condition,
  };
}

function offersFromSnapshot(snapshot: Pick<PriceSnapshotDocument, "offers">): LivePriceOfferDetails[] {
  return snapshot.offers.map((offer) => toOfferDetails({
    seller: offer.retailer,
    title: offer.title,
    priceCents: offer.priceCents,
    totalPriceCents: offer.totalPriceCents,
    url: offer.url,
    condition: offer.condition,
  }));
}

function offersFromListings(listings: AvailabilityResult[]): LivePriceOfferDetails[] {
  return listings.map((listing) => toOfferDetails({
    seller: listing.retailer,
    title: listing.title,
    priceCents: listing.priceCents,
    totalPriceCents: listing.totalPriceCents,
    url: listing.url,
    condition: listing.condition,
  }));
}

function estimateMarketPriceCentsFromOffers(offers: LivePriceOfferDetails[]): number | null {
  const prices = offers
    .map((offer) => offer.totalPriceCents)
    .filter((price) => Number.isFinite(price))
    .sort((left, right) => left - right);

  if (prices.length === 0) {
    return null;
  }

  const middle = Math.floor(prices.length / 2);
  if (prices.length % 2 === 1) {
    return prices[middle] ?? null;
  }

  const left = prices[middle - 1];
  const right = prices[middle];
  if (left === undefined || right === undefined) {
    return prices[0] ?? null;
  }

  return Math.round((left + right) / 2);
}

function toQuotaSummary(snapshot: Awaited<ReturnType<typeof getPricesApiUsageSnapshot>>): PricesCheckQuotaSummary {
  return {
    requestsUsedThisMinute: snapshot.minuteCallsUsed,
    requestsUsedThisMonth: snapshot.monthlyCallsUsed,
    remainingMinuteRequests: snapshot.minuteRemaining,
    remainingMonthlyRequests: snapshot.monthlyRemaining,
    limitPerMinute: snapshot.policy.limitPerMinute,
    limitPerMonth: snapshot.policy.limitPerMonth,
  };
}

async function safeQuotaSummary(): Promise<PricesCheckQuotaSummary> {
  try {
    return toQuotaSummary(await getPricesApiUsageSnapshot(PRICES_API_PROVIDER));
  } catch {
    const limitPerMinute = positiveIntegerFromEnv(process.env.PRICES_API_LIMIT_PER_MINUTE, 10);
    const limitPerMonth = positiveIntegerFromEnv(process.env.PRICES_API_LIMIT_PER_MONTH, 1000);

    return {
      requestsUsedThisMinute: 0,
      requestsUsedThisMonth: 0,
      remainingMinuteRequests: limitPerMinute,
      remainingMonthlyRequests: limitPerMonth,
      limitPerMinute,
      limitPerMonth,
    };
  }
}

function responseFromSnapshot(
  status: Extract<PricesCheckStatus, "fresh" | "cached" | "stale" | "quota_limited" | "error">,
  snapshot: PriceSnapshotDocument,
  quota: PricesCheckQuotaSummary,
  fallbackEstimateCents: number | null,
  message?: string | null,
  error?: string | null,
): PricesCheckResponse {
  const offers = offersFromSnapshot(snapshot);

  return {
    status,
    bestOffer: snapshot.bestOffer ? toOfferDetails({
      seller: snapshot.bestOffer.retailer,
      title: snapshot.bestOffer.title,
      priceCents: snapshot.bestOffer.priceCents,
      totalPriceCents: snapshot.bestOffer.totalPriceCents,
      url: snapshot.bestOffer.url,
      condition: snapshot.bestOffer.condition,
    }) : null,
    offers,
    offerCount: snapshot.offerCount,
    estimatedMarketPriceCents: snapshot.estimatedMarketPriceCents ?? fallbackEstimateCents,
    fetchedAt: snapshot.fetchedAt.toISOString(),
    expiresAt: snapshot.expiresAt.toISOString(),
    quota,
    message: message ?? null,
    error: error ?? snapshot.error ?? null,
  };
}

function responseFromListings(
  status: PricesCheckStatus,
  searchResponse: AvailabilitySearchResponse,
  quota: PricesCheckQuotaSummary,
  fallbackEstimateCents: number | null,
  message?: string | null,
  error?: string | null,
): PricesCheckResponse {
  const offers = offersFromListings(searchResponse.listings);
  const bestOffer = offers[0] ?? null;

  return {
    status,
    bestOffer,
    offers,
    offerCount: offers.length,
    estimatedMarketPriceCents: estimateMarketPriceCentsFromOffers(offers) ?? fallbackEstimateCents,
    fetchedAt: searchResponse.checkedAt.toISOString(),
    expiresAt: null,
    quota,
    message: message ?? null,
    error: error ?? null,
  };
}

function emptyResponse(
  status: Extract<PricesCheckStatus, "quota_limited" | "error">,
  quota: PricesCheckQuotaSummary,
  fallbackEstimateCents: number | null,
  message: string,
  error?: string | null,
): PricesCheckResponse {
  return {
    status,
    bestOffer: null,
    offers: [],
    offerCount: 0,
    estimatedMarketPriceCents: fallbackEstimateCents,
    fetchedAt: null,
    expiresAt: null,
    quota,
    message,
    error: error ?? null,
  };
}

function preferredSnapshot(
  latestSnapshot: PriceSnapshotDocument | null,
  cachedSnapshot: PriceSnapshotDocument | null,
): PriceSnapshotDocument | null {
  return latestSnapshot ?? cachedSnapshot;
}

interface ResolvedDevice {
  _id: string;
  id: string;
  slug?: string;
  brand: string;
  model: string;
  variant?: string | null;
  displayName: string;
  category: string;
  estimatedPriceCents: number;
  typicalUsedPriceCents?: number;
  extraSearchQueries?: string[];
}

function buildAvailabilityModel(device: ResolvedDevice): AvailabilityProductModel {
  const query = buildQuery(device);
  return {
    id: device._id,
    brand: device.brand,
    model: device.model,
    displayName: device.displayName,
    category: device.category,
    estimatedPriceCents: catalogEstimateCents(device) ?? undefined,
    searchQueries: [query, ...(device.extraSearchQueries ?? [])],
    allowUsed: true,
    deviceCatalogId: device.id,
    slug: device.slug ?? device.id,
  };
}

function findStaticCatalogProduct(identifier: string): ResolvedDevice | null {
  const entry = productCatalog.find((p) => p.id === identifier);
  if (!entry) return null;

  return {
    _id: entry.id,
    id: entry.id,
    brand: entry.brand,
    model: entry.model,
    displayName: entry.displayName,
    category: entry.category,
    estimatedPriceCents: entry.estimatedPriceCents,
    extraSearchQueries: entry.searchQueries,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: PricesCheckRequestBody;

  try {
    body = (await request.json()) as PricesCheckRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const deviceCatalogId = stringValue(body.deviceCatalogId);
  const slug = stringValue(body.slug);
  const forceRefresh = booleanValue(body.forceRefresh);
  const identifier = deviceCatalogId ?? slug;

  if (!identifier) {
    return NextResponse.json({ error: "deviceCatalogId or slug is required." }, { status: 400 });
  }

  try {
    if (authEnabled()) {
      const { userId } = await auth();
      if (!userId) {
        return unauthorizedResponse();
      }
    }

    const device: ResolvedDevice | null =
      (await findMongoDeviceByIdentifier(identifier)) ?? findStaticCatalogProduct(identifier);
    if (!device) {
      return NextResponse.json({ error: "Could not find that catalog device." }, { status: 404 });
    }

    const query = buildQuery(device);
    if (!query) {
      return NextResponse.json({ error: "That catalog device cannot be priced right now." }, { status: 400 });
    }

    const normalizedQuery = normalizePriceSnapshotQuery(query);
    const snapshotSlug = cacheSlug(device, slug);
    const fallbackEstimateCents = catalogEstimateCents(device);

    const [cachedSnapshot, quotaBefore] = await Promise.all([
      findPriceSnapshot({
        slug: snapshotSlug,
        normalizedQueries: [query, normalizedQuery],
      }),
      getPricesApiUsageSnapshot(PRICES_API_PROVIDER),
    ]);
    const quotaSummaryBefore = toQuotaSummary(quotaBefore);

    if (cachedSnapshot && !isPriceSnapshotExpired(cachedSnapshot) && !forceRefresh) {
      return NextResponse.json(responseFromSnapshot("cached", cachedSnapshot, quotaSummaryBefore, fallbackEstimateCents));
    }

    if (cachedSnapshot && isPriceSnapshotExpired(cachedSnapshot) && !forceRefresh) {
      return NextResponse.json(responseFromSnapshot("stale", cachedSnapshot, quotaSummaryBefore, fallbackEstimateCents));
    }

    const mongoUser = await getCurrentMongoUser();

    // Try PricesAPI first, then fall back to Best Buy
    let provider = isPricesApiConfigured()
      ? getPricesApiProvider({ manualRefresh: true, forceRefresh, userId: mongoUser.id })
      : null;

    const quotaAllowsLive = quotaBefore.minuteRemaining >= PRICES_API_LOOKUP_REQUEST_COST
      && quotaBefore.monthlyRemaining >= PRICES_API_LOOKUP_REQUEST_COST;
    if (provider && !quotaAllowsLive) {
      provider = null;
    }

    if (!provider && isBestBuyConfigured()) {
      provider = getBestBuyProvider({ forceRefresh });
    }

    if (!provider) {
      const message = "Live pricing is not configured. Showing cached/catalog estimate.";
      if (cachedSnapshot) {
        return NextResponse.json(
          responseFromSnapshot("error", cachedSnapshot, quotaSummaryBefore, fallbackEstimateCents, message, "No pricing provider is configured."),
        );
      }

      return NextResponse.json(
        emptyResponse("error", quotaSummaryBefore, fallbackEstimateCents, message, "No pricing provider is configured."),
      );
    }

    const availabilityModel = buildAvailabilityModel(device);

    let searchResponse: AvailabilitySearchResponse;
    try {
      searchResponse = await provider.search(availabilityModel);
    } catch (error) {
      const quotaAfterError = await safeQuotaSummary();
      const latestSnapshot = await findPriceSnapshot({
        slug: snapshotSlug,
        normalizedQueries: [query, normalizedQuery],
      });

      if (isPricesApiQuotaLimitedError(error)) {
        const message = "Live price quota reached. Showing cached/catalog estimate.";
        const snapshot = preferredSnapshot(latestSnapshot, cachedSnapshot);
        if (snapshot) {
          return NextResponse.json(
            responseFromSnapshot("quota_limited", snapshot, quotaAfterError, fallbackEstimateCents, message),
          );
        }

        return NextResponse.json(emptyResponse("quota_limited", quotaAfterError, fallbackEstimateCents, message));
      }

      const message = "Could not refresh live pricing. Showing cached/catalog estimate.";
      const snapshot = preferredSnapshot(latestSnapshot, cachedSnapshot);
      if (snapshot) {
        return NextResponse.json(
          responseFromSnapshot(
            "error",
            snapshot,
            quotaAfterError,
            fallbackEstimateCents,
            message,
            error instanceof Error ? error.message : "Live pricing refresh failed.",
          ),
        );
      }

      return NextResponse.json(
        emptyResponse(
          "error",
          quotaAfterError,
          fallbackEstimateCents,
          message,
          error instanceof Error ? error.message : "Live pricing refresh failed.",
        ),
      );
    }

    const [quotaAfter, latestSnapshot] = await Promise.all([
      safeQuotaSummary(),
      findPriceSnapshot({
        slug: snapshotSlug,
        normalizedQueries: [query, normalizedQuery],
      }),
    ]);
    const quotaSummaryAfter = quotaAfter;

    if (searchResponse.refreshSource === "cached") {
      if (searchResponse.refreshSkippedReason === "free_tier_quota") {
        const message = "Live price quota reached. Showing cached/catalog estimate.";
        const snapshot = preferredSnapshot(latestSnapshot, cachedSnapshot);
        if (snapshot) {
          return NextResponse.json(
            responseFromSnapshot("quota_limited", snapshot, quotaSummaryAfter, fallbackEstimateCents, message),
          );
        }

        return NextResponse.json(emptyResponse("quota_limited", quotaSummaryAfter, fallbackEstimateCents, message));
      }

      const snapshot = preferredSnapshot(latestSnapshot, cachedSnapshot);
      if (snapshot) {
        const status = isPriceSnapshotExpired(snapshot) ? "stale" : "cached";
        return NextResponse.json(responseFromSnapshot(status, snapshot, quotaSummaryAfter, fallbackEstimateCents));
      }
    }

    if (latestSnapshot) {
      return NextResponse.json(responseFromSnapshot("fresh", latestSnapshot, quotaSummaryAfter, fallbackEstimateCents));
    }

    return NextResponse.json(responseFromListings("fresh", searchResponse, quotaSummaryAfter, fallbackEstimateCents));
  } catch (error) {
    if (error instanceof UnauthorizedMongoUserError) {
      return unauthorizedResponse();
    }

    console.error("Failed to check live prices.", error);
    const quotaSummary = await safeQuotaSummary();
    return NextResponse.json(
      emptyResponse(
        "error",
        quotaSummary,
        null,
        "Could not check live pricing right now.",
        error instanceof Error ? error.message : "Unknown live pricing error.",
      ),
    );
  }
}
