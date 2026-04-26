import type {
  AvailabilityRefreshSkipReason,
  AvailabilityRefreshSource,
  AvailabilitySummary,
} from "@/lib/availability/types";
import { z } from "zod";
import type {
  CategoryScore,
  InventoryItem,
  ProductRecommendation,
  RecommendationExplanation,
  ScoreBreakdown,
  UserProfile,
} from "@/lib/recommendation/types";
import type { DeviceDeltaDeviceSummary } from "@/lib/devices/deviceTypes";

export interface RejectedAlternativeSummary {
  label: string;
  reason: string;
}

export interface LLMCategoryRecommendationSummary {
  category: string;
  score: number;
  priority?: string;
  reasons: string[];
  explanation?: string;
  missingOrUpgradeReason?: string;
}

export interface LLMProductRecommendationSummary {
  id: string;
  name: string;
  brand: string;
  category: string;
  priceUsd: number;
  score: number;
  finalRecommendationScore: number;
  fitScore: number;
  traitDeltaScore: number;
  fit: ProductRecommendation["fit"];
  strengths: string[];
  solves: string[];
  reasons: string[];
  deterministicExplanation: RecommendationExplanation;
  whyNotCheaper: string;
  whyNotMoreExpensive: string;
  currentBestPriceCents: number | null;
  priceDeltaFromExpected: number | null;
  lastCheckedAtIso: string | null;
  availabilityStatus: ProductRecommendation["availabilityStatus"];
  rankingChangedReason: string;
  profileFieldsUsed: string[];
  missingDeviceSpecs: string[];
  confidenceLevel: ProductRecommendation["confidenceLevel"];
}

export interface LLMAvailabilityInput {
  provider: string | null;
  status: AvailabilitySummary["status"];
  label: AvailabilitySummary["label"];
  refreshSource: AvailabilityRefreshSource;
  refreshSkippedReason?: AvailabilityRefreshSkipReason;
  checkedAtIso: string | null;
  bestListingPriceCents: number | null;
  detailMessages: string[];
}

export interface LLMDeviceDeltaInput {
  currentDevice: DeviceDeltaDeviceSummary;
  candidateDevice: DeviceDeltaDeviceSummary;
  traitDeltas: Record<string, number>;
  regressions: string[];
  explanationFacts: string[];
  netImprovementScore: number;
  finalDeterministicScore: number;
}

export interface LLMRecommendationInput {
  userProfileSummary: string;
  inventorySummary: string;
  categoryRecommendation: LLMCategoryRecommendationSummary;
  productRecommendation: LLMProductRecommendationSummary;
  scoreBreakdown: ScoreBreakdown;
  deviceDelta?: LLMDeviceDeltaInput;
  availability: LLMAvailabilityInput;
  rejectedAlternatives: RejectedAlternativeSummary[];
}

export interface LLMRecommendationOutput {
  headline: string;
  explanation: string;
  tradeoffs: string;
  whyThisHelps: string;
  whyNotCheaper: string;
  whyNotMoreExpensive: string;
  confidenceNote: string;
  followUpQuestion: string;
}

export const llmRecommendationOutputSchema = z
  .object({
    headline: z.string().min(1),
    explanation: z.string().min(1),
    tradeoffs: z.string().min(1),
    whyThisHelps: z.string().min(1),
    whyNotCheaper: z.string().min(1),
    whyNotMoreExpensive: z.string().min(1),
    confidenceNote: z.string().min(1),
    followUpQuestion: z.string().min(1),
  })
  .strict();

export interface RecommendationNarratorProviderRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  responseSchema?: Record<string, unknown>;
}

export interface RecommendationNarratorProvider {
  name: string;
  completeJson(request: RecommendationNarratorProviderRequest): Promise<string>;
}

export interface BuildLLMRecommendationInputArgs {
  profile: UserProfile;
  inventory: InventoryItem[];
  categoryRecommendation: Pick<CategoryScore, "category" | "score" | "reasons"> & {
    priority?: string;
    explanation?: string;
    missingOrUpgradeReason?: string;
  };
  productRecommendation: ProductRecommendation;
  availability?: AvailabilitySummary;
  rejectedAlternatives?: RejectedAlternativeSummary[];
  exactCurrentModelsProvided?: boolean | null;
}

export interface NarrateRecommendationOptions {
  provider?: RecommendationNarratorProvider | null;
  cache?: {
    recommendationId: string;
  };
  trackUsage?: boolean;
}

export type RecommendationNarrationSource = "gemma" | "deterministic_fallback";
export type RecommendationNarrationCacheStatus = "hit" | "miss" | "stored" | "not_requested";

export interface RecommendationNarrationResult {
  input: LLMRecommendationInput;
  output: LLMRecommendationOutput;
  source: RecommendationNarrationSource;
  cacheStatus?: RecommendationNarrationCacheStatus;
  model?: string;
  error?: string;
}
