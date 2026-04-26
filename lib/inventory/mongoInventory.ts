import type { Collection, Filter } from "mongodb";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getCurrentInventoryUserId } from "@/lib/devUser";
import { getMongoDatabase } from "@/lib/mongodb";

export type InventoryCondition = "POOR" | "FAIR" | "GOOD" | "EXCELLENT" | "UNKNOWN";
export type InventorySource = "MANUAL" | "PHOTO" | "DEMO" | "catalog" | "bestbuy" | "custom";

export interface MongoInventoryItem {
  _id: ObjectId | string;
  id?: string;
  userId: string;
  userProfileId: string;
  sourceKey: string;
  category: string;
  brand: string | null;
  model: string | null;
  exactModel: string | null;
  catalogProductId: string | null;
  deviceCatalogId?: string | null;
  rawProductTitle?: string | null;
  hasCatalogRatings?: boolean;
  externalId?: string | null;
  productUrl?: string | null;
  imageUrl?: string | null;
  priceCents?: number | null;
  currency?: string | null;
  productCondition?: string | null;
  specs: Record<string, unknown> | null;
  specsJson?: string | null;
  condition: InventoryCondition;
  ageYears: number | null;
  notes: string | null;
  source: InventorySource;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryApiItem {
  id: string;
  _id: string;
  userId: string;
  userProfileId: string;
  sourceKey: string;
  category: string;
  brand: string | null;
  model: string | null;
  exactModel: string | null;
  catalogProductId: string | null;
  deviceCatalogId: string | null;
  rawProductTitle: string | null;
  hasCatalogRatings: boolean;
  externalId: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  currency: string | null;
  productCondition: string | null;
  specs: Record<string, unknown> | null;
  specsJson: string | null;
  condition: InventoryCondition;
  ageYears: number | null;
  notes: string | null;
  source: InventorySource;
  createdAt: string;
  updatedAt: string;
}

export type PublicInventoryApiItem = Omit<InventoryApiItem, "userId" | "userProfileId" | "sourceKey">;

type MongoInventoryWritableFields = Omit<
  MongoInventoryItem,
  "_id" | "id" | "userId" | "userProfileId" | "sourceKey" | "createdAt" | "updatedAt" | "specs" | "specsJson"
>;

export type MongoInventoryCreateInput = MongoInventoryWritableFields & {
  id?: string;
  specs?: Record<string, unknown> | null;
  specsJson?: string | null;
};

export type MongoInventoryUpdateInput = Partial<MongoInventoryCreateInput>;

interface ValidationResult<T> {
  data: T | null;
  errors: Record<string, string>;
}

const inventoryConditionValues = ["POOR", "FAIR", "GOOD", "EXCELLENT", "UNKNOWN"] as const;
const inventorySourceValues = ["MANUAL", "PHOTO", "DEMO", "catalog", "bestbuy", "custom"] as const;
const MAX_PRICE_CENTS = 10_000_000;
const MAX_PRICE_USD = 100_000;
const MAX_TEXT_LENGTH = 1_000;

async function getInventoryCollection(): Promise<Collection<MongoInventoryItem>> {
  const database = await getMongoDatabase();
  return database.collection<MongoInventoryItem>("inventory_items");
}

function sanitizeString(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function emptyToNull(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && sanitizeString(value).length === 0) return null;
  return value;
}

function emptyToUndefined(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && sanitizeString(value).length === 0) return undefined;
  return value;
}

function normalizeUppercase(value: unknown): unknown {
  return typeof value === "string" ? sanitizeString(value).toUpperCase() : value;
}

function normalizeInventorySourceValue(value: unknown): unknown {
  const normalized = emptyToUndefined(value);
  if (normalized === undefined) return "custom";
  if (typeof normalized !== "string") return normalized;

  const source = sanitizeString(normalized).toLowerCase();
  if (source === "catalog" || source === "bestbuy" || source === "custom") return source;
  return source.toUpperCase();
}

function coerceNullableInt(value: unknown): unknown {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;
  if (typeof normalized === "number") return normalized;
  if (typeof normalized !== "string") return normalized;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : normalized;
}

function coerceOptionalNumber(value: unknown): unknown {
  const normalized = emptyToUndefined(value);
  if (normalized === undefined) return undefined;
  if (typeof normalized === "number") return normalized;
  if (typeof normalized !== "string") return normalized;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : normalized;
}

