import type { AvailabilitySummary } from "@/lib/availability";
import { recordNarrationError } from "@/lib/admin/debugState";
import { availabilityDetailMessages } from "@/lib/availability/display";
import {
  buildRecommendationExplanationCacheKey,
  findCachedRecommendationExplanation,
  upsertRecommendationExplanationCache,
} from "@/lib/llm/explanationCache";
import { getGeminiModel, recordGeminiMetric, reserveGeminiCall } from "@/lib/quota/geminiUsage";
import type { CategoryScore, InventoryItem, ProductRecommendation, UserProfile } from "@/lib/recommendation/types";
import { getGemmaProviderFromEnv } from "./gemmaProvider";
import { buildMockRecommendationOutput } from "./mockNarrator";
import { buildRecommendationNarrationPrompt, recommendationNarratorSystemPrompt } from "./promptTemplates";
import type {
  BuildLLMRecommendationInputArgs,
  LLMRecommendationInput,
  LLMRecommendationOutput,
  NarrateRecommendationOptions,
  RecommendationNarrationResult,
  RecommendationNarratorProvider,
  RejectedAlternativeSummary,
} from "./types";
import { llmRecommendationOutputSchema } from "./types";

function clampText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatUsd(cents: number | null): string | null {
  if (cents === null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

function profileSummary(profile: UserProfile): string {
  const problems = profile.problems.length > 0 ? profile.problems.join(", ") : "no explicit problems listed";
  const preferences = profile.preferences.length > 0 ? profile.preferences.join(", ") : "no strong preferences listed";
  const accessibility =
    profile.accessibilityNeeds.length > 0 ? profile.accessibilityNeeds.join(", ") : "no accessibility needs listed";
  const roomConstraints =
    profile.roomConstraints && profile.roomConstraints.length > 0
      ? profile.roomConstraints.join(", ")
      : "no extra room constraints listed";

  return [
    `${profile.profession} profile with a $${profile.budgetUsd} budget and ${profile.spendingStyle} spending style.`,
    `Problems: ${problems}.`,
    `Preferences: ${preferences}.`,
    `Accessibility: ${accessibility}.`,
    `Desk width ${profile.constraints.deskWidthInches} inches, ${profile.constraints.roomLighting} lighting, ${profile.constraints.sharesSpace ? "shared space" : "private space"}, ${profile.constraints.portableSetup ? "portable setup" : "fixed setup"}.`,
    `Room constraints: ${roomConstraints}.`,
  ].join(" ");
}

function inventorySummary(inventory: InventoryItem[], exactCurrentModelsProvided?: boolean | null): string {
  if (inventory.length === 0) {
    return "No inventory items were provided, so this recommendation is filling an empty setup gap.";
  }

  const items = inventory
    .slice(0, 5)
    .map((item) => {
      const painPoints = item.painPoints.length > 0 ? ` with pain points ${item.painPoints.join(", ")}` : "";
      return `${item.name} (${item.category}, ${item.condition})${painPoints}`;
    })
    .join("; ");
  const exactModelSentence =
    exactCurrentModelsProvided === false
      ? "Some exact current models or specs are missing, so compatibility assumptions should be confirmed."
      : "Exact current models were provided for at least part of the setup.";

  return `${items}. ${exactModelSentence}`;
}

function rejectedAlternatives(productRecommendation: ProductRecommendation): RejectedAlternativeSummary[] {
  return [
    { label: "Cheaper alternative", reason: productRecommendation.whyNotCheaper },
    { label: "More expensive alternative", reason: productRecommendation.whyNotMoreExpensive },
  ];
}

export function buildLLMRecommendationInput({
  profile,
  inventory,
  categoryRecommendation,
  productRecommendation,
  availability,
  rejectedAlternatives: providedRejectedAlternatives,
  exactCurrentModelsProvided,
}: BuildLLMRecommendationInputArgs): LLMRecommendationInput {
  const deviceDelta = productRecommendation.deviceDelta
    ? {
        currentDevice: productRecommendation.deviceDelta.currentDevice,
        candidateDevice: productRecommendation.deviceDelta.candidateDevice,
        traitDeltas: { ...productRecommendation.deviceDelta.traitDeltas },
        regressions: [...productRecommendation.deviceDelta.regressions],
        explanationFacts: [...productRecommendation.deviceDelta.explanationFacts],
        netImprovementScore: productRecommendation.deviceDelta.totalImprovementScore,
        finalDeterministicScore: productRecommendation.score,
      }
    : undefined;

  return {
    userProfileSummary: profileSummary(profile),
    inventorySummary: inventorySummary(inventory, exactCurrentModelsProvided),
    categoryRecommendation: {
      category: categoryRecommendation.category,
      score: categoryRecommendation.score,
      priority: categoryRecommendation.priority,
      reasons: [...categoryRecommendation.reasons],
      explanation: categoryRecommendation.explanation,
      missingOrUpgradeReason: categoryRecommendation.missingOrUpgradeReason,
    },
    productRecommendation: {
      id: productRecommendation.product.id,
      name: productRecommendation.product.name,
      brand: productRecommendation.product.brand,
      category: productRecommendation.product.category,
      priceUsd: productRecommendation.product.priceUsd,
      score: productRecommendation.score,
      finalRecommendationScore: productRecommendation.finalRecommendationScore,
      fitScore: productRecommendation.fitScore,
      traitDeltaScore: productRecommendation.traitDeltaScore,
      fit: productRecommendation.fit,
      strengths: [...productRecommendation.product.strengths],
      solves: [...productRecommendation.product.solves],
      reasons: [...productRecommendation.reasons],
      deterministicExplanation: productRecommendation.explanation,
      whyNotCheaper: productRecommendation.whyNotCheaper,
      whyNotMoreExpensive: productRecommendation.whyNotMoreExpensive,
      currentBestPriceCents: productRecommendation.currentBestPriceCents,
      priceDeltaFromExpected: productRecommendation.priceDeltaFromExpected,
      lastCheckedAtIso: productRecommendation.lastCheckedAt?.toISOString() ?? null,
      availabilityStatus: productRecommendation.availabilityStatus,
      rankingChangedReason: productRecommendation.rankingChangedReason,
      profileFieldsUsed: [...productRecommendation.profileFieldsUsed],
      missingDeviceSpecs: [...productRecommendation.missingDeviceSpecs],
      confidenceLevel: productRecommendation.confidenceLevel,
    },
    scoreBreakdown: {
      ...productRecommendation.scoreBreakdown,
    },
    ...(deviceDelta ? { deviceDelta } : {}),
    availability: {
      provider: availability?.provider ?? null,
      status: availability?.status ?? "checking_not_configured",
      label: availability?.label ?? "Availability unknown",
      refreshSource: availability?.refreshSource ?? "not_configured",
      refreshSkippedReason: availability?.refreshSkippedReason,
      checkedAtIso: availability?.checkedAt?.toISOString() ?? null,
      bestListingPriceCents:
        availability?.bestListing?.totalPriceCents ?? availability?.bestListing?.priceCents ?? null,
      detailMessages: availabilityDetailMessages(availability),
    },
    rejectedAlternatives: providedRejectedAlternatives
      ? [...providedRejectedAlternatives]
      : rejectedAlternatives(productRecommendation),
  };
}

function extractJSONObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fencedMatch?.[1]?.trim();
    if (!candidate) return null;

    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
}

function parseNarrationOutput(raw: string): LLMRecommendationOutput | null {
  const parsed = extractJSONObject(raw);
  const result = llmRecommendationOutputSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function mentionsUncertainty(value: string): boolean {
  return /\b(confirm|confirmation|uncertain|unknown|missing|not provided|verify)\b/i.test(value);
}

function mentionsCachedQuota(value: string): boolean {
  return /\b(cached|quota)\b/i.test(value);
}

function statesCurrentlyAvailable(value: string): boolean {
  return /\bcurrently available\b/i.test(value);
}

function fallbackWithInputGuards(
  input: LLMRecommendationInput,
  candidate: Partial<LLMRecommendationOutput> | null,
): LLMRecommendationOutput {
  const fallback = buildMockRecommendationOutput(input);
  const merged: LLMRecommendationOutput = {
    headline: clampText(candidate?.headline) ?? fallback.headline,
    explanation: clampText(candidate?.explanation) ?? fallback.explanation,
    tradeoffs: clampText(candidate?.tradeoffs) ?? fallback.tradeoffs,
    whyThisHelps: clampText(candidate?.whyThisHelps) ?? fallback.whyThisHelps,
    whyNotCheaper: clampText(candidate?.whyNotCheaper) ?? fallback.whyNotCheaper,
    whyNotMoreExpensive: clampText(candidate?.whyNotMoreExpensive) ?? fallback.whyNotMoreExpensive,
    confidenceNote: clampText(candidate?.confidenceNote) ?? fallback.confidenceNote,
    followUpQuestion: clampText(candidate?.followUpQuestion) ?? fallback.followUpQuestion,
  };

  if (input.availability.status === "unavailable" && statesCurrentlyAvailable(merged.explanation)) {
    merged.explanation = fallback.explanation;
  }

  if (input.availability.refreshSkippedReason === "free_tier_quota" && !mentionsCachedQuota(merged.confidenceNote)) {
    merged.confidenceNote = `${merged.confidenceNote} Pricing is still based on cached data because the live refresh hit the free-tier quota.`.trim();
  }

  const searchableText = `${input.userProfileSummary} ${input.inventorySummary}`.toLowerCase();
  const missingSpecs =
    searchableText.includes("exact current models") ||
    searchableText.includes("specs are missing") ||
    searchableText.includes("not provided") ||
    searchableText.includes("unknown");
  if (missingSpecs && !mentionsUncertainty(merged.confidenceNote)) {
    merged.confidenceNote = `${merged.confidenceNote} Some current-item specs still need confirmation.`.trim();
  }

  return merged;
}

const recommendationNarrationResponseSchema = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING" },
    explanation: { type: "STRING" },
    tradeoffs: { type: "STRING" },
    whyThisHelps: { type: "STRING" },
    whyNotCheaper: { type: "STRING" },
    whyNotMoreExpensive: { type: "STRING" },
    confidenceNote: { type: "STRING" },
    followUpQuestion: { type: "STRING" },
  },
  required: [
    "headline",
    "explanation",
    "tradeoffs",
    "whyThisHelps",
    "whyNotCheaper",
    "whyNotMoreExpensive",
    "confidenceNote",
    "followUpQuestion",
  ],
} as const;

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown narration error";
}

