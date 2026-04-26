import { finalizeApiUsageEvent, reservePricesApiCall } from "@/lib/quota/pricesApiQuota";
import { compareAvailabilityResults, scoreOfferConfidence, shouldRejectAvailabilityCandidate } from "./offerMatcher";
import {
  findPriceSnapshot,
  normalizePriceSnapshotQuery,
  priceSnapshotToSearchResponse,
  writePriceSnapshot,
} from "./priceSnapshots";
import type {
  PricesApiOffer,
  PricesApiOffersProduct,
  PricesApiOffersResponse,
  PricesApiSearchRequest,
  PricesApiSearchResponse,
  PricesApiSearchResult,
} from "./pricesApiTypes";
import type { AvailabilityProductModel, AvailabilityProvider, AvailabilityResult, AvailabilitySearchResponse } from "./types";

const DEFAULT_PROVIDER_NAME = "pricesapi";
const DEFAULT_BASE_URL = "https://api.pricesapi.io";
const DEFAULT_COUNTRY = "us";
const FALLBACK_LISTING_URL = "#";
const SEARCH_LIMIT = 10;
const MIN_CONFIDENCE = 60;

interface PricesApiProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  country?: string;
  fetchImpl?: typeof fetch;
  providerName?: string;
  manualRefresh?: boolean;
  forceRefresh?: boolean;
  userId?: string;
}

export class PricesApiQuotaLimitedError extends Error {
  constructor(providerName: string) {
    super(`PricesAPI free-tier quota is exhausted for ${providerName}.`);
    this.name = "PricesApiQuotaLimitedError";
  }
}

export function isPricesApiQuotaLimitedError(error: unknown): error is PricesApiQuotaLimitedError {
  return error instanceof PricesApiQuotaLimitedError;
}

function definedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeProviderName(value: string | undefined): string {
  return definedText(value)?.toLowerCase() ?? DEFAULT_PROVIDER_NAME;
}

function cacheSlug(productModel: AvailabilityProductModel): string | undefined {
  return definedText(productModel.slug) ?? definedText(productModel.deviceCatalogId) ?? definedText(productModel.id);
}

function dedupeRequests(requests: PricesApiSearchRequest[]): PricesApiSearchRequest[] {
  const seen = new Set<string>();

  return requests.filter((request) => {
    const key = request.query.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSearchRequests(productModel: AvailabilityProductModel): PricesApiSearchRequest[] {
  const requests: PricesApiSearchRequest[] = [];

  if (productModel.gtin) {
    requests.push({
      productModelId: productModel.id,
      query: productModel.gtin,
      gtin: productModel.gtin,
      brand: productModel.brand,
      model: productModel.model,
      category: productModel.category,
    });
  }

  if (productModel.upc) {
    requests.push({
      productModelId: productModel.id,
      query: productModel.upc,
      upc: productModel.upc,
      brand: productModel.brand,
      model: productModel.model,
      category: productModel.category,
    });
  }

  if (definedText(productModel.brand) && definedText(productModel.model)) {
    requests.push({
      productModelId: productModel.id,
      query: `${productModel.brand} ${productModel.model}`,
      brand: productModel.brand,
      model: productModel.model,
      category: productModel.category,
    });
  }

  requests.push({
    productModelId: productModel.id,
    query: `${productModel.displayName ?? productModel.id} ${productModel.category.replaceAll("_", " ")}`.trim(),
    brand: productModel.brand,
    model: productModel.model,
    category: productModel.category,
  });

  for (const query of productModel.searchQueries ?? []) {
    requests.push({
      productModelId: productModel.id,
      query,
      brand: productModel.brand,
      model: productModel.model,
      category: productModel.category,
    });
  }

  return dedupeRequests(requests);
}

function buildUrl(baseUrl: string, path: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), normalizedBaseUrl);
}

function parseMoneyToCents(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value.replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function parseShippingCents(deliveryInfo: string | undefined): number | null {
  const normalized = deliveryInfo?.trim().toLowerCase();
  if (!normalized) return null;
  if (/\bfree\b/.test(normalized)) return 0;

  const amount = normalized.match(/\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:shipping|delivery|ship|deliv)/);
  if (!amount?.[1]) return null;

  return Math.round(Number(amount[1]) * 100);
}

function parseAvailability(stock: string | undefined): boolean {
  const normalized = stock?.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes("in stock")) return true;

  return !/\b(?:out of stock|unavailable|sold out|discontinued|no longer available|backordered)\b/.test(normalized);
}

function inferCondition(title: string): string {
  if (/\bopen[\s-]*box\b/i.test(title)) return "open_box";
  if (/\brefurb(?:ished)?\b/i.test(title)) return "refurbished";
  if (/\b(?:used|pre[\s-]*owned|second[\s-]*hand)\b/i.test(title)) return "used";
  return "unknown";
}

function resultAliases(productModel: AvailabilityProductModel): string[] {
  return [
    productModel.displayName,
    productModel.model,
    ...(productModel.searchQueries ?? []),
  ].filter((value): value is string => Boolean(definedText(value)));
}