function coerceNullableNumber(value: unknown): unknown {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;
  if (typeof normalized === "number") return normalized;
  if (typeof normalized !== "string") return normalized;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : normalized;
}

function zodErrors(error: z.ZodError): Record<string, string> {
  return error.issues.reduce<Record<string, string>>((fields, issue) => {
    const key = issue.path.join(".") || "payload";
    fields[key] ??= issue.message;
    return fields;
  }, {});
}

function stringifyMongoId(value: ObjectId | string): string {
  return typeof value === "string" ? value : value.toHexString();
}

function toIsoDate(value: Date | string | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function parseStoredSpecsJson(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function inventorySpecs(item: Pick<MongoInventoryItem, "specs" | "specsJson">): Record<string, unknown> | null {
  return item.specs ?? parseStoredSpecsJson(item.specsJson);
}

function idFilter(itemId: string, userId: string): Filter<MongoInventoryItem> {
  const filters: Filter<MongoInventoryItem>[] = [{ _id: itemId, userId }];

  if (ObjectId.isValid(itemId)) {
    filters.push({ _id: new ObjectId(itemId), userId });
  }

  return { $or: filters };
}

export function serializeInventoryItem(item: MongoInventoryItem): InventoryApiItem {
  const id = stringifyMongoId(item._id);
  const specs = inventorySpecs(item);

  return {
    id,
    _id: id,
    userId: item.userId,
    userProfileId: item.userProfileId,
    sourceKey: item.sourceKey,
    category: item.category,
    brand: item.brand,
    model: item.model,
    exactModel: item.exactModel,
    catalogProductId: item.catalogProductId,
    deviceCatalogId: item.deviceCatalogId ?? item.catalogProductId,
    rawProductTitle: item.rawProductTitle ?? null,
    hasCatalogRatings: item.hasCatalogRatings ?? Boolean(item.catalogProductId),
    externalId: item.externalId ?? null,
    productUrl: item.productUrl ?? null,
    imageUrl: item.imageUrl ?? null,
    priceCents: item.priceCents ?? null,
    currency: item.currency ?? null,
    productCondition: item.productCondition ?? null,
    specs,
    specsJson: specs ? JSON.stringify(specs) : null,
    condition: item.condition,
    ageYears: item.ageYears,
    notes: item.notes,
    source: item.source,
    createdAt: toIsoDate(item.createdAt),
    updatedAt: toIsoDate(item.updatedAt),
  };
}

export function serializeInventoryItemForClient(item: MongoInventoryItem): PublicInventoryApiItem {
  const serialized = serializeInventoryItem(item);
  const publicItem: Partial<InventoryApiItem> = { ...serialized };

  delete publicItem.userId;
  delete publicItem.userProfileId;
  delete publicItem.sourceKey;

  return publicItem as PublicInventoryApiItem;
}

const requiredStringSchema = (field: string) =>
  z
    .string({ error: `${field} is required.` })
    .transform(sanitizeString)
    .pipe(z.string().min(1, `${field} is required.`).max(160, `${field} must be 160 characters or fewer.`));

const nullableStringSchema = z.preprocess(
  emptyToNull,
  z
    .string({ error: "Expected a string." })
    .transform(sanitizeString)
    .pipe(z.string().max(MAX_TEXT_LENGTH, `Must be ${MAX_TEXT_LENGTH} characters or fewer.`))
    .nullable(),
);

const optionalIdSchema = z.preprocess(
  emptyToUndefined,
  z
    .string({ error: "ID must be a string." })
    .transform(sanitizeString)
    .pipe(z.string().min(1, "ID cannot be empty.").max(128, "ID must be 128 characters or fewer."))
    .optional(),
);

const nullableAgeYearsSchema = z.preprocess(
  coerceNullableInt,
  z
    .number({ error: "Age must be a number." })
    .int("Age must be a whole number.")
    .min(0, "Age cannot be negative.")
    .max(100, "Age must be 100 years or fewer.")
    .nullable(),
);

const optionalPriceCentsSchema = z.preprocess(
  coerceOptionalNumber,
  z
    .number({ error: "Price must be a number." })
    .int("Price must be whole cents.")
    .min(0, "Price cannot be negative.")
    .max(MAX_PRICE_CENTS, "Price is outside the supported range.")
    .optional(),
);

const optionalPriceUsdSchema = z.preprocess(
  coerceOptionalNumber,
  z
    .number({ error: "Price must be a number." })
    .min(0, "Price cannot be negative.")
    .max(MAX_PRICE_USD, "Price is outside the supported range.")
    .optional(),
);

const nullablePriceCentsSchema = z.preprocess(
  coerceNullableNumber,
  z
    .number({ error: "Price must be a number." })
    .int("Price must be whole cents.")
    .min(0, "Price cannot be negative.")
    .max(MAX_PRICE_CENTS, "Price is outside the supported range.")
    .nullable(),
);

const booleanWithDefaultSchema = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const normalized = sanitizeString(value).toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return value;
  },
  z.boolean().default(false),
);

