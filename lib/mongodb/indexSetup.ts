import type { Collection, Db, Document, IndexDescription } from "mongodb";

export interface MongoIndexSetupSummary {
  databaseName: string;
  collections: {
    users: string[];
    userPrivateProfiles: string[];
    inventoryItems: string[];
    deviceCatalog: string[];
    recommendationLogs: string[];
    priceSnapshots: string[];
    productSearchCache: string[];
    catalogEnrichmentCandidates: string[];
    apiUsageEvents: string[];
  };
}

const deviceCatalogTextIndexKey = {
  searchText: "text",
  aliases: "text",
  brand: "text",
  model: "text",
} as const;

function hasTextIndexKey(index: IndexDescription): boolean {
  const entries = index.key instanceof Map ? Array.from(index.key.entries()) : Object.entries(index.key);
  return entries.some(([, value]) => value === "text");
}

function hasExpectedDeviceCatalogTextWeights(index: IndexDescription): boolean {
  const weights = (index as IndexDescription & { weights?: Document }).weights;

  if (weights) {
    const expectedFields = Object.keys(deviceCatalogTextIndexKey);
    return (
      Object.keys(weights).length === expectedFields.length &&
      expectedFields.every((field) => weights[field] === 1)
    );
  }

  const key = index.key instanceof Map ? Object.fromEntries(index.key.entries()) : index.key;
  return Object.entries(deviceCatalogTextIndexKey).every(([field, value]) => key[field] === value);
}

async function ensureDeviceCatalogTextIndex(collection: Collection): Promise<string> {
  const indexes = await collection.indexes();

  for (const index of indexes) {
    if (!hasTextIndexKey(index)) continue;
    if (hasExpectedDeviceCatalogTextWeights(index)) return index.name ?? "";
    if (index.name) await collection.dropIndex(index.name);
  }

  return collection.createIndex(deviceCatalogTextIndexKey);
}

export async function setupMongoIndexes(db: Db): Promise<MongoIndexSetupSummary> {
  const deviceCatalogCollection = db.collection("device_catalog");

  const [
    users,
    userPrivateProfiles,
    inventoryItems,
    deviceCatalog,
    recommendationLogs,
    priceSnapshots,
    productSearchCache,
    catalogEnrichmentCandidates,
    apiUsageEvents,
  ] = await Promise.all([
    db.collection("users").createIndexes([
      { key: { sourceKey: 1 }, unique: true },
      {
        key: { authProvider: 1, authUserId: 1 },
        unique: true,
        partialFilterExpression: {
          authProvider: { $type: "string" },
          authUserId: { $type: "string" },
        },
      },
      {
        key: { email: 1 },
        sparse: true,
      },
    ]),
    db.collection("user_private_profiles").createIndexes([
      { key: { userId: 1 }, unique: true },
      { key: { updatedAt: -1 } },
    ]),
    db.collection("inventory_items").createIndexes([
      { key: { sourceKey: 1 }, unique: true },
      { key: { userId: 1 } },
      { key: { userId: 1, category: 1 } },
      { key: { userId: 1, brand: 1, model: 1 } },
      { key: { userId: 1, updatedAt: -1, createdAt: -1 } },
    ]),
    deviceCatalogCollection.createIndexes([
      { key: { id: 1 }, unique: true },
      { key: { category: 1 } },
      { key: { category: 1, brand: 1, model: 1 } },
    ]),
    db.collection("recommendation_logs").createIndexes([
      { key: { userId: 1 } },
      { key: { userId: 1, createdAt: -1 } },
    ]),
    db.collection("price_snapshots").createIndexes([
      { key: { normalizedQuery: 1 } },
      { key: { slug: 1 }, sparse: true },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
      { key: { provider: 1, normalizedQuery: 1 } },
    ]),
    db.collection("product_search_cache").createIndexes([
      { key: { normalizedQuery: 1 } },
      { key: { provider: 1, normalizedQuery: 1 } },
      { key: { expiresAt: 1 } },
    ]),
    db.collection("catalog_enrichment_candidates").createIndexes([
      { key: { normalizedTitle: 1 } },
      { key: { source: 1, externalId: 1 }, sparse: true },
      { key: { status: 1, seenCount: -1, lastSeenAt: -1 } },
    ]),
    db.collection("api_usage_events").createIndexes([
      { key: { provider: 1, createdAt: -1 } },
      { key: { provider: 1, eventType: 1, createdAt: -1 } },
      { key: { normalizedQuery: 1 } },
      { key: { deviceCatalogId: 1 }, sparse: true },
      { key: { userId: 1 }, sparse: true },
    ]),
  ]);
  const deviceCatalogTextIndex = await ensureDeviceCatalogTextIndex(deviceCatalogCollection);

  return {
    databaseName: db.databaseName,
    collections: {
      users,
      userPrivateProfiles,
      inventoryItems,
      deviceCatalog: [...deviceCatalog, deviceCatalogTextIndex],
      recommendationLogs,
      priceSnapshots,
      productSearchCache,
      catalogEnrichmentCandidates,
      apiUsageEvents,
    },
  };
}
