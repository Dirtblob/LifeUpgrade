import "server-only";

import { ObjectId, type Collection, type Filter, type Sort } from "mongodb";
import { getMongoDatabase } from "@/lib/mongodb";

type SortDirection = "asc" | "desc";
type OrderBy = Record<string, SortDirection> | Array<Record<string, SortDirection>>;

interface MongoRecord {
  _id?: ObjectId | string;
  id: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface UserProfileRecord extends MongoRecord {
  name: string | null;
  ageRange: string | null;
  profession: string;
  budgetCents: number;
  spendingStyle: string;
  usedItemsOkay: boolean;
  accessibilityNeeds: string;
  preferences: string;
  problems: string;
  roomConstraints: string;
}

export interface RecommendationRecord extends MongoRecord {
  userProfileId: string;
  category: string;
  productModelId: string | null;
  score: number;
  priority: string;
  problemSolved: string;
  explanation: string;
}

export interface SavedProductRecord extends MongoRecord {
  userProfileId: string;
  productModelId: string;
  targetPriceCents: number | null;
  notifyThreshold: number;
}

export interface WatchlistAlertRecord extends MongoRecord {
  userProfileId: string;
  savedProductId: string;
  productModelId: string;
  title: string;
  message: string;
  oldPriceCents: number | null;
  newPriceCents: number;
  thresholdCents: number | null;
  scoreAtAlert: number;
  provider: string;
  url: string | null;
  seen: boolean;
}

export interface AvailabilitySnapshotRecord extends MongoRecord {
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
  url: string | null;
  imageUrl: string | null;
  condition: string | null;
  confidence: number | null;
  checkedAt: Date;
}

export interface TrainingExampleRecord extends MongoRecord {
  inputJson: string;
  targetOutputJson: string;
  source: string;
  qualityRating: number | null;
  notes: string | null;
}

export interface JobRunRecord extends MongoRecord {
  jobName: string;
  status: string;
  productsEligible: number;
  productsChecked: number;
  productsSkippedDueToQuota: number;
  apiCallsUsed: number;
  pricesApiCallsUsed: number;
  remainingMonthlyCalls: number;
  remainingDailyCalls: number;
  remainingMinuteCalls: number;
}

interface RecommendationExplanationCacheRecord extends MongoRecord {
  recommendationId: string;
  productId: string;
  inputHash: string;
  model: string;
  source: string;
  outputJson: string;
  error: string | null;
}

interface ApiUsageRecord extends MongoRecord {
  provider: string;
  periodType: string;
  periodKey: string;
  callCount: number;
}

interface RecentlyViewedProductRecord extends MongoRecord {
  userProfileId: string;
  productModelId: string;
  viewedAt: Date;
}

function createId(): string {
  return new ObjectId().toHexString();
}

function nowFields() {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

function toSort(orderBy?: OrderBy): Sort {
  if (!orderBy) return {};
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  return Object.assign(
    {},
    ...entries.map((entry) =>
      Object.fromEntries(Object.entries(entry).map(([key, direction]) => [key, direction === "desc" ? -1 : 1])),
    ),
  );
}

function stripMongoId<T extends { _id?: unknown }>(document: T): Omit<T, "_id">;
function stripMongoId<T extends { _id?: unknown }>(document: T | null): Omit<T, "_id"> | null;
function stripMongoId<T extends { _id?: unknown }>(document: T | null): Omit<T, "_id"> | null {
  if (!document) return null;
  const rest = { ...document };
  delete rest._id;
  return rest;
}

function stripMongoIds<T extends { _id?: unknown }>(documents: T[]): Array<Omit<T, "_id">> {
  return documents.map((document) => stripMongoId(document)).filter((document): document is Omit<T, "_id"> => Boolean(document));
}

async function collection<T extends MongoRecord>(name: string): Promise<Collection<T>> {
  return (await getMongoDatabase()).collection<T>(name);
}

async function savedProductsForUser(userProfileId: string): Promise<SavedProductRecord[]> {
  const savedProducts = await collection<SavedProductRecord>("saved_products");
  return stripMongoIds(await savedProducts.find({ userProfileId }).sort({ createdAt: -1 }).toArray()) as SavedProductRecord[];
}

async function attachUserProfile(recommendation: RecommendationRecord) {
  const users = await collection<UserProfileRecord>("user_profiles");
  const profile = stripMongoId(await users.findOne({ id: recommendation.userProfileId }));
  return {
    ...recommendation,
    userProfile: profile
      ? {
          name: profile.name,
          profession: profile.profession,
        }
      : null,
  };
}

export const db = {
  async $transaction<T>(input: Promise<T>[] | ((tx: never) => Promise<T>)): Promise<T[] | T> {
    if (Array.isArray(input)) {
      return Promise.all(input);
    }

    return input(this as never);
  },

  userProfile: {
    async upsert(args: { where: { id: string }; update: Partial<UserProfileRecord>; create: Omit<Partial<UserProfileRecord>, "createdAt" | "updatedAt"> & { id: string } }) {
      const profiles = await collection<UserProfileRecord>("user_profiles");
      const now = new Date();
      const existing = await profiles.findOne({ id: args.where.id });

      if (existing) {
        await profiles.updateOne(
          { id: args.where.id },
          {
            $set: {
              ...args.update,
              updatedAt: now,
            },
          },
        );
      } else {
        await profiles.insertOne({
          _id: args.create.id,
          ...(args.create as UserProfileRecord),
          createdAt: now,
          updatedAt: now,
        });
      }

      return stripMongoId(await profiles.findOne({ id: args.where.id }));
    },

    async findUnique(args: { where: { id: string }; include?: { savedProducts?: boolean; _count?: { select?: { recommendations?: boolean; savedProducts?: boolean } } } }) {
      const profiles = await collection<UserProfileRecord>("user_profiles");
      const profile = stripMongoId(await profiles.findOne({ id: args.where.id }));
      if (!profile) return null;

      const result: Record<string, unknown> = { ...profile };
      if (args.include?.savedProducts) {
        result.savedProducts = await savedProductsForUser(profile.id);
      }
      if (args.include?._count) {
        const recommendations = await collection<RecommendationRecord>("recommendations");
        const savedProducts = await collection<SavedProductRecord>("saved_products");
        result._count = {
          recommendations: args.include._count.select?.recommendations
            ? await recommendations.countDocuments({ userProfileId: profile.id })
            : 0,
          savedProducts: args.include._count.select?.savedProducts
            ? await savedProducts.countDocuments({ userProfileId: profile.id })
            : 0,
        };
      }

      return result;
    },

    async findFirst(args: { include?: { savedProducts?: boolean }; orderBy?: OrderBy } = {}) {
      const profiles = await collection<UserProfileRecord>("user_profiles");
      const profile = stripMongoId(await profiles.find({}).sort(toSort(args.orderBy)).limit(1).next());
      if (!profile) return null;

      return args.include?.savedProducts
        ? {
            ...profile,
            savedProducts: await savedProductsForUser(profile.id),
          }
        : profile;
    },

    async findMany(args: { include?: { savedProducts?: boolean } } = {}) {
      const profiles = await collection<UserProfileRecord>("user_profiles");
      const rows = stripMongoIds(await profiles.find({}).sort({ createdAt: -1 }).toArray()) as UserProfileRecord[];
      if (!args.include?.savedProducts) return rows;

      return Promise.all(
        rows.map(async (profile) => ({
          ...profile,
          savedProducts: await savedProductsForUser(profile.id),
        })),
      );
    },

    async deleteMany(args: { where?: { id?: string } } = {}) {
      const filter = args.where?.id ? { id: args.where.id } : {};
      const profiles = await collection<UserProfileRecord>("user_profiles");
      const ids = (await profiles.find(filter).project<{ id: string }>({ id: 1 }).toArray()).map((profile) => profile.id);
      const result = await profiles.deleteMany(filter);

      if (ids.length > 0) {
        const userProfileId = { $in: ids };
        await Promise.all([
          (await collection<RecommendationRecord>("recommendations")).deleteMany({ userProfileId }),
          (await collection<SavedProductRecord>("saved_products")).deleteMany({ userProfileId }),
          (await collection<WatchlistAlertRecord>("watchlist_alerts")).deleteMany({ userProfileId }),
          (await collection<RecentlyViewedProductRecord>("recently_viewed_products")).deleteMany({ userProfileId }),
        ]);
      }

      return { count: result.deletedCount };
    },
  },

  recommendation: {
    async deleteMany(args: { where?: { userProfileId?: string } } = {}) {
      const recommendations = await collection<RecommendationRecord>("recommendations");
      const result = await recommendations.deleteMany(args.where?.userProfileId ? { userProfileId: args.where.userProfileId } : {});
      return { count: result.deletedCount };
    },

    async createMany(args: { data: Array<Omit<Partial<RecommendationRecord>, "id" | "createdAt" | "updatedAt">> }) {
      if (args.data.length === 0) return { count: 0 };
      const recommendations = await collection<RecommendationRecord>("recommendations");
      const rows = args.data.map((row) => ({
        id: createId(),
        productModelId: row.productModelId ?? null,
        ...nowFields(),
        ...row,
      })) as RecommendationRecord[];
      await recommendations.insertMany(rows);
      return { count: rows.length };
    },

    async findMany(args: { where?: { userProfileId?: string; productModelId?: { not?: null } }; orderBy?: OrderBy; take?: number; include?: { userProfile?: { select?: { name?: boolean; profession?: boolean } } } } = {}) {
      const recommendations = await collection<RecommendationRecord>("recommendations");
      const filter: Filter<RecommendationRecord> = {};
      if (args.where?.userProfileId) filter.userProfileId = args.where.userProfileId;
      if (args.where?.productModelId?.not === null) filter.productModelId = { $ne: null };
      const rows = stripMongoIds(
        await recommendations.find(filter).sort(toSort(args.orderBy)).limit(args.take ?? 0).toArray(),
      ) as RecommendationRecord[];

      return args.include?.userProfile ? Promise.all(rows.map(attachUserProfile)) : rows;
    },
  },

  savedProduct: {
    async findFirst(args: { where: { userProfileId: string; productModelId?: { in?: string[] } } }) {
      const savedProducts = await collection<SavedProductRecord>("saved_products");
      return stripMongoId(
        await savedProducts.findOne({
          userProfileId: args.where.userProfileId,
          ...(args.where.productModelId?.in ? { productModelId: { $in: args.where.productModelId.in } } : {}),
        }),
      );
    },

    async findMany(args: { where?: { userProfileId?: string; targetPriceCents?: { not?: null } }; orderBy?: OrderBy } = {}) {
      const savedProducts = await collection<SavedProductRecord>("saved_products");
      const filter: Filter<SavedProductRecord> = {};
      if (args.where?.userProfileId) filter.userProfileId = args.where.userProfileId;
      if (args.where?.targetPriceCents?.not === null) filter.targetPriceCents = { $ne: null };
      return stripMongoIds(await savedProducts.find(filter).sort(toSort(args.orderBy)).toArray());
    },

    async create(args: { data: Omit<Partial<SavedProductRecord>, "id" | "createdAt" | "updatedAt"> & { userProfileId: string; productModelId: string } }) {
      const savedProducts = await collection<SavedProductRecord>("saved_products");
      const row: SavedProductRecord = {
        id: createId(),
        targetPriceCents: null,
        notifyThreshold: 80,
        ...nowFields(),
        ...args.data,
      };
      await savedProducts.insertOne(row);
      return stripMongoId(row);
    },

    async deleteMany(args: { where?: { userProfileId?: string; productModelId?: { in?: string[] } } } = {}) {
      const savedProducts = await collection<SavedProductRecord>("saved_products");
      const filter: Filter<SavedProductRecord> = {};
      if (args.where?.userProfileId) filter.userProfileId = args.where.userProfileId;
      if (args.where?.productModelId?.in) filter.productModelId = { $in: args.where.productModelId.in };
      const result = await savedProducts.deleteMany(filter);
      return { count: result.deletedCount };
    },
  },

  watchlistAlert: {
    async updateMany(args: { where: { id?: string; userProfileId?: string }; data: Partial<WatchlistAlertRecord> }) {
      const alerts = await collection<WatchlistAlertRecord>("watchlist_alerts");
      const result = await alerts.updateMany(args.where, { $set: { ...args.data, updatedAt: new Date() } });
      return { count: result.modifiedCount };
    },

    async findMany(args: { where?: { userProfileId?: string }; orderBy?: OrderBy } = {}) {
      const alerts = await collection<WatchlistAlertRecord>("watchlist_alerts");
      return stripMongoIds(await alerts.find(args.where ?? {}).sort(toSort(args.orderBy)).toArray());
    },

    async createMany(args: { data: Array<Omit<Partial<WatchlistAlertRecord>, "id" | "createdAt" | "updatedAt">> }) {
      if (args.data.length === 0) return { count: 0 };
      const alerts = await collection<WatchlistAlertRecord>("watchlist_alerts");
      const rows = args.data.map((row) => ({
        id: createId(),
        seen: false,
        ...nowFields(),
        ...row,
      })) as WatchlistAlertRecord[];
      await alerts.insertMany(rows);
      return { count: rows.length };
    },

    async deleteMany(args: { where?: { userProfileId?: string } } = {}) {
      const alerts = await collection<WatchlistAlertRecord>("watchlist_alerts");
      const result = await alerts.deleteMany(args.where?.userProfileId ? { userProfileId: args.where.userProfileId } : {});
      return { count: result.deletedCount };
    },

    async count(args: { where?: { userProfileId?: string; seen?: boolean } } = {}) {
      const alerts = await collection<WatchlistAlertRecord>("watchlist_alerts");
      return alerts.countDocuments(args.where ?? {});
    },
  },

  availabilitySnapshot: {
    async findMany(args: { where?: { provider?: string; productModelId?: { in?: string[] } }; orderBy?: OrderBy } = {}) {
      const snapshots = await collection<AvailabilitySnapshotRecord>("availability_snapshots");
      const filter: Filter<AvailabilitySnapshotRecord> = {};
      if (args.where?.provider) filter.provider = args.where.provider;
      if (args.where?.productModelId?.in) filter.productModelId = { $in: args.where.productModelId.in };
      return stripMongoIds(await snapshots.find(filter).sort(toSort(args.orderBy)).toArray());
    },

    async findFirst(args: { where?: { productModelId?: string }; orderBy?: OrderBy } = {}) {
      const snapshots = await collection<AvailabilitySnapshotRecord>("availability_snapshots");
      return stripMongoId(await snapshots.find(args.where ?? {}).sort(toSort(args.orderBy)).limit(1).next());
    },

    async createMany(args: { data: Array<Omit<Partial<AvailabilitySnapshotRecord>, "id" | "createdAt" | "updatedAt">> }) {
      if (args.data.length === 0) return { count: 0 };
      const snapshots = await collection<AvailabilitySnapshotRecord>("availability_snapshots");
      const rows = args.data.map((row) => ({
        id: createId(),
        ...nowFields(),
        ...row,
      })) as AvailabilitySnapshotRecord[];
      await snapshots.insertMany(rows);
      return { count: rows.length };
    },

    async create(args: { data: Omit<Partial<AvailabilitySnapshotRecord>, "id" | "createdAt" | "updatedAt"> }) {
      const snapshots = await collection<AvailabilitySnapshotRecord>("availability_snapshots");
      const row = {
        id: createId(),
        shippingCents: null,
        imageUrl: null,
        ...nowFields(),
        ...args.data,
      } as AvailabilitySnapshotRecord;
      await snapshots.insertOne(row);
      return stripMongoId(row);
    },

    async deleteMany(args: { where?: { productModelId?: string; provider?: string } } = {}) {
      const snapshots = await collection<AvailabilitySnapshotRecord>("availability_snapshots");
      const result = await snapshots.deleteMany(args.where ?? {});
      return { count: result.deletedCount };
    },
  },

  trainingExample: {
    async deleteMany(args: { where?: { OR?: Array<{ qualityRating?: null | { lt: number } }> } } = {}) {
      const examples = await collection<TrainingExampleRecord>("training_examples");
      const filter = args.where?.OR
        ? {
            $or: [
              { qualityRating: null },
              { qualityRating: { $exists: false } },
              { qualityRating: { $lt: 3 } },
            ],
          }
        : {};
      const result = await examples.deleteMany(filter);
      return { count: result.deletedCount };
    },

    async findMany(args: { select?: Record<string, boolean>; orderBy?: OrderBy; take?: number } = {}) {
      const examples = await collection<TrainingExampleRecord>("training_examples");
      const cursor = examples.find({}, { projection: args.select }).sort(toSort(args.orderBy)).limit(args.take ?? 0);
      return stripMongoIds(await cursor.toArray());
    },

    async create(args: { data: Omit<Partial<TrainingExampleRecord>, "id" | "createdAt" | "updatedAt"> }) {
      const examples = await collection<TrainingExampleRecord>("training_examples");
      const row = {
        id: createId(),
        qualityRating: null,
        notes: null,
        ...nowFields(),
        ...args.data,
      } as TrainingExampleRecord;
      await examples.insertOne(row);
      return stripMongoId(row);
    },

    async update(args: { where: { id: string }; data: Partial<TrainingExampleRecord> }) {
      const examples = await collection<TrainingExampleRecord>("training_examples");
      await examples.updateOne({ id: args.where.id }, { $set: { ...args.data, updatedAt: new Date() } });
      return stripMongoId(await examples.findOne({ id: args.where.id }));
    },

    async count() {
      const examples = await collection<TrainingExampleRecord>("training_examples");
      return examples.countDocuments();
    },
  },

  jobRun: {
    async create(args: { data: Omit<Partial<JobRunRecord>, "id" | "createdAt" | "updatedAt"> }) {
      const jobRuns = await collection<JobRunRecord>("job_runs");
      const row = {
        id: createId(),
        ...nowFields(),
        ...args.data,
      } as JobRunRecord;
      await jobRuns.insertOne(row);
      return stripMongoId(row);
    },

    async findFirst(args: { where?: { jobName?: string }; orderBy?: OrderBy } = {}) {
      const jobRuns = await collection<JobRunRecord>("job_runs");
      return stripMongoId(await jobRuns.find(args.where ?? {}).sort(toSort(args.orderBy)).limit(1).next());
    },
  },

  recommendationExplanationCache: {
    async findUnique(args: { where: { recommendationId_productId_inputHash: { recommendationId: string; productId: string; inputHash: string } } }) {
      const cache = await collection<RecommendationExplanationCacheRecord>("recommendation_explanation_cache");
      return stripMongoId(await cache.findOne(args.where.recommendationId_productId_inputHash));
    },

    async upsert(args: {
      where: { recommendationId_productId_inputHash: { recommendationId: string; productId: string; inputHash: string } };
      update: Partial<RecommendationExplanationCacheRecord>;
      create: Omit<Partial<RecommendationExplanationCacheRecord>, "id" | "createdAt" | "updatedAt">;
    }) {
      const cache = await collection<RecommendationExplanationCacheRecord>("recommendation_explanation_cache");
      const now = new Date();
      const existing = await cache.findOne(args.where.recommendationId_productId_inputHash);

      if (existing) {
        await cache.updateOne(
          args.where.recommendationId_productId_inputHash,
          {
            $set: {
              ...args.update,
              updatedAt: now,
            },
          },
        );
      } else {
        await cache.insertOne({
          ...(args.create as RecommendationExplanationCacheRecord),
          id: createId(),
          createdAt: now,
          updatedAt: now,
        });
      }

      return stripMongoId(await cache.findOne(args.where.recommendationId_productId_inputHash));
    },
  },

  apiUsage: {
    async findUnique(args: { where: { provider_periodType_periodKey: { provider: string; periodType: string; periodKey: string } } }) {
      const usage = await collection<ApiUsageRecord>("api_usage");
      return stripMongoId(await usage.findOne(args.where.provider_periodType_periodKey));
    },

    async upsert(args: {
      where: { provider_periodType_periodKey: { provider: string; periodType: string; periodKey: string } };
      update: { callCount?: { increment?: number } };
      create: { provider: string; periodType: string; periodKey: string; callCount: number };
    }) {
      const usage = await collection<ApiUsageRecord>("api_usage");
      const now = new Date();
      const existing = await usage.findOne(args.where.provider_periodType_periodKey);
      if (existing) {
        await usage.updateOne(
          args.where.provider_periodType_periodKey,
          {
            $inc: {
              callCount: args.update.callCount?.increment ?? 0,
            },
            $set: {
              updatedAt: now,
            },
          },
        );
      } else {
        await usage.insertOne({
          id: createId(),
          ...args.create,
          createdAt: now,
          updatedAt: now,
        });
      }

      return stripMongoId(await usage.findOne(args.where.provider_periodType_periodKey));
    },
  },

  recentlyViewedProduct: {
    async findMany(args: { where?: { userProfileId?: string }; orderBy?: OrderBy; take?: number } = {}) {
      const recentViews = await collection<RecentlyViewedProductRecord>("recently_viewed_products");
      return stripMongoIds(await recentViews.find(args.where ?? {}).sort(toSort(args.orderBy)).limit(args.take ?? 0).toArray());
    },

    async upsert(args: {
      where: { userProfileId_productModelId: { userProfileId: string; productModelId: string } };
      update: { viewedAt: Date };
      create: { userProfileId: string; productModelId: string; viewedAt: Date };
    }) {
      const recentViews = await collection<RecentlyViewedProductRecord>("recently_viewed_products");
      const now = new Date();
      const existing = await recentViews.findOne(args.where.userProfileId_productModelId);

      if (existing) {
        await recentViews.updateOne(
          args.where.userProfileId_productModelId,
          {
            $set: {
              ...args.update,
              updatedAt: now,
            },
          },
        );
      } else {
        await recentViews.insertOne({
          id: createId(),
          ...args.create,
          createdAt: now,
          updatedAt: now,
        });
      }

      return stripMongoId(await recentViews.findOne(args.where.userProfileId_productModelId));
    },
  },
} as const;
