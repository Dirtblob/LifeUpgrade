import { NextResponse } from "next/server";
import { getCachedAvailabilitySummaries } from "@/lib/availability";
import { maybeAutoRefreshTopRecommendationPrice } from "@/lib/availability/autoRefresh";
import { loadCachedRecommendationPriceSnapshots } from "@/lib/availability/priceSnapshots";
import { getCurrentMongoUser, UnauthorizedMongoUserError } from "@/lib/devUser";
import { listInventoryItemsForUser, type MongoInventoryItem } from "@/lib/inventory/mongoInventory";
import {
  recommendationProductToAvailabilityModel,
} from "@/lib/recommendation/mongoDeviceProducts";
import { productCatalog } from "@/data/seeds/productCatalog";
import { rankProductsForInput } from "@/lib/recommendation/productEngine";
import { saveRecommendationRunLog } from "@/lib/recommendation/recommendationLogs";
import type {
  InventoryItem,
  PrivateRecommendationProfile,
  RecommendationInput,
  ProductRecommendation,
  UserProblem,
  UserProfile,
} from "@/lib/recommendation/types";
import { normalizeInventoryCategories } from "@/lib/recommendation/types";
import { getUserPrivateProfileForUser, type UserPrivateProfile } from "@/lib/userPrivateProfiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

function parseSpecs(value: string | null, fallback?: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
    return fallback;
  }

  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function inferPainPoints(item: Pick<MongoInventoryItem, "brand" | "model" | "exactModel" | "notes">): UserProblem[] {
  const text = [item.brand, item.model, item.exactModel, item.notes].filter(Boolean).join(" ").trim();

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

function mapInventoryItem(item: MongoInventoryItem): InventoryItem {
  const category = normalizeInventoryCategories(item.category)[0] ?? "unknown";
  const name =
    item.exactModel?.trim() ||
    [item.brand, item.model]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" ")
      .trim() ||
    category.replaceAll("_", " ");

  return {
    id: typeof item._id === "string" ? item._id : item._id.toHexString(),
    name,
    category,
    condition: mapInventoryCondition(item.condition),
    painPoints: inferPainPoints(item),
    specs: parseSpecs(item.specsJson ?? null, item.specs),
  };
}

function buildProblems(inventory: InventoryItem[], privateProfile: UserPrivateProfile | null): UserProblem[] {
  const problems = new Set<UserProblem>();

  for (const item of inventory) {
    for (const problem of item.painPoints) {
      problems.add(problem);
    }
  }

  if (privateProfile?.sensitivity.eyeStrain) problems.add("eye_strain");
  if (privateProfile?.sensitivity.wristStrain || privateProfile?.sensitivity.fingerFatigue) problems.add("wrist_pain");
  if (privateProfile?.sensitivity.hearingSensitive || privateProfile?.comfortPriorities.lowNoise) problems.add("noise_sensitivity");

  return Array.from(problems);
}

