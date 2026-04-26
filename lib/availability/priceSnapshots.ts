import "server-only";

import { ObjectId, type Collection, type Filter } from "mongodb";
import { getMongoDatabase } from "@/lib/mongodb";
import type { RecommendationPriceSnapshot } from "@/lib/recommendation/types";
import { PRICE_CACHE_FRESHNESS_MS } from "./cachePolicy";
import { compareAvailabilityResults } from "./offerMatcher";
import type { AvailabilityProductModel, AvailabilityResult, AvailabilitySearchResponse } from "./types";

const PRICE_SNAPSHOT_COLLECTION = "price_snapshots";
const PRICES_API_PROVIDER = "pricesapi";
const ERROR_TTL_MS = 60 * 60 * 1000;

export interface PriceSnapshotOffer {
  title: string;
  brand: string;
  model: string;
  retailer: string;
  available: boolean;
  priceCents: number;
  shippingCents?: number | null;
  totalPriceCents: number;
  condition: string;
  url: string;
  imageUrl?: string;
  confidence: number;
}

export interface PriceSnapshotDocument {
  _id: ObjectId | string;
  deviceCatalogId?: string;
  slug?: string;
  query: string;
  normalizedQuery: string;
  provider: string;
  bestOffer: PriceSnapshotOffer | null;
  offers: PriceSnapshotOffer[];
  offerCount: number;
  estimatedMarketPriceCents: number | null;
  fetchedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}

interface LookupPriceSnapshotInput {
  slug?: string;
  normalizedQueries: string[];
  provider?: string;
}

interface WritePriceSnapshotInput {
  deviceCatalogId?: string;
  slug?: string;
  query: string;
  normalizedQuery: string;
  listings: AvailabilityResult[];
  fetchedAt: Date;
  error?: string;
  ttlMs?: number;
  provider?: string;
}