function logNarratorError(error: unknown): void {
  console.error("[llm][narrator] falling back to deterministic explanation", {
    error: errorMessage(error),
  });
}

function resolveProvider(options: NarrateRecommendationOptions): RecommendationNarratorProvider | null {
  if (options.provider !== undefined) {
    return options.provider;
  }

  return getGemmaProviderFromEnv();
}

function shouldTrackUsage(options: NarrateRecommendationOptions): boolean {
  return options.trackUsage ?? options.provider === undefined;
}

async function recordMetricIfEnabled(
  metric: "failure" | "fallback" | "cache_hit",
  enabled: boolean,
  count = 1,
): Promise<void> {
  if (!enabled || count <= 0) return;
  await recordGeminiMetric(metric, count);
}

async function cacheNarrationIfRequested(
  options: NarrateRecommendationOptions,
  input: LLMRecommendationInput,
  result: {
    output: LLMRecommendationOutput;
    source: RecommendationNarrationResult["source"];
    error?: string;
  },
): Promise<void> {
  if (!options.cache) return;

  await upsertRecommendationExplanationCache(
    buildRecommendationExplanationCacheKey(options.cache.recommendationId, input),
    {
      model: getGeminiModel(),
      source: result.source,
      output: result.output,
      error: result.error ?? null,
    },
  );
}

