import type { SavedProduct, UserProfile as PrismaUserProfile } from "@prisma/client";
import { productCatalog } from "@/data/seeds/productCatalog";
import { getCachedAvailabilitySummaries, type AvailabilityProductModel, type AvailabilitySummary } from "@/lib/availability";
import { loadCachedRecommendationPriceSnapshots } from "@/lib/availability/priceSnapshots";
import { db } from "@/lib/db";
import { getCurrentMongoUser } from "@/lib/devUser";
import { listInventoryItemsForUser, type MongoInventoryItem } from "@/lib/inventory/mongoInventory";
import { parseProfileMetadata } from "@/lib/profileMetadata";
import { loadMongoRecommendationProducts, recommendationProductToAvailabilityModel } from "@/lib/recommendation/mongoDeviceProducts";
import {
  normalizeInventoryCategories,
  normalizeRoomConstraints,
  normalizeUserPreferences,
  normalizeUserProblems,
  type InventoryItem,
  type PrivateRecommendationProfile,
  type Product,
  type RecommendationPriceSnapshot,
  type UserProblem,
  type UserProfile,
} from "@/lib/recommendation/types";
import { getUserPrivateProfileForRecommendationsForUser, type UserPrivateProfile } from "@/lib/userPrivateProfiles";

interface LoadedRecommendationContext {
  profileId: string;
  profile: UserProfile;
  inventory: InventoryItem[];
  savedProductIds: Set<string>;
  demoScenarioId: string | null;
  usedItemsOkay: boolean;
  exactCurrentModelsProvided: boolean;
  ports: string[];
  deviceType: "desktop" | "laptop" | "tablet" | "unknown";
  privateProfile: PrivateRecommendationProfile | null;
  availabilityByProductId: Map<string, AvailabilitySummary>;
  pricingByProductId: Map<string, RecommendationPriceSnapshot>;
  candidateProducts: Product[];
}

type RecommendationContextProfileRecord = PrismaUserProfile & {
  savedProducts: SavedProduct[];
};

const productIdAliasMap: Record<string, string> = {
  "desk_lamp-benq-screenbar": "lamp-benq-screenbar",
};

const inventoryProblemMatchers: Array<[UserProblem, RegExp]> = [
  ["eye_strain", /\beye|glare|screen fatigue|fatigue\b/i],
  ["neck_pain", /\bneck|hunch|posture\b/i],
  ["wrist_pain", /\bwrist|trackpad|typing strain|ergonomic\b/i],
  ["back_pain", /\bback|lumbar|chair\b/i],
  ["low_productivity", /\bslow|muffled|call|productiv|friction\b/i],
  ["poor_focus", /\bfocus|distract|noise|clutter\b/i],
  ["noise_sensitivity", /\bnoise|loud|shared\b/i],
  ["clutter", /\bclutter|cable|mess\b/i],
  ["bad_lighting", /\blight|dim|dark\b/i],
];

const lightingValues = new Set(["low", "mixed", "bright"]);

function normalizeLighting(value: unknown): UserProfile["constraints"]["roomLighting"] {
  if (typeof value !== "string") return "mixed";
  const normalized = value.trim().toLowerCase();
  return lightingValues.has(normalized) ? (normalized as UserProfile["constraints"]["roomLighting"]) : "mixed";
}

function normalizeSpendingStyle(value: string): UserProfile["spendingStyle"] {
  const normalized = value.trim();
  if (normalized === "PREMIUM") return "premium";
  if (normalized === "FRUGAL") return "frugal";
  if (normalized === "VALUE") return "VALUE";
  if (normalized === "LEAN") return "lean";
  if (normalized === "BALANCED") return "balanced";
  return normalized.length > 0 ? (normalized as UserProfile["spendingStyle"]) : "balanced";
}

function parseSpecs(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function canonicalizeProductId(productId: string): string {
  return productIdAliasMap[productId] ?? productId;
}

function inferPainPoints(text: string): UserProblem[] {
  return inventoryProblemMatchers
    .filter(([, matcher]) => matcher.test(text))
    .map(([problem]) => problem);
}

function mapInventoryCondition(value: string): InventoryItem["condition"] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "poor" || normalized === "fair" || normalized === "good" || normalized === "excellent") {
    return normalized;
  }
  return "unknown";
}