function normalizeText(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizePriceSnapshotQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isPriceSnapshotExpired(
  snapshot: Pick<PriceSnapshotDocument, "expiresAt">,
  now: number = Date.now(),
): boolean {
  return snapshot.expiresAt.getTime() <= now;
}

function offersForStorage(listings: AvailabilityResult[]): PriceSnapshotOffer[] {
  return listings.map((listing) => ({
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
    imageUrl: listing.imageUrl,
    confidence: listing.confidence,
  }));
}

function availabilityResultsFromSnapshot(
  productModel: AvailabilityProductModel,
  snapshot: Pick<PriceSnapshotDocument, "offers" | "fetchedAt" | "provider">,
): AvailabilityResult[] {
  return snapshot.offers
    .map((offer) => ({
      provider: snapshot.provider,
      productModelId: productModel.id,
      title: offer.title,
      brand: offer.brand,
      model: offer.model,
      retailer: offer.retailer,
      available: offer.available,
      priceCents: offer.priceCents,
      shippingCents: offer.shippingCents ?? undefined,
      totalPriceCents: offer.totalPriceCents,
      condition: offer.condition,
      url: offer.url,
      imageUrl: offer.imageUrl,
      confidence: offer.confidence,
      checkedAt: snapshot.fetchedAt,
    }))
    .sort(compareAvailabilityResults);
}

function estimatedMarketPriceCents(listings: AvailabilityResult[]): number | null {
  const candidates = listings
    .filter((listing) => listing.available)
    .map((listing) => listing.totalPriceCents);
  const prices = (candidates.length > 0 ? candidates : listings.map((listing) => listing.totalPriceCents)).sort((a, b) => a - b);

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

async function getPriceSnapshotCollection(): Promise<Collection<PriceSnapshotDocument>> {
  const database = await getMongoDatabase();
  return database.collection<PriceSnapshotDocument>(PRICE_SNAPSHOT_COLLECTION);
}

function buildPriceSnapshotFilter(input: LookupPriceSnapshotInput): Filter<PriceSnapshotDocument> | null {
  const slug = normalizeText(input.slug);
  const normalizedQueries = input.normalizedQueries.map((query) => normalizePriceSnapshotQuery(query)).filter(Boolean);
  const orFilters: Filter<PriceSnapshotDocument>[] = [];

  if (slug) {
    orFilters.push({ slug });
  }

  if (normalizedQueries.length > 0) {
    orFilters.push({ normalizedQuery: { $in: normalizedQueries } });
  }

  if (orFilters.length === 0) {
    return null;
  }

  const filter: Filter<PriceSnapshotDocument> = { $or: orFilters };
  const provider = normalizeText(input.provider);
  if (provider) {
    filter.provider = provider;
  }

  return filter;
}

function newerSnapshot(left: PriceSnapshotDocument, right: PriceSnapshotDocument): PriceSnapshotDocument {
  return left.fetchedAt.getTime() >= right.fetchedAt.getTime() ? left : right;
}

function hasCachedPrice(snapshot: PriceSnapshotDocument): boolean {
  return snapshot.bestOffer !== null || snapshot.estimatedMarketPriceCents !== null;
}

function compareSnapshotPreference(
  left: PriceSnapshotDocument,
  right: PriceSnapshotDocument,
  now = Date.now(),
): PriceSnapshotDocument {
  const leftFresh = left.expiresAt.getTime() > now;
  const rightFresh = right.expiresAt.getTime() > now;

  if (leftFresh !== rightFresh) {
    return leftFresh ? left : right;
  }

  return newerSnapshot(left, right);
}

function recommendationSnapshotFromDocument(snapshot: PriceSnapshotDocument): RecommendationPriceSnapshot {
  return {
    bestOffer: snapshot.bestOffer,
    estimatedMarketPriceCents: snapshot.estimatedMarketPriceCents,
    priceStatus: isPriceSnapshotExpired(snapshot) ? "stale" : "cached",
    fetchedAt: snapshot.fetchedAt,
  };
}

function cacheSlug(productModel: AvailabilityProductModel): string | undefined {
  return normalizeText(productModel.slug) ?? normalizeText(productModel.deviceCatalogId) ?? normalizeText(productModel.id);
}

function normalizedModelQueries(productModel: AvailabilityProductModel): string[] {
  return Array.from(
    new Set(
      [
        ...(productModel.searchQueries ?? []),
        [productModel.brand, productModel.model].filter(Boolean).join(" "),
        productModel.displayName,
      ]
        .map((query) => normalizeText(query))
        .filter((query): query is string => Boolean(query))
        .map(normalizePriceSnapshotQuery),
    ),
  );
}

export async function findPriceSnapshot(
  input: LookupPriceSnapshotInput,
): Promise<PriceSnapshotDocument | null> {
  const filter = buildPriceSnapshotFilter(input);
  if (!filter) {
    return null;
  }

  const collection = await getPriceSnapshotCollection();
  const snapshots = await collection
    .find(filter, {
      projection: {
        _id: 1,
        deviceCatalogId: 1,
        slug: 1,
        query: 1,
        normalizedQuery: 1,
        provider: 1,
        bestOffer: 1,
        offers: 1,
        offerCount: 1,
        estimatedMarketPriceCents: 1,
        fetchedAt: 1,
        expiresAt: 1,
        createdAt: 1,
        updatedAt: 1,
        error: 1,
      },
    })
    .sort({ expiresAt: -1, fetchedAt: -1 })
    .limit(10)
    .toArray();

  if (snapshots.length === 0) {
    return null;
  }

  const now = Date.now();
  let bestFresh: PriceSnapshotDocument | null = null;
  let bestStale: PriceSnapshotDocument | null = null;

  for (const snapshot of snapshots) {
    if (snapshot.expiresAt.getTime() > now) {
      bestFresh = bestFresh ? newerSnapshot(bestFresh, snapshot) : snapshot;
      continue;
    }

    bestStale = bestStale ? newerSnapshot(bestStale, snapshot) : snapshot;
  }

  return bestFresh ?? bestStale;
}

export async function loadCachedRecommendationPriceSnapshots(
  productModels: AvailabilityProductModel[],
): Promise<Record<string, RecommendationPriceSnapshot>> {
  if (productModels.length === 0) {
    return {};
  }

  const slugToProductIds = new Map<string, Set<string>>();
  const queryToProductIds = new Map<string, Set<string>>();

  for (const productModel of productModels) {
    const slug = cacheSlug(productModel);
    if (slug) {
      const productIds = slugToProductIds.get(slug) ?? new Set<string>();
      productIds.add(productModel.id);
      slugToProductIds.set(slug, productIds);
    }

    for (const query of normalizedModelQueries(productModel)) {
      const productIds = queryToProductIds.get(query) ?? new Set<string>();
      productIds.add(productModel.id);
      queryToProductIds.set(query, productIds);
    }
  }

  const slugs = Array.from(slugToProductIds.keys());
  const normalizedQueries = Array.from(queryToProductIds.keys());
  const orFilters: Filter<PriceSnapshotDocument>[] = [];

  if (slugs.length > 0) {
    orFilters.push({ slug: { $in: slugs } });
  }

  if (normalizedQueries.length > 0) {
    orFilters.push({ normalizedQuery: { $in: normalizedQueries } });
  }

  if (orFilters.length === 0) {
    return {};
  }

  const collection = await getPriceSnapshotCollection();
  const snapshots = await collection
    .find(
      { $or: orFilters },
      {
        projection: {
          _id: 1,
          deviceCatalogId: 1,
          slug: 1,
          query: 1,
          normalizedQuery: 1,
          provider: 1,
          bestOffer: 1,
          offers: 1,
          offerCount: 1,
          estimatedMarketPriceCents: 1,
          fetchedAt: 1,
          expiresAt: 1,
          createdAt: 1,
          updatedAt: 1,
          error: 1,
        },
      },
    )
    .sort({ expiresAt: -1, fetchedAt: -1 })
    .limit(Math.max(productModels.length * 10, 50))
    .toArray();

  const selectedByProductId = new Map<string, PriceSnapshotDocument>();
  const now = Date.now();

  for (const snapshot of snapshots) {
    if (!hasCachedPrice(snapshot)) continue;

    const productIds = new Set<string>();
    const slug = normalizeText(snapshot.slug);
    if (slug) {
      for (const productId of slugToProductIds.get(slug) ?? []) productIds.add(productId);
    }

    const normalizedQuery = normalizePriceSnapshotQuery(snapshot.normalizedQuery);
    for (const productId of queryToProductIds.get(normalizedQuery) ?? []) productIds.add(productId);

    for (const productId of productIds) {
      const existing = selectedByProductId.get(productId);
      selectedByProductId.set(productId, existing ? compareSnapshotPreference(existing, snapshot, now) : snapshot);
    }
  }

  return Object.fromEntries(
    Array.from(selectedByProductId.entries()).map(([productId, snapshot]) => [
      productId,
      recommendationSnapshotFromDocument(snapshot),
    ]),
  );
}

export function priceSnapshotToSearchResponse(
  productModel: AvailabilityProductModel,
  snapshot: Pick<PriceSnapshotDocument, "offers" | "fetchedAt" | "expiresAt" | "provider">,
  options: Pick<AvailabilitySearchResponse, "refreshSource" | "refreshSkippedReason">,
): AvailabilitySearchResponse {
  return {
    listings: availabilityResultsFromSnapshot(productModel, snapshot),
    checkedAt: snapshot.fetchedAt,
    refreshSource: options.refreshSource,
    refreshSkippedReason: options.refreshSkippedReason,
    isStale: isPriceSnapshotExpired(snapshot),
  };
}

export async function writePriceSnapshot(input: WritePriceSnapshotInput): Promise<void> {
  const collection = await getPriceSnapshotCollection();
  const now = new Date();
  const listings = [...input.listings].sort(compareAvailabilityResults);
  const offers = offersForStorage(listings);
  const bestOffer = offers[0] ?? null;
  const ttlMs = input.ttlMs ?? (input.error ? ERROR_TTL_MS : PRICE_CACHE_FRESHNESS_MS);
  const slug = normalizeText(input.slug);
  const deviceCatalogId = normalizeText(input.deviceCatalogId);

  const provider = input.provider ?? PRICES_API_PROVIDER;

  await collection.updateOne(
    {
      provider,
      normalizedQuery: input.normalizedQuery,
    },
    {
      $set: {
        deviceCatalogId,
        slug,
        query: input.query,
        normalizedQuery: input.normalizedQuery,
        provider,
        bestOffer,
        offers,
        offerCount: offers.length,
        estimatedMarketPriceCents: estimatedMarketPriceCents(listings),
        fetchedAt: input.fetchedAt,
        expiresAt: new Date(input.fetchedAt.getTime() + ttlMs),
        updatedAt: now,
        error: normalizeText(input.error),
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );
}
