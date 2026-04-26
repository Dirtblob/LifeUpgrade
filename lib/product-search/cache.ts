import "server-only";

import { ObjectId, type Collection } from "mongodb";
import { getMongoDatabase } from "@/lib/mongodb";
import { normalizeProductQuery, type ProductSearchResult } from "./types";

const PRODUCT_SEARCH_CACHE_COLLECTION = "product_search_cache";

export type ProductSearchCacheStatus = "fresh" | "stale";

export interface ProductSearchCacheHit {
  status: ProductSearchCacheStatus;
  results: ProductSearchResult[];
  fetchedAt: Date;
  expiresAt: Date;
  error?: string;
}

export interface ProductSearchCacheDocument {
  _id: ObjectId | string;
  query: string;
  normalizedQuery: string;
  provider: string;
  results: ProductSearchResult[];
  fetchedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

function normalizeError(error: string | undefined): string | undefined {
  const trimmed = error?.trim();
  return trimmed ? trimmed : undefined;
}

async function getProductSearchCacheCollection(): Promise<Collection<ProductSearchCacheDocument>> {
  const database = await getMongoDatabase();
  return database.collection<ProductSearchCacheDocument>(PRODUCT_SEARCH_CACHE_COLLECTION);
}

function cacheHitFromDocument(document: ProductSearchCacheDocument, now = Date.now()): ProductSearchCacheHit {
  return {
    status: document.expiresAt.getTime() > now ? "fresh" : "stale",
    results: document.results,
    fetchedAt: document.fetchedAt,
    expiresAt: document.expiresAt,
    error: document.error,
  };
}

export async function getCachedProductSearch(provider: string, query: string): Promise<ProductSearchCacheHit | null> {
  const normalizedQuery = normalizeProductQuery(query);
  const normalizedProvider = normalizeProvider(provider);

  if (!normalizedProvider || !normalizedQuery) return null;

  const collection = await getProductSearchCacheCollection();
  const document = await collection.findOne(
    {
      provider: normalizedProvider,
      normalizedQuery,
    },
    {
      sort: { expiresAt: -1, fetchedAt: -1 },
    },
  );

  return document ? cacheHitFromDocument(document) : null;
}

export async function saveProductSearchCache(
  provider: string,
  query: string,
  results: ProductSearchResult[],
  ttl: number,
  error?: string,
): Promise<void> {
  const normalizedQuery = normalizeProductQuery(query);
  const normalizedProvider = normalizeProvider(provider);

  if (!normalizedProvider || !normalizedQuery) return;

  const now = new Date();
  const collection = await getProductSearchCacheCollection();

  await collection.updateOne(
    {
      provider: normalizedProvider,
      normalizedQuery,
    },
    {
      $set: {
        query,
        normalizedQuery,
        provider: normalizedProvider,
        results,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + ttl),
        updatedAt: now,
        error: normalizeError(error),
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );
}