function mapInventoryItem(
  item: Pick<
    MongoInventoryItem,
    "_id" | "category" | "brand" | "model" | "exactModel" | "specs" | "specsJson" | "condition" | "notes"
  >,
): InventoryItem {
  const category = normalizeInventoryCategories(item.category)[0] ?? "unknown";
  const name =
    item.exactModel?.trim() ||
    [item.brand, item.model]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" ")
      .trim() ||
    category.replaceAll("_", " ");
  const notesText = `${item.exactModel ?? ""} ${item.model ?? ""} ${item.notes ?? ""}`.trim();

  return {
    id: String(item._id),
    name,
    category,
    condition: mapInventoryCondition(item.condition),
    painPoints: inferPainPoints(notesText),
    specs: item.specs ?? parseSpecs(item.specsJson ?? null),
  };
}

function mapPrivateProfile(profile: UserPrivateProfile | null): PrivateRecommendationProfile | null {
  if (!profile) return null;

  return {
    profession: profile.profession,
    primaryUseCases: profile.primaryUseCases,
    heightCm: profile.heightCm,
    handLengthMm: profile.handLengthMm,
    palmWidthMm: profile.palmWidthMm,
    dominantHand: profile.dominantHand,
    gripStyle: profile.gripStyle,
    comfortPriorities: profile.comfortPriorities,
    sensitivity: profile.sensitivity,
  };
}

function buildCheckingSummary(productModelId: string): AvailabilitySummary {
  return {
    provider: null,
    productModelId,
    status: "checking_not_configured",
    label: "Checking not configured",
    listings: [],
    bestListing: null,
    checkedAt: null,
    refreshSource: "not_configured",
  };
}

async function loadRecommendationProducts(): Promise<Product[]> {
  try {
    const products = await loadMongoRecommendationProducts();
    return products.length > 0 ? products : productCatalog;
  } catch (error) {
    console.warn("Falling back to static product catalog for recommendations.", error);
    return productCatalog;
  }
}

async function loadMongoRecommendationUserData(): Promise<{
  inventoryRecords: MongoInventoryItem[];
  privateProfileRecord: UserPrivateProfile | null;
}> {
  try {
    const mongoUser = await getCurrentMongoUser();
    const [inventoryRecords, privateProfileRecord] = await Promise.all([
      listInventoryItemsForUser(mongoUser.id),
      getUserPrivateProfileForRecommendationsForUser(mongoUser.id),
    ]);

    return {
      inventoryRecords,
      privateProfileRecord,
    };
  } catch (error) {
    console.warn("Falling back to empty recommendation inventory.", error);
    return {
      inventoryRecords: [],
      privateProfileRecord: null,
    };
  }
}

async function loadSeededAvailability(
  availabilityProductModels: AvailabilityProductModel[],
): Promise<Record<string, AvailabilitySummary>> {
  try {
    return await getCachedAvailabilitySummaries(availabilityProductModels);
  } catch (error) {
    console.warn("Falling back to checking availability state.", error);
    return Object.fromEntries(
      availabilityProductModels.map((productModel) => [productModel.id, buildCheckingSummary(productModel.id)]),
    );
  }
}

async function loadSeededPricing(
  availabilityProductModels: AvailabilityProductModel[],
): Promise<Record<string, RecommendationPriceSnapshot>> {
  try {
    return await loadCachedRecommendationPriceSnapshots(availabilityProductModels);
  } catch (error) {
    console.warn("Falling back to empty recommendation pricing cache.", error);
    return {};
  }
}

