import type { UserProfile as PrismaUserProfile } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentMongoUser } from "@/lib/devUser";
import { listInventoryItemsForUser, serializeInventoryItem, type MongoInventoryItem } from "@/lib/inventory/mongoInventory";
import { parseProfileMetadata } from "@/lib/profileMetadata";
import { hackathonDemoProfile, serializeHackathonDemoProfile } from "@/lib/recommendation/demoMode";
import type { InventoryCategory, PrivateRecommendationProfile, RecommendationInput, RoomConstraint, UserProblem, UserProfile } from "@/lib/recommendation/types";
import {
  normalizeInventoryCategories,
  normalizeRoomConstraints,
  normalizeUserPreferences,
  normalizeUserProblems,
} from "@/lib/recommendation/types";
import { getCurrentUserPrivateProfile, type UserPrivateProfile } from "@/lib/userPrivateProfiles";

const CURRENT_USER_ID = hackathonDemoProfile.id;

const defaultRoomConstraints = {
  deskWidthInches: 44,
  roomLighting: "mixed" as const,
  sharesSpace: true,
  portableSetup: false,
};

const defaultProfileSeed = {
  id: CURRENT_USER_ID,
  ...serializeHackathonDemoProfile(),
};

const problemKeywords: Array<[UserProblem, string[]]> = [
  ["eye_strain", ["eye strain", "eyes", "screen glare", "glare"]],
  ["neck_pain", ["neck", "hunch", "posture"]],
  ["wrist_pain", ["wrist", "trackpad", "typing fatigue"]],
  ["back_pain", ["back", "lumbar", "chair discomfort"]],
  ["slow_computer", ["slow", "lag", "performance", "beachball"]],
  ["low_productivity", ["productivity", "multitask", "calls", "workflow"]],
  ["poor_focus", ["focus", "distracting", "noise", "concentration"]],
  ["bad_lighting", ["lighting", "dark", "dim", "shadow"]],
];

export interface InventoryListItem {
  id: string;
  name: string;
  category: InventoryCategory;
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
  specsJson: string | null;
  specs?: Record<string, unknown>;
  condition: "poor" | "fair" | "good" | "excellent" | "unknown";
  ageYears: number | null;
  notes: string | null;
  source: "manual" | "photo" | "demo" | "catalog" | "bestbuy" | "custom";
  displayName: string;
  painPoints: UserProblem[];
}

export interface CurrentUserContext {
  userId: string;
  profileRecord: PrismaUserProfile;
  inventoryRecords: MongoInventoryItem[];
  profile: UserProfile;
  inventory: InventoryListItem[];
  allowRecommendationHistory: boolean;
  recommendationInput: RecommendationInput;
}

function parseJson(value: string | null): unknown {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseSpecs(value: string | null, fallback?: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
    return fallback;
  }

  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}

function normalizeSpendingStyle(value: string): UserProfile["spendingStyle"] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "frugal") return "frugal";
  if (normalized === "value") return "VALUE";
  if (normalized === "premium") return "premium";
  return "balanced";
}

function parseConstraintObject(value: string | null): UserProfile["constraints"] {
  const parsed = parseJson(value);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const constraints = parsed as Record<string, unknown>;

    return {
      deskWidthInches: Number(constraints.deskWidthInches ?? defaultRoomConstraints.deskWidthInches),
      roomLighting:
        constraints.roomLighting === "low" || constraints.roomLighting === "bright"
          ? constraints.roomLighting
          : defaultRoomConstraints.roomLighting,
      sharesSpace: Boolean(constraints.sharesSpace),
      portableSetup: Boolean(constraints.portableSetup),
    };
  }

  const roomConstraints = normalizeRoomConstraints(value);

  return {
    deskWidthInches: roomConstraints.includes("limited_desk_width") ? 36 : defaultRoomConstraints.deskWidthInches,
    roomLighting: roomConstraints.includes("low_light")
      ? "low"
      : roomConstraints.includes("bright_lighting")
        ? "bright"
        : defaultRoomConstraints.roomLighting,
    sharesSpace: roomConstraints.includes("shared_space"),
    portableSetup: roomConstraints.includes("portable_setup"),
  };
}

function buildDisplayName(item: Pick<MongoInventoryItem, "brand" | "model" | "exactModel" | "category" | "rawProductTitle">): string {
  const base = [item.brand, item.model].filter(Boolean).join(" ").trim();
  if (item.exactModel?.trim()) {
    return base ? `${base} (${item.exactModel.trim()})` : item.exactModel.trim();
  }

  if (base) return base;
  if (item.rawProductTitle?.trim()) return item.rawProductTitle.trim();
  return item.category.replaceAll("_", " ");
}