const traitScoreMapSchema = z.record(
  z.string().transform(sanitizeString).pipe(z.string().min(1, "Trait names cannot be empty.")),
  z
    .number({ error: "Trait scores must be numbers." })
    .min(0, "Trait scores must be between 0 and 10.")
    .max(10, "Trait scores must be between 0 and 10."),
);

const optionalTraitScoreMapSchema = traitScoreMapSchema.optional();
const optionalTraitsSchema = z.preprocess(
  (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : undefined),
  optionalTraitScoreMapSchema,
);

const nullableSpecsSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    return value;
  },
  z.record(z.string(), z.unknown()).nullable(),
);

function normalizeInventoryPayload(payload: unknown): ValidationResult<Record<string, unknown>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      data: {},
      errors: {},
    };
  }

  const normalized = { ...(payload as Record<string, unknown>) };
  const rawSpecsJson = normalized.specsJson;

  if (typeof rawSpecsJson === "string") {
    const trimmed = rawSpecsJson.trim();
    delete normalized.specsJson;

    if (trimmed.length === 0) {
      if (normalized.specs === undefined) normalized.specs = null;
      return { data: normalized, errors: {} };
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          data: null,
          errors: { specsJson: "Specs must be valid JSON." },
        };
      }

      normalized.specs = parsed as Record<string, unknown>;
    } catch {
      return {
        data: null,
        errors: { specsJson: "Specs must be valid JSON." },
      };
    }
  } else if (rawSpecsJson === null || rawSpecsJson === undefined) {
    delete normalized.specsJson;
  }

  return {
    data: normalized,
    errors: {},
  };
}

const inventoryInputSchema = z.object({
  id: optionalIdSchema,
  category: requiredStringSchema("Category"),
  brand: nullableStringSchema,
  model: nullableStringSchema,
  exactModel: nullableStringSchema,
  catalogProductId: nullableStringSchema,
  deviceCatalogId: nullableStringSchema,
  rawProductTitle: nullableStringSchema,
  hasCatalogRatings: booleanWithDefaultSchema,
  externalId: nullableStringSchema,
  productUrl: nullableStringSchema,
  imageUrl: nullableStringSchema,
  priceCents: nullablePriceCentsSchema,
  currency: nullableStringSchema,
  productCondition: nullableStringSchema,
  specs: nullableSpecsSchema,
  condition: z.preprocess(
    normalizeUppercase,
    z.enum(inventoryConditionValues, {
      error: "Condition must be POOR, FAIR, GOOD, EXCELLENT, or UNKNOWN.",
    }),
  ),
  ageYears: nullableAgeYearsSchema,
  notes: nullableStringSchema,
  source: z.preprocess(
    normalizeInventorySourceValue,
    z.enum(inventorySourceValues, {
      error: "Source must be MANUAL, PHOTO, DEMO, catalog, bestbuy, or custom.",
    }),
  ),
  estimatedPriceCents: optionalPriceCentsSchema,
  typicalUsedPriceCents: optionalPriceCentsSchema,
  price: optionalPriceUsdSchema,
  priceUsd: optionalPriceUsdSchema,
  traitRatings: optionalTraitScoreMapSchema,
  traitScores: optionalTraitScoreMapSchema,
  traits: optionalTraitsSchema,
});

export function validateInventoryCreateInput(payload: unknown): ValidationResult<MongoInventoryCreateInput> {
  const normalized = normalizeInventoryPayload(payload);
  if (!normalized.data) {
    return { data: null, errors: normalized.errors };
  }

  const result = inventoryInputSchema.safeParse(normalized.data);

  if (!result.success) {
    return { data: null, errors: zodErrors(result.error) };
  }

  const input = result.data;
  const deviceCatalogId = input.deviceCatalogId ?? input.catalogProductId;

  return {
    data: {
      id: input.id,
      category: input.category,
      brand: input.brand,
      model: input.model,
      exactModel: input.exactModel,
      catalogProductId: input.catalogProductId,
      deviceCatalogId,
      rawProductTitle: input.rawProductTitle,
      hasCatalogRatings: input.hasCatalogRatings || Boolean(deviceCatalogId),
      externalId: input.externalId,
      productUrl: input.productUrl,
      imageUrl: input.imageUrl,
      priceCents: input.priceCents,
      currency: input.currency,
      productCondition: input.productCondition,
      specs: input.specs,
      condition: input.condition,
      ageYears: input.ageYears,
      notes: input.notes,
      source: input.source,
    },
    errors: {},
  };
}