function mapPrivateProfileForRecommendations(profile: UserPrivateProfile | null): PrivateRecommendationProfile | null {
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

function buildRecommendationProfile(
  input: {
    mongoUser: Awaited<ReturnType<typeof getCurrentMongoUser>>;
    inventory: InventoryItem[];
    privateProfile: UserPrivateProfile | null;
  },
): UserProfile {
  const privateProfileAllowed = input.privateProfile?.privacy.allowProfileForRecommendations === true;
  const portableSetup = input.inventory.some((item) => item.category === "laptop");
  const problems = buildProblems(input.inventory, privateProfileAllowed ? input.privateProfile : null);

  return {
    id: input.mongoUser._id,
    name: input.mongoUser.displayName ?? input.mongoUser.email ?? "Current user",
    ageRange: privateProfileAllowed ? input.privateProfile?.ageRange ?? "Unknown" : "Unknown",
    profession: privateProfileAllowed ? input.privateProfile?.profession ?? "" : "",
    budgetUsd: privateProfileAllowed ? Math.max(0, Math.round((input.privateProfile?.budget?.max ?? 0) || 0)) : 0,
    spendingStyle: "balanced",
    preferences: [],
    problems,
    accessibilityNeeds: [],
    roomConstraints: portableSetup ? ["portable_setup"] : [],
    constraints: {
      deskWidthInches: 44,
      roomLighting: "mixed",
      sharesSpace: privateProfileAllowed ? input.privateProfile?.comfortPriorities.lowNoise ?? false : false,
      portableSetup,
    },
  };
}

function serializeRecommendation(recommendation: ProductRecommendation) {
  return {
    product: recommendation.product,
    finalRecommendationScore: recommendation.finalRecommendationScore,
    fitScore: recommendation.fitScore,
    traitDeltaScore: recommendation.traitDeltaScore,
    score: recommendation.score,
    breakdown: recommendation.breakdown,
    scoreBreakdown: recommendation.scoreBreakdown,
    deviceDelta: recommendation.deviceDelta,
    fit: recommendation.fit,
    reasons: recommendation.reasons,
    explanation: recommendation.explanation,
    tradeoffs: recommendation.tradeoffs,
    whyNotCheaper: recommendation.whyNotCheaper,
    whyNotMoreExpensive: recommendation.whyNotMoreExpensive,
    isAspirational: recommendation.isAspirational ?? false,
    profileFieldsUsed: recommendation.profileFieldsUsed,
    missingDeviceSpecs: recommendation.missingDeviceSpecs,
    confidenceLevel: recommendation.confidenceLevel,
    currentBestPriceCents: recommendation.currentBestPriceCents,
    priceDeltaFromExpected: recommendation.priceDeltaFromExpected,
    lastCheckedAt: recommendation.lastCheckedAt?.toISOString() ?? null,
    availabilityStatus: recommendation.availabilityStatus,
    rankingChangedReason: recommendation.rankingChangedReason,
    bestOffer: recommendation.bestOffer,
    estimatedMarketPriceCents: recommendation.estimatedMarketPriceCents,
    priceStatus: recommendation.priceStatus,
    fetchedAt: recommendation.fetchedAt?.toISOString() ?? null,
    priceConfidence: recommendation.priceConfidence,
  };
}

async function generateRecommendationsResponse(): Promise<NextResponse> {
  try {
    const mongoUser = await getCurrentMongoUser();
    const [inventoryRecords, privateProfileRecord, candidateProducts] = await Promise.all([
      listInventoryItemsForUser(mongoUser._id),
      getUserPrivateProfileForUser(mongoUser._id),
      Promise.resolve(productCatalog),
    ]);

    const inventory = inventoryRecords.map(mapInventoryItem);
    const privateProfile = mapPrivateProfileForRecommendations(privateProfileRecord);
    const profile = buildRecommendationProfile({
      mongoUser,
      inventory,
      privateProfile: privateProfileRecord,
    });
    const availabilityProductModels = candidateProducts.map((product) =>
      recommendationProductToAvailabilityModel(product, { allowUsed: true }),
    );
    const availabilityModelsByProductId = new Map(availabilityProductModels.map((productModel) => [productModel.id, productModel]));
    let [availabilityByProductId, pricingByProductId] = await Promise.all([
      getCachedAvailabilitySummaries(availabilityProductModels),
      loadCachedRecommendationPriceSnapshots(availabilityProductModels),
    ]);
    const recommendationInput: RecommendationInput = {
      profile,
      inventory,
      candidateProducts,
      privateProfile,
      exactCurrentModelsProvided: inventoryRecords.some(
        (item) => Boolean(item.model?.trim()) || Boolean(item.exactModel?.trim()),
      ),
      deviceType: inventory.some((item) => item.category === "laptop") ? "laptop" : "unknown",
      ports: [],
      usedItemsOkay: true,
      availabilityByProductId,
      pricingByProductId,
    };
    let recommendations = rankProductsForInput(recommendationInput).slice(0, 8);
    const refreshedTopPrice = await maybeAutoRefreshTopRecommendationPrice({
      productModel: availabilityModelsByProductId.get(recommendations[0]?.product.id ?? ""),
      availabilityByProductId,
      userId: mongoUser.id,
    });

    if (refreshedTopPrice) {
      availabilityByProductId = {
        ...availabilityByProductId,
        [refreshedTopPrice.productModelId]: refreshedTopPrice.availabilitySummary,
      };
      pricingByProductId = refreshedTopPrice.priceSnapshot
        ? {
            ...pricingByProductId,
            [refreshedTopPrice.productModelId]: refreshedTopPrice.priceSnapshot,
          }
        : pricingByProductId;
      recommendations = rankProductsForInput({
        ...recommendationInput,
        availabilityByProductId,
        pricingByProductId,
      }).slice(0, 8);
    }

    await saveRecommendationRunLog({
      userId: mongoUser._id,
      inventory,
      recommendations,
      allowRecommendationHistory: privateProfileRecord?.privacy.allowRecommendationHistory ?? true,
      privateTextRedactions: privateProfileRecord?.privacy.allowProfileForRecommendations
        ? [privateProfileRecord.ageRange, privateProfileRecord.profession].filter(
            (value): value is string => Boolean(value?.trim()),
          )
        : [],
    });

    return NextResponse.json({
      recommendations: recommendations.map(serializeRecommendation),
      metadata: {
        inventoryCount: inventory.length,
        candidateDeviceCount: candidateProducts.length,
        privateProfileUsed: Boolean(privateProfile),
        recommendationHistorySaved: privateProfileRecord?.privacy.allowRecommendationHistory !== false,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedMongoUserError) {
      return unauthorizedResponse();
    }

    console.error("Failed to generate recommendations.", error);
    return NextResponse.json({ error: "Could not generate recommendations." }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  return generateRecommendationsResponse();
}

export async function POST(): Promise<NextResponse> {
  return generateRecommendationsResponse();
}
