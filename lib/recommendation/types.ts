import type { AvailabilitySummary } from "../availability/types";
import type { DeviceDelta, DeviceErgonomicSpecs, DeviceTraitRatings, NormalizedDeviceSpecs } from "../devices/deviceTypes";
import { DEVICE_CATEGORIES, type DeviceCategory } from "../devices/deviceTypes";

export const USER_PROBLEMS = [
  "eye_strain",
  "neck_pain",
  "wrist_pain",
  "back_pain",
  "slow_computer",
  "low_productivity",
  "poor_focus",
  "noise_sensitivity",
  "clutter",
  "bad_lighting",
  "limited_mobility",
  "small_space",
  "budget_limited",
] as const;

export type UserProblem = (typeof USER_PROBLEMS)[number];

export type UserPreference = string;

export const ROOM_CONSTRAINTS = [
  "small_space",
  "shared_space",
  "portable_setup",
  "limited_desk_width",
  "low_light",
  "mixed_lighting",
  "bright_lighting",
  "limited_mobility",
  "needs_quiet",
  "cluttered_desk",
] as const;

export type RoomConstraint = (typeof ROOM_CONSTRAINTS)[number];

export const PRODUCT_CATEGORIES = [
  "laptop",
  "monitor",
  "laptop_stand",
  "keyboard",
  "mouse",
  "chair",
  "desk_lamp",
  "headphones",
  "webcam",
  "storage",
  "cable_management",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type InventoryCategory = ProductCategory | DeviceCategory | "other" | "unknown";

export type BudgetTier = "lean" | "balanced" | "premium" | "frugal" | "value" | "FRUGAL" | "VALUE";
export type Problem = UserProblem;

export interface ScoreBreakdown {
  problemFit: number;
  ergonomicFit: number;
  traitDeltaFit: number;
  constraintFit: number;
  valueFit: number;
  compatibilityFit: number;
  availabilityFit: number;
  confidence: number;
  finalScore: number;
}

export interface PrivateRecommendationProfile {
  profession?: string;
  primaryUseCases: string[];
  heightCm?: number;
  handLengthMm?: number;
  palmWidthMm?: number;
  dominantHand?: "left" | "right" | "ambidextrous";
  gripStyle?: "palm" | "claw" | "fingertip" | "unknown";
  comfortPriorities: {
    lowNoise: boolean;
    lightweight: boolean;
    ergonomic: boolean;
    portability: boolean;
    largeDisplay: boolean;
    compactSize: boolean;
  };
  sensitivity: {
    wristStrain: boolean;
    fingerFatigue: boolean;
    hearingSensitive: boolean;
    eyeStrain: boolean;
  };
}

export interface UserProfile {
  id: string;
  name: string;
  ageRange: string;
  profession: string;
  budgetUsd: number;
  spendingStyle: BudgetTier;
  preferences: UserPreference[];
  problems: UserProblem[];
  accessibilityNeeds: string[];
  roomConstraints?: RoomConstraint[];
  constraints: {
    deskWidthInches: number;
    roomLighting: "low" | "mixed" | "bright";
    sharesSpace: boolean;
    portableSetup: boolean;
  };
}

export interface InventoryItem {
  id: string;
  name: string;
  category: InventoryCategory;
  brand?: string | null;
  model?: string | null;
  rawProductTitle?: string | null;
  source?: "manual" | "photo" | "demo" | "catalog" | "bestbuy" | "custom";
  priceCents?: number | null;
  deviceCatalogId?: string | null;
  catalogProductId?: string | null;
  hasCatalogRatings?: boolean;
  condition: "poor" | "fair" | "good" | "excellent" | "unknown";
  painPoints: UserProblem[];
  specs?: Record<string, unknown>;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: ProductCategory;
  priceUsd: number;
  estimatedPriceCents?: number;
  typicalUsedPriceCents?: number;
  shortDescription: string;
  strengths: string[];
  solves: UserProblem[];
  aspirational?: boolean;
  constraints: {
    minDeskWidthInches?: number;
    portable?: boolean;
    quiet?: boolean;
  };
  ergonomicSpecs?: DeviceErgonomicSpecs;
  normalizedSpecs?: NormalizedDeviceSpecs;
  traitRatings?: DeviceTraitRatings;
  traitConfidence?: number;
  catalogDeviceId?: string;
  scoreHints: {
    comfort: number;
    productivity: number;
    accessibility: number;
    value: number;
  };
}

export interface RecommendationInput {
  profile: UserProfile;
  inventory: InventoryItem[];
  candidateProducts?: Product[];
  privateProfile?: PrivateRecommendationProfile | null;
  exactCurrentModelsProvided?: boolean;
  deviceType?: "desktop" | "laptop" | "tablet" | "unknown";
  ports?: string[];
  usedItemsOkay?: boolean;
  availabilityByProductId?: Map<string, AvailabilitySummary> | Record<string, AvailabilitySummary | undefined>;
  pricingByProductId?: Map<string, RecommendationPriceSnapshot> | Record<string, RecommendationPriceSnapshot | undefined>;
}

export interface CategoryRecommendation {
  category: ProductCategory;
  score: number;
  priority: "critical" | "high" | "medium" | "low";
  problemsAddressed: UserProblem[];
  missingOrUpgradeReason: string;
  explanation: string;
  breakdown?: ScoreBreakdown;
  reasons: string[];
  relatedProblems?: UserProblem[];
  missingFromInventory?: boolean;
}

export interface CategoryScore {
  category: ProductCategory;
  score: number;
  reasons: string[];
}

export type RecommendationConfidence = "high" | "medium" | "low";

export interface RecommendationExplanation {
  problemSolved: string;
  whyNow: string;
  whyThisModel: string;
  tradeoff: string;
  confidenceLevel: RecommendationConfidence;
}

export type RecommendationAvailabilityStatus = "available" | "unavailable" | "unknown";
export type RecommendationPriceStatus = "cached" | "stale" | "catalog_estimate";

export interface RecommendationBestOffer {
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

export interface RecommendationPriceSnapshot {
  bestOffer: RecommendationBestOffer | null;
  estimatedMarketPriceCents: number | null;
  priceStatus: "cached" | "stale";
  fetchedAt: Date;
}

export interface ProductRecommendation {
  product: Product;
  finalRecommendationScore: number;
  fitScore: number;
  traitDeltaScore: number;
  score: number;
  breakdown?: ScoreBreakdown;
  scoreBreakdown: ScoreBreakdown;
  deviceDelta?: DeviceDelta;
  fit: "excellent" | "strong" | "situational";
  reasons: string[];
  explanation: RecommendationExplanation;
  tradeoffs: string[];
  whyNotCheaper: string;
  whyNotMoreExpensive: string;
  isAspirational?: boolean;
  profileFieldsUsed: string[];
  missingDeviceSpecs: string[];
  confidenceLevel: RecommendationConfidence;
  currentBestPriceCents: number | null;
  priceDeltaFromExpected: number | null;
  lastCheckedAt: Date | null;
  availabilityStatus: RecommendationAvailabilityStatus;
  rankingChangedReason: string;
  bestOffer: RecommendationBestOffer | null;
  estimatedMarketPriceCents: number | null;
  priceStatus: RecommendationPriceStatus;
  fetchedAt: Date | null;
  priceConfidence: number;
}

const problemAliases: Record<string, UserProblem> = {
  "eye-strain": "eye_strain",
  "neck-pain": "neck_pain",
  "wrist-pain": "wrist_pain",
  "back-pain": "back_pain",
  "low-focus": "poor_focus",
  "messy-desk": "clutter",
  "poor-lighting": "bad_lighting",
  "bad-calls": "low_productivity",
};

const categoryAliases: Record<string, ProductCategory> = {
  "laptop-stand": "laptop_stand",
  "desk-lamp": "desk_lamp",
  lamp: "desk_lamp",
  "cable-management": "cable_management",
};

function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.includes(",") ? trimmed.split(",") : [trimmed];
  }
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  return normalized.length > 0 ? normalized : null;
}

function normalizeTypedArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  aliases: Record<string, T> = {},
): T[] {
  const parsed = parseJsonField(value);
  const rawValues = Array.isArray(parsed) ? parsed : [parsed];
  const allowedValues = new Set<string>(allowed);
  const normalizedValues = rawValues
    .map((rawValue) => normalizeToken(rawValue))
    .map((token) => (token ? aliases[token] ?? token : null))
    .filter((token): token is T => token !== null && allowedValues.has(token));

  return Array.from(new Set(normalizedValues));
}

export function normalizeUserProblems(value: unknown): UserProblem[] {
  return normalizeTypedArray(value, USER_PROBLEMS, problemAliases);
}

export function normalizeUserPreferences(value: unknown): UserPreference[] {
  const parsed = parseJsonField(value);
  const rawValues = Array.isArray(parsed) ? parsed : [parsed];

  return Array.from(
    new Set(
      rawValues
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeRoomConstraints(value: unknown): RoomConstraint[] {
  const parsed = parseJsonField(value);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const constraints = parsed as Record<string, unknown>;
    const derived: RoomConstraint[] = [];
    const taggedConstraints = normalizeTypedArray(
      Array.isArray(constraints.roomConstraintTags) ? constraints.roomConstraintTags : [],
      ROOM_CONSTRAINTS,
    );

    if (constraints.deskWidthInches && Number(constraints.deskWidthInches) <= 36) {
      derived.push("limited_desk_width", "small_space");
    }

    if (constraints.smallRoom === true) derived.push("small_space");
    if (constraints.roomLighting === "low") derived.push("low_light");
    if (constraints.roomLighting === "mixed") derived.push("mixed_lighting");
    if (constraints.roomLighting === "bright") derived.push("bright_lighting");
    if (constraints.sharesSpace === true) derived.push("shared_space");
    if (constraints.portableSetup === true) derived.push("portable_setup");

    return Array.from(new Set([...taggedConstraints, ...derived]));
  }

  return normalizeTypedArray(parsed, ROOM_CONSTRAINTS);
}

export function normalizeProductCategories(value: unknown): ProductCategory[] {
  return normalizeTypedArray(value, PRODUCT_CATEGORIES, categoryAliases);
}

export function normalizeInventoryCategories(value: unknown): InventoryCategory[] {
  const categories = normalizeProductCategories(value);
  const parsed = parseJsonField(value);
  const rawValues = Array.isArray(parsed) ? parsed : [parsed];
  const deviceCategories = normalizeTypedArray(rawValues, DEVICE_CATEGORIES);
  const extraCategories = rawValues
    .map((rawValue) => normalizeToken(rawValue))
    .filter((token): token is "other" | "unknown" => token === "other" || token === "unknown");

  return Array.from(new Set<InventoryCategory>([...categories, ...deviceCategories, ...extraCategories]));
}