export function validateInventoryUpdateInput(
  payload: unknown,
  existing: MongoInventoryItem,
): ValidationResult<MongoInventoryCreateInput> {
  const input = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const fieldOrExisting = <K extends keyof MongoInventoryCreateInput>(field: K): MongoInventoryCreateInput[K] | unknown =>
    Object.prototype.hasOwnProperty.call(input, field) ? input[field] : existing[field];

  return validateInventoryCreateInput({
    category: fieldOrExisting("category"),
    brand: fieldOrExisting("brand"),
    model: fieldOrExisting("model"),
    exactModel: fieldOrExisting("exactModel"),
    catalogProductId: fieldOrExisting("catalogProductId"),
    deviceCatalogId: fieldOrExisting("deviceCatalogId"),
    rawProductTitle: fieldOrExisting("rawProductTitle"),
    hasCatalogRatings: fieldOrExisting("hasCatalogRatings"),
    externalId: fieldOrExisting("externalId"),
    productUrl: fieldOrExisting("productUrl"),
    imageUrl: fieldOrExisting("imageUrl"),
    priceCents: fieldOrExisting("priceCents"),
    currency: fieldOrExisting("currency"),
    productCondition: fieldOrExisting("productCondition"),
    specs: fieldOrExisting("specs"),
    condition: fieldOrExisting("condition"),
    ageYears: fieldOrExisting("ageYears"),
    notes: fieldOrExisting("notes"),
    source: fieldOrExisting("source"),
    estimatedPriceCents: input.estimatedPriceCents,
    typicalUsedPriceCents: input.typicalUsedPriceCents,
    price: input.price,
    priceUsd: input.priceUsd,
    traitRatings: input.traitRatings,
    traitScores: input.traitScores,
    traits: input.traits,
  });
}