function scoreProductResultConfidence(
  productModel: AvailabilityProductModel,
  result: PricesApiSearchResult,
): number {
  if (shouldRejectAvailabilityCandidate(productModel, { title: result.title })) {
    return 0;
  }

  return scoreOfferConfidence(productModel, {
    title: result.title,
    category: productModel.category,
    aliases: resultAliases(productModel),
  });
}

function chooseBestProductResult(
  productModel: AvailabilityProductModel,
  results: PricesApiSearchResult[],
): PricesApiSearchResult | null {
  const [bestResult] = results
    .map((result) => ({
      result,
      confidence: scoreProductResultConfidence(productModel, result),
    }))
    .filter((entry) => entry.confidence >= MIN_CONFIDENCE)
    .sort((left, right) => right.confidence - left.confidence || (right.result.offerCount ?? 0) - (left.result.offerCount ?? 0));

  return bestResult?.result ?? null;
}

function normalizeOffer(
  providerName: string,
  productModel: AvailabilityProductModel,
  product: PricesApiOffersProduct,
  offer: PricesApiOffer,
  checkedAt: Date,
): AvailabilityResult | null {
  const title = definedText(offer.productTitle) ?? product.title;
  const priceCents = parseMoneyToCents(offer.price);
  if (priceCents === null) return null;

  const shippingCents = parseShippingCents(offer.delivery_info);
  const totalPriceCents = priceCents + (shippingCents ?? 0);
  const condition = inferCondition(title);
  const confidence = scoreOfferConfidence(productModel, {
    title,
    category: productModel.category,
    condition,
    aliases: resultAliases(productModel),
  });

  if (confidence < MIN_CONFIDENCE || shouldRejectAvailabilityCandidate(productModel, { title, condition })) {
    return null;
  }

  return {
    provider: providerName,
    productModelId: productModel.id,
    title,
    brand: productModel.brand,
    model: productModel.model ?? productModel.displayName ?? productModel.id,
    retailer: definedText(offer.seller) ?? "Unknown retailer",
    available: parseAvailability(offer.stock),
    priceCents,
    shippingCents,
    totalPriceCents,
    condition,
    url: definedText(offer.url) ?? definedText(offer.seller_url) ?? FALLBACK_LISTING_URL,
    imageUrl: definedText(product.image),
    confidence,
    checkedAt,
  };
}

function dedupeOffers(offers: AvailabilityResult[]): AvailabilityResult[] {
  const deduped = new Map<string, AvailabilityResult>();

  for (const offer of offers) {
    const key = [offer.url, offer.title.toLowerCase(), offer.retailer.toLowerCase(), offer.totalPriceCents, offer.condition].join("|");
    const existing = deduped.get(key);

    if (!existing || compareAvailabilityResults(offer, existing) < 0) {
      deduped.set(key, offer);
    }
  }

  return Array.from(deduped.values());
}

async function fetchPricesApiSearchResults(
  request: PricesApiSearchRequest,
  options: Required<Pick<PricesApiProviderOptions, "apiKey" | "baseUrl" | "fetchImpl">>,
): Promise<PricesApiSearchResult[]> {
  const url = buildUrl(options.baseUrl, "/api/v1/products/search");
  url.searchParams.set("q", request.query);
  url.searchParams.set("limit", String(SEARCH_LIMIT));

  const response = await options.fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "x-api-key": options.apiKey,
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as PricesApiSearchResponse;
  return payload.success === false ? [] : payload.data?.results ?? [];
}

async function fetchPricesApiOffers(
  productId: string | number,
  options: Required<Pick<PricesApiProviderOptions, "apiKey" | "baseUrl" | "country" | "fetchImpl">>,
): Promise<PricesApiOffersProduct | null> {
  const url = buildUrl(options.baseUrl, `/api/v1/products/${encodeURIComponent(productId)}/offers`);
  url.searchParams.set("country", options.country);

  const response = await options.fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "x-api-key": options.apiKey,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as PricesApiOffersResponse;
  return payload.success === false ? null : payload.data ?? null;
}

export function getPricesApiProviderName(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeProviderName(env.PRICES_API_PROVIDER_NAME);
}

export function isPricesApiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(definedText(env.PRICES_API_KEY ?? env.PRICE_API_KEY));
}