async function recordNarrationFailure(
  args: BuildLLMRecommendationInputArgs,
  provider: RecommendationNarratorProvider | null,
  error: unknown,
): Promise<void> {
  await recordNarrationError({
    provider: provider?.name ?? "fallback",
    message: errorMessage(error),
    productId: args.productRecommendation.product.id,
    category: args.categoryRecommendation.category,
  });
}

export async function narrateRecommendation(
  args: BuildLLMRecommendationInputArgs,
  options: NarrateRecommendationOptions = {},
): Promise<RecommendationNarrationResult> {
  const input = buildLLMRecommendationInput(args);
  const provider = resolveProvider(options);
  const trackUsage = shouldTrackUsage(options);

  if (!provider) {
    const output = buildMockRecommendationOutput(input);
    const result: RecommendationNarrationResult = {
      input,
      output,
      source: "deterministic_fallback",
      cacheStatus: options.cache ? "stored" : "not_requested",
      model: getGeminiModel(),
      error: "Gemini is not configured",
    };
    await cacheNarrationIfRequested(options, input, result);
    await recordMetricIfEnabled("fallback", trackUsage);
    return {
      ...result,
      error: undefined,
    };
  }

  try {
    if (trackUsage) {
      const reserved = await reserveGeminiCall();
      if (!reserved) {
        throw new Error("Gemini daily soft cap is exhausted");
      }
    }

    const raw = await provider.completeJson({
      system: recommendationNarratorSystemPrompt,
      prompt: buildRecommendationNarrationPrompt(input),
      maxTokens: 500,
      temperature: 0.2,
      responseSchema: recommendationNarrationResponseSchema,
    });
    const parsed = parseNarrationOutput(raw);
    if (!parsed) {
      throw new Error("Narrator response did not match LLMRecommendationOutput");
    }

    const result: RecommendationNarrationResult = {
      input,
      output: fallbackWithInputGuards(input, parsed),
      source: "gemma",
      cacheStatus: options.cache ? "stored" : "not_requested",
      model: getGeminiModel(),
    };
    await cacheNarrationIfRequested(options, input, result);
    return result;
  } catch (error) {
    logNarratorError(error);
    await recordNarrationFailure(args, provider, error);
    await recordMetricIfEnabled("failure", trackUsage);
    await recordMetricIfEnabled("fallback", trackUsage);
    const output = buildMockRecommendationOutput(input);
    const result: RecommendationNarrationResult = {
      input,
      output,
      source: "deterministic_fallback",
      cacheStatus: options.cache ? "stored" : "not_requested",
      model: getGeminiModel(),
      error: errorMessage(error),
    };
    await cacheNarrationIfRequested(options, input, result);
    return result;
  }
}