function buildInventoryDocument(userId: string, input: MongoInventoryCreateInput, now = new Date()): MongoInventoryItem {
  const _id = input.id && ObjectId.isValid(input.id) ? new ObjectId(input.id) : new ObjectId();
  const id = stringifyMongoId(_id);

  return {
    _id,
    id,
    userId,
    userProfileId: userId,
    sourceKey: `inventory:${userId}:${id}`,
    category: input.category,
    brand: input.brand,
    model: input.model,
    exactModel: input.exactModel,
    catalogProductId: input.catalogProductId,
    deviceCatalogId: input.deviceCatalogId ?? input.catalogProductId,
    rawProductTitle: input.rawProductTitle,
    hasCatalogRatings: input.hasCatalogRatings ?? Boolean(input.catalogProductId),
    externalId: input.externalId,
    productUrl: input.productUrl,
    imageUrl: input.imageUrl,
    priceCents: input.priceCents,
    currency: input.currency,
    productCondition: input.productCondition,
    specs: input.specs ?? null,
    condition: input.condition,
    ageYears: input.ageYears,
    notes: input.notes,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
}

function requireValidInventoryInput(input: MongoInventoryCreateInput): MongoInventoryCreateInput {
  const result = validateInventoryCreateInput(input);
  if (!result.data) {
    throw new Error(`Invalid inventory item: ${Object.keys(result.errors).join(", ")}`);
  }

  return result.data;
}

export async function listInventoryItemsForUser(userId: string): Promise<MongoInventoryItem[]> {
  const inventory = await getInventoryCollection();

  return inventory.find({ userId }).sort({ updatedAt: -1, createdAt: -1 }).toArray();
}

export async function countInventoryItemsForUser(userId: string): Promise<number> {
  const inventory = await getInventoryCollection();

  return inventory.countDocuments({ userId });
}

export async function findInventoryItemForUser(userId: string, itemId: string): Promise<MongoInventoryItem | null> {
  const inventory = await getInventoryCollection();

  return inventory.findOne(idFilter(itemId, userId));
}

export async function createInventoryItemForUser(
  userId: string,
  input: MongoInventoryCreateInput,
): Promise<MongoInventoryItem> {
  const inventory = await getInventoryCollection();
  const document = buildInventoryDocument(userId, requireValidInventoryInput(input));

  await inventory.insertOne(document);
  return document;
}

export async function createManyInventoryItemsForUser(
  userId: string,
  inputs: MongoInventoryCreateInput[],
): Promise<MongoInventoryItem[]> {
  if (inputs.length === 0) return [];

  const inventory = await getInventoryCollection();
  const now = new Date();
  const documents = inputs.map((input) => buildInventoryDocument(userId, requireValidInventoryInput(input), now));

  await inventory.insertMany(documents);
  return documents;
}

export async function replaceInventoryItemsForUser(
  userId: string,
  inputs: MongoInventoryCreateInput[],
): Promise<MongoInventoryItem[]> {
  const inventory = await getInventoryCollection();

  await inventory.deleteMany({ userId });
  return createManyInventoryItemsForUser(userId, inputs);
}

export async function updateInventoryItemForUser(
  userId: string,
  itemId: string,
  input: MongoInventoryCreateInput,
): Promise<MongoInventoryItem | null> {
  const inventory = await getInventoryCollection();
  const updatedAt = new Date();
  const cleanInput = requireValidInventoryInput(input);

  await inventory.updateOne(idFilter(itemId, userId), {
    $set: {
      category: cleanInput.category,
      brand: cleanInput.brand,
      model: cleanInput.model,
      exactModel: cleanInput.exactModel,
      catalogProductId: cleanInput.catalogProductId,
      deviceCatalogId: cleanInput.deviceCatalogId ?? cleanInput.catalogProductId,
      rawProductTitle: cleanInput.rawProductTitle,
      hasCatalogRatings: cleanInput.hasCatalogRatings ?? Boolean(cleanInput.catalogProductId),
      externalId: cleanInput.externalId,
      productUrl: cleanInput.productUrl,
      imageUrl: cleanInput.imageUrl,
      priceCents: cleanInput.priceCents,
      currency: cleanInput.currency,
      productCondition: cleanInput.productCondition,
      specs: cleanInput.specs ?? null,
      condition: cleanInput.condition,
      ageYears: cleanInput.ageYears,
      notes: cleanInput.notes,
      source: cleanInput.source,
      updatedAt,
    },
    $unset: {
      specsJson: "",
    },
  });

  return findInventoryItemForUser(userId, itemId);
}

export async function deleteInventoryItemForUser(userId: string, itemId: string): Promise<boolean> {
  const inventory = await getInventoryCollection();
  const result = await inventory.deleteOne(idFilter(itemId, userId));

  return result.deletedCount > 0;
}

export async function deleteInventoryItemsForUser(userId: string): Promise<void> {
  const inventory = await getInventoryCollection();

  await inventory.deleteMany({ userId });
}

export async function listDevInventoryItems(): Promise<MongoInventoryItem[]> {
  return listInventoryItemsForUser(await getCurrentInventoryUserId());
}

export async function countDevInventoryItems(): Promise<number> {
  return countInventoryItemsForUser(await getCurrentInventoryUserId());
}

export async function createDevInventoryItem(input: MongoInventoryCreateInput): Promise<MongoInventoryItem> {
  return createInventoryItemForUser(await getCurrentInventoryUserId(), input);
}

export async function createManyDevInventoryItems(inputs: MongoInventoryCreateInput[]): Promise<MongoInventoryItem[]> {
  return createManyInventoryItemsForUser(await getCurrentInventoryUserId(), inputs);
}

export async function replaceDevInventoryItems(inputs: MongoInventoryCreateInput[]): Promise<MongoInventoryItem[]> {
  return replaceInventoryItemsForUser(await getCurrentInventoryUserId(), inputs);
}

export async function updateDevInventoryItem(
  itemId: string,
  input: MongoInventoryCreateInput,
): Promise<MongoInventoryItem | null> {
  return updateInventoryItemForUser(await getCurrentInventoryUserId(), itemId, input);
}

export async function deleteDevInventoryItem(itemId: string): Promise<boolean> {
  return deleteInventoryItemForUser(await getCurrentInventoryUserId(), itemId);
}

export async function deleteDevInventoryItems(): Promise<void> {
  return deleteInventoryItemsForUser(await getCurrentInventoryUserId());
}
