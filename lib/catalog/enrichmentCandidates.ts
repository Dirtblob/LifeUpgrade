import "server-only";

import { ObjectId, type Collection, type Filter } from "mongodb";
import { getMongoDatabase } from "@/lib/mongodb";
import { normalizeProductQuery } from "@/lib/product-search/types";

const CANDIDATE_COLLECTION = "catalog_enrichment_candidates";

export type CatalogEnrichmentCandidateStatus = "pending" | "approved" | "ignored" | "rated";

export interface CatalogEnrichmentCandidate {
  _id: ObjectId | string;
  normalizedTitle: string;
  brand?: string;
  model?: string;
  category?: string;
  source: string;
  externalId?: string;
  productUrl?: string;
  imageUrl?: string;
  seenCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  status: CatalogEnrichmentCandidateStatus;
}

export interface UpsertCatalogEnrichmentCandidateInput {
  title: string;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  source: "bestbuy" | "custom" | string;
  externalId?: string | null;
  productUrl?: string | null;
  imageUrl?: string | null;
}

function definedText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function getCandidateCollection(): Promise<Collection<CatalogEnrichmentCandidate>> {
  const database = await getMongoDatabase();
  return database.collection<CatalogEnrichmentCandidate>(CANDIDATE_COLLECTION);
}

function candidateLookup(input: {
  source: string;
  externalId?: string;
  normalizedTitle: string;
}): Filter<CatalogEnrichmentCandidate> {
  const filters: Filter<CatalogEnrichmentCandidate>[] = [{ normalizedTitle: input.normalizedTitle }];

  if (input.externalId) {
    filters.unshift({
      source: input.source,
      externalId: input.externalId,
    });
  }

  return { $or: filters };
}

export async function upsertCatalogEnrichmentCandidate(
  input: UpsertCatalogEnrichmentCandidateInput,
): Promise<CatalogEnrichmentCandidate | null> {
  const normalizedTitle = normalizeProductQuery(input.title);
  const source = definedText(input.source)?.toLowerCase();

  if (!normalizedTitle || !source) return null;

  const now = new Date();
  const externalId = definedText(input.externalId);
  const collection = await getCandidateCollection();
  const existing = await collection.findOne(candidateLookup({ source, externalId, normalizedTitle }));

  const update = {
    $set: {
      normalizedTitle,
      brand: definedText(input.brand),
      model: definedText(input.model),
      category: definedText(input.category),
      source,
      externalId,
      productUrl: definedText(input.productUrl),
      imageUrl: definedText(input.imageUrl),
      lastSeenAt: now,
    },
    $setOnInsert: {
      seenCount: 0,
      firstSeenAt: now,
      status: "pending" as const,
    },
    $inc: {
      seenCount: 1,
    },
  };

  if (existing) {
    await collection.updateOne({ _id: existing._id }, update);
    const updated = await collection.findOne({ _id: existing._id });
    return updated ?? existing;
  }

  const insertId = new ObjectId();
  await collection.updateOne({ _id: insertId }, update, { upsert: true });
  return collection.findOne({ _id: insertId });
}

export async function listPendingCatalogEnrichmentCandidates(limit = 50): Promise<CatalogEnrichmentCandidate[]> {
  const collection = await getCandidateCollection();

  return collection
    .find({ status: "pending" })
    .sort({ seenCount: -1, lastSeenAt: -1 })
    .limit(Math.max(1, Math.min(200, Math.trunc(limit))))
    .toArray();
}