export async function narrateRecommendations(
  entries: BuildLLMRecommendationInputArgs[],
  options: NarrateRecommendationOptions = {},
): Promise<RecommendationNarrationResult[]> {
  return Promise.all(entries.map((entry) => narrateRecommendation(entry, options)));
}

export async function readCachedRecommendationNarration(
  args: BuildLLMRecommendationInputArgs,
  options: {
    recommendationId: string;
    recordMetrics?: boolean;
  },
): Promise<RecommendationNarrationResult> {
  const input = buildLLMRecommendationInput(args);
  const key = buildRecommendationExplanationCacheKey(options.recommendationId, input);
  const cached = await findCachedRecommendationExplanation(key);
  const recordMetrics = options.recordMetrics ?? true;

  if (cached) {
    await recordMetricIfEnabled("cache_hit", recordMetrics);
    if (cached.source === "deterministic_fallback") {
      await recordMetricIfEnabled("fallback", recordMetrics);
    }
    return {
      input,
      output: cached.output,
      source: cached.source,
      cacheStatus: "hit",
      model: cached.model,
      error: cached.error ?? undefined,
    };
  }

  await recordMetricIfEnabled("fallback", recordMetrics);
  return {
    input,
    output: buildMockRecommendationOutput(input),
    source: "deterministic_fallback",
    cacheStatus: "miss",
    model: getGeminiModel(),
  };
}

export async function readCachedRecommendationNarrations(
  entries: Array<BuildLLMRecommendationInputArgs & { recommendationId: string }>,
  options: {
    recordMetrics?: boolean;
  } = {},
): Promise<RecommendationNarrationResult[]> {
  const recordMetrics = options.recordMetrics ?? true;
  const results = await Promise.all(
    entries.map(({ recommendationId, ...entry }) =>
      readCachedRecommendationNarration(entry, {
        recommendationId,
        recordMetrics: false,
      }),
    ),
  );
  const cacheHits = results.filter((result) => result.cacheStatus === "hit").length;
  const fallbacks = results.filter((result) => result.source === "deterministic_fallback").length;

  await Promise.all([
    recordMetricIfEnabled("cache_hit", recordMetrics, cacheHits),
    recordMetricIfEnabled("fallback", recordMetrics, fallbacks),
  ]);

  return results;
}

export function productCategoryRecommendation(
  categoryRecommendation: Pick<CategoryScore, "category" | "score" | "reasons">,
): Pick<CategoryScore, "category" | "score" | "reasons"> {
  return categoryRecommendation;
}

export function availabilityFromRecommendation(
  recommendation: ProductRecommendation,
  availability?: AvailabilitySummary,
): string {
  if (availability?.status === "available") {
    const priceText = formatUsd(
      availability.bestListing?.totalPriceCents ?? availability.bestListing?.priceCents ?? null,
    );
    return priceText
      ? `${recommendation.product.name} is currently available around ${priceText}.`
      : `${recommendation.product.name} is currently available.`;
  }

  if (availability?.status === "unavailable") {
    return `${recommendation.product.name} currently looks unavailable.`;
  }

  return `${recommendation.product.name} still needs availability confirmation.`;
}