function inferPainPoints(item: Pick<MongoInventoryItem, "notes" | "model" | "exactModel" | "brand">): UserProblem[] {
  const text = [item.brand, item.model, item.exactModel, item.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return problemKeywords
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))
    .map(([problem]) => problem);
}

function normalizeInventorySource(value: string): InventoryListItem["source"] {
  const normalized = value.toLowerCase();
  if (normalized === "photo") return "photo";
  if (normalized === "demo") return "demo";
  if (normalized === "catalog") return "catalog";
  if (normalized === "bestbuy") return "bestbuy";
  if (normalized === "custom") return "custom";
  return "manual";
}

function mapInventoryItem(record: MongoInventoryItem): InventoryListItem {
  const serialized = serializeInventoryItem(record);
  const category = normalizeInventoryCategories(record.category)[0] ?? "other";
  const displayName = buildDisplayName(record);

  return {
    id: serialized.id,
    name: displayName,
    category,
    brand: record.brand,
    model: record.model,
    exactModel: record.exactModel,
    catalogProductId: record.catalogProductId,
    deviceCatalogId: record.deviceCatalogId ?? record.catalogProductId,
    rawProductTitle: record.rawProductTitle ?? null,
    hasCatalogRatings: record.hasCatalogRatings ?? Boolean(record.catalogProductId),
    externalId: record.externalId ?? null,
    productUrl: record.productUrl ?? null,
    imageUrl: record.imageUrl ?? null,
    priceCents: record.priceCents ?? null,
    currency: record.currency ?? null,
    productCondition: record.productCondition ?? null,
    specsJson: serialized.specsJson,
    specs: parseSpecs(serialized.specsJson, serialized.specs),
    condition: record.condition.toLowerCase() as InventoryListItem["condition"],
    ageYears: record.ageYears ?? null,
    notes: record.notes,
    source: normalizeInventorySource(record.source),
    displayName,
    painPoints: inferPainPoints(record),
  };
}

function mapUserProfile(record: PrismaUserProfile): UserProfile {
  const roomConstraints = normalizeRoomConstraints(record.roomConstraints) as RoomConstraint[];
  const constraints = parseConstraintObject(record.roomConstraints);

  return {
    id: record.id,
    name: record.name ?? "Current user",
    ageRange: record.ageRange ?? "Unknown",
    profession: record.profession,
    budgetUsd: Math.max(0, Math.round(record.budgetCents / 100)),
    spendingStyle: normalizeSpendingStyle(record.spendingStyle),
    preferences: normalizeUserPreferences(record.preferences),
    problems: normalizeUserProblems(record.problems),
    accessibilityNeeds: normalizeUserPreferences(record.accessibilityNeeds),
    roomConstraints,
    constraints,
  };
}

function mapPrivateProfile(profile: UserPrivateProfile | null): PrivateRecommendationProfile | null {
  if (!profile?.privacy.allowProfileForRecommendations) return null;

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

export async function ensureCurrentUserProfile(): Promise<PrismaUserProfile> {
  return db.userProfile.upsert({
    where: { id: CURRENT_USER_ID },
    update: {},
    create: defaultProfileSeed,
  });
}

export async function getCurrentUserContext(): Promise<CurrentUserContext | null> {
  const profileRecord = await db.userProfile.findUnique({
    where: { id: CURRENT_USER_ID },
  });

  if (!profileRecord) return null;

  const mongoUser = await getCurrentMongoUser();
  const [inventoryRecords, privateProfileRecord] = await Promise.all([
    listInventoryItemsForUser(mongoUser.id),
    getCurrentUserPrivateProfile(),
  ]);

  const profile = mapUserProfile(profileRecord);
  const metadata = parseProfileMetadata(profileRecord.roomConstraints);
  const inventory = inventoryRecords.map(mapInventoryItem);
  const exactCurrentModelsProvided = inventoryRecords.some(
    (item) => Boolean(item.model?.trim()) || Boolean(item.exactModel?.trim()),
  );
  const deviceType =
    metadata.deviceType === "unknown" && (inventory.some((item) => item.category === "laptop") || profile.constraints.portableSetup)
      ? "laptop"
      : metadata.deviceType;

  return {
    userId: mongoUser.id,
    profileRecord,
    inventoryRecords,
    profile,
    inventory,
    allowRecommendationHistory: privateProfileRecord?.privacy.allowRecommendationHistory ?? true,
    recommendationInput: {
      profile,
      inventory,
      exactCurrentModelsProvided: inventory.length > 0 ? exactCurrentModelsProvided : undefined,
      deviceType,
      ports: metadata.ports,
      usedItemsOkay: profileRecord.usedItemsOkay,
      privateProfile: mapPrivateProfile(privateProfileRecord),
    },
  };
}