export function createPricesApiProvider(options: PricesApiProviderOptions = {}): AvailabilityProvider | null {
  const baseUrl = definedText(options.baseUrl ?? process.env.PRICES_API_BASE_URL ?? process.env.PRICE_API_BASE_URL) ?? DEFAULT_BASE_URL;
  const apiKey = definedText(options.apiKey ?? process.env.PRICES_API_KEY ?? process.env.PRICE_API_KEY);
  const country = definedText(options.country ?? process.env.PRICES_API_COUNTRY ?? process.env.PRICE_API_COUNTRY) ?? DEFAULT_COUNTRY;
  const providerName = normalizeProviderName(options.providerName ?? process.env.PRICES_API_PROVIDER_NAME);
  const fetchImpl = options.fetchImpl ?? fetch;
  const manualRefresh = options.manualRefresh ?? false;
  const forceRefresh = options.forceRefresh ?? false;
  const userId = definedText(options.userId);

  if (!apiKey) {
    return null;
  }

  return {
    name: providerName,
    async search(productModel) {
      const requests = buildSearchRequests(productModel);
      const cachedSnapshot = await findPriceSnapshot({
        slug: cacheSlug(productModel),
        normalizedQueries: requests.map((request) => request.query),
        provider: providerName,
      });

      const hasFreshCache = cachedSnapshot ? cachedSnapshot.expiresAt.getTime() > Date.now() : false;
      if (cachedSnapshot && hasFreshCache && !forceRefresh) {
        return priceSnapshotToSearchResponse(productModel, cachedSnapshot, {
          refreshSource: "cached",
        });
      }

      if (cachedSnapshot && !hasFreshCache && !manualRefresh && !forceRefresh) {
        return priceSnapshotToSearchResponse(productModel, cachedSnapshot, {
          refreshSource: "cached",
          refreshSkippedReason: "cache_only",
        });
      }

      for (const request of requests) {
        const checkedAt = new Date();
        const searchReservationId = await reservePricesApiCall(providerName, {
          now: checkedAt,
          query: request.query,
          normalizedQuery: normalizePriceSnapshotQuery(request.query),
          deviceCatalogId: productModel.deviceCatalogId,
          userId,
          requestCount: 1,
        });

        if (!searchReservationId) {
          if (cachedSnapshot) {
            return priceSnapshotToSearchResponse(productModel, cachedSnapshot, {
              refreshSource: "cached",
              refreshSkippedReason: "free_tier_quota",
            });
          }
          throw new PricesApiQuotaLimitedError(providerName);
        }

        let selectedProduct: PricesApiSearchResult | null = null;
        try {
          const searchResults = await fetchPricesApiSearchResults(request, { apiKey, baseUrl, fetchImpl });
          selectedProduct = chooseBestProductResult(productModel, searchResults);
          await finalizeApiUsageEvent(searchReservationId, true);
        } catch {
          await finalizeApiUsageEvent(searchReservationId, false);
          selectedProduct = null;
        }

        if (!selectedProduct) {
          await writePriceSnapshot({
            deviceCatalogId: productModel.deviceCatalogId,
            slug: cacheSlug(productModel),
            query: request.query,
            normalizedQuery: normalizePriceSnapshotQuery(request.query),
            listings: [],
            fetchedAt: checkedAt,
            error: "No matching PricesAPI product result.",
          });
          continue;
        }

        const offersReservationId = await reservePricesApiCall(providerName, {
          now: checkedAt,
          query: request.query,
          normalizedQuery: normalizePriceSnapshotQuery(request.query),
          deviceCatalogId: productModel.deviceCatalogId,
          userId,
          requestCount: 1,
        });

        if (!offersReservationId) {
          if (cachedSnapshot) {
            return priceSnapshotToSearchResponse(productModel, cachedSnapshot, {
              refreshSource: "cached",
              refreshSkippedReason: "free_tier_quota",
            });
          }
          throw new PricesApiQuotaLimitedError(providerName);
        }

        try {
          const product = await fetchPricesApiOffers(selectedProduct.id, { apiKey, baseUrl, country, fetchImpl });
          const offers = product?.offers ?? [];
          await finalizeApiUsageEvent(offersReservationId, true);
          const listings = dedupeOffers(
            offers
              .map((offer) => normalizeOffer(providerName, productModel, product ?? selectedProduct, offer, checkedAt))
              .filter((offer): offer is AvailabilityResult => Boolean(offer)),
          ).sort(compareAvailabilityResults);

          await writePriceSnapshot({
            deviceCatalogId: productModel.deviceCatalogId,
            slug: cacheSlug(productModel),
            query: request.query,
            normalizedQuery: normalizePriceSnapshotQuery(request.query),
            listings,
            fetchedAt: checkedAt,
            error: listings.length === 0 ? "No qualifying offers matched the catalog model." : undefined,
          });

          return {
            listings,
            checkedAt,
            refreshSource: "live",
            isStale: false,
          } satisfies AvailabilitySearchResponse;
        } catch {
          await finalizeApiUsageEvent(offersReservationId, false);
          // Failed requests still count against the free-tier budget.
          await writePriceSnapshot({
            deviceCatalogId: productModel.deviceCatalogId,
            slug: cacheSlug(productModel),
            query: request.query,
            normalizedQuery: normalizePriceSnapshotQuery(request.query),
            listings: [],
            fetchedAt: checkedAt,
            error: "PricesAPI offers lookup failed.",
          });

          return {
            listings: [],
            checkedAt,
            refreshSource: "live",
            isStale: false,
          } satisfies AvailabilitySearchResponse;
        }
      }

      const checkedAt = new Date();
      return cachedSnapshot
        ? priceSnapshotToSearchResponse(productModel, cachedSnapshot, {
            refreshSource: "cached",
            refreshSkippedReason: "cache_only",
          })
        : {
            listings: [],
            checkedAt,
            refreshSource: "live",
            isStale: false,
          };
    },
  };
}

export function getPricesApiProvider(options: PricesApiProviderOptions = {}): AvailabilityProvider | null {
  return createPricesApiProvider(options);
}