async function loadRecommendationContextForProfile(
  activeProfile: RecommendationContextProfileRecord | null,
): Promise<LoadedRecommendationContext | null> {
  if (!activeProfile) return null;

  const metadata = parseProfileMetadata(activeProfile.roomConstraints);
  const rawConstraints = metadata.rawConstraints;
  const { inventoryRecords, privateProfileRecord } = await loadMongoRecommendationUserData();
  const inventory = inventoryRecords.map(mapInventoryItem);
  const privateProfile = mapPrivateProfile(privateProfileRecord);
  const profile: UserProfile = {
    id: activeProfile.id,
    name: activeProfile.name?.trim() || "User",
    ageRange: activeProfile.ageRange?.trim() || "Unknown",
    profession: activeProfile.profession,
    budgetUsd: Math.round(activeProfile.budgetCents / 100),
    spendingStyle: normalizeSpendingStyle(activeProfile.spendingStyle),
    preferences: normalizeUserPreferences(activeProfile.preferences),
    problems: normalizeUserProblems(activeProfile.problems),
    accessibilityNeeds: normalizeUserPreferences(activeProfile.accessibilityNeeds),
    roomConstraints: normalizeRoomConstraints(activeProfile.roomConstraints),
    constraints: {
      deskWidthInches: Number(rawConstraints.deskWidthInches) || 36,
      roomLighting: normalizeLighting(rawConstraints.roomLighting),
      sharesSpace: rawConstraints.sharesSpace === true,
      portableSetup: rawConstraints.portableSetup === true,
    },
  };

  const savedProductIds = new Set(activeProfile.savedProducts.map((item) => canonicalizeProductId(item.productModelId)));
  const candidateProducts = await loadRecommendationProducts();
  const availabilityProductModels: AvailabilityProductModel[] = candidateProducts.map((product) =>
    recommendationProductToAvailabilityModel(product, { allowUsed: activeProfile.usedItemsOkay }),
  );
  const [seededAvailability, seededPricing] = await Promise.all([
    loadSeededAvailability(availabilityProductModels),
    loadSeededPricing(availabilityProductModels),
  ]);
  const availabilityByProductId = new Map<string, AvailabilitySummary>(
    Object.entries(seededAvailability).map(([productId, summary]) => [canonicalizeProductId(productId), summary]),
  );
  const pricingByProductId = new Map<string, RecommendationPriceSnapshot>(
    Object.entries(seededPricing).map(([productId, pricing]) => [canonicalizeProductId(productId), pricing]),
  );

  for (const productId of savedProductIds) {
    if (!availabilityByProductId.has(productId)) {
      availabilityByProductId.set(productId, buildCheckingSummary(productId));
    }
  }

  return {
    profileId: activeProfile.id,
    profile,
    inventory,
    savedProductIds,
    demoScenarioId: metadata.demoScenarioId,
    usedItemsOkay: activeProfile.usedItemsOkay,
    exactCurrentModelsProvided: inventoryRecords.some((item) => Boolean(item.exactModel?.trim())),
    ports: metadata.ports,
    deviceType: metadata.deviceType,
    privateProfile,
    availabilityByProductId,
    pricingByProductId,
    candidateProducts,
  };
}

export async function loadRecommendationContext(): Promise<LoadedRecommendationContext | null> {
  let activeProfile: RecommendationContextProfileRecord | null;

  try {
    activeProfile =
      (await db.userProfile.findUnique({
        where: { id: "demo-profile" },
        include: { savedProducts: true },
      })) ??
      (await db.userProfile.findFirst({
        include: { savedProducts: true },
        orderBy: { createdAt: "desc" },
      }));
  } catch (error) {
    console.warn("Unable to load recommendation profile.", error);
    return null;
  }

  return loadRecommendationContextForProfile(activeProfile);
}

export async function loadLatestRecommendationContext(): Promise<LoadedRecommendationContext | null> {
  const activeProfile = await db.userProfile.findFirst({
    include: { savedProducts: true },
    orderBy: { createdAt: "desc" },
  });

  return loadRecommendationContextForProfile(activeProfile);
}

export function productIdAliases(productId: string): string[] {
  const canonical = canonicalizeProductId(productId);
  return Array.from(new Set([productId, canonical, ...Object.keys(productIdAliasMap).filter((key) => productIdAliasMap[key] === canonical)]));
}

export function getAvailabilityForProduct(
  availabilityByProductId: Map<string, AvailabilitySummary>,
  productId: string,
): AvailabilitySummary {
  return availabilityByProductId.get(canonicalizeProductId(productId)) ?? buildCheckingSummary(productId);
}
