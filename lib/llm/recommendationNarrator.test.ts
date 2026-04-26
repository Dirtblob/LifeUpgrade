import { describe, expect, it } from "vitest";
import type { AvailabilitySummary } from "@/lib/availability";
import {
  buildLLMRecommendationInput,
  narrateRecommendation,
} from "@/lib/llm/recommendationNarrator";
import type {
  DeviceDelta,
} from "@/lib/devices/deviceTypes";
import type {
  InventoryItem,
  Product,
  ProductRecommendation,
  ScoreBreakdown,
  UserProfile,
} from "@/lib/recommendation/types";

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "profile-1",
    name: "Demo User",
    ageRange: "25-34",
    profession: "Designer",
    budgetUsd: 600,
    spendingStyle: "balanced",
    preferences: ["quiet setup"],
    problems: ["eye_strain", "neck_pain"],
    accessibilityNeeds: [],
    roomConstraints: ["limited_desk_width"],
    constraints: {
      deskWidthInches: 42,
      roomLighting: "mixed",
      sharesSpace: true,
      portableSetup: false,
    },
    ...overrides,
  };
}

function inventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: "inventory-monitor",
    name: "Generic monitor",
    category: "monitor",
    condition: "fair",
    painPoints: ["eye_strain"],
    ...overrides,
  };
}

function scoreBreakdown(overrides: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    problemFit: 92,
    ergonomicFit: 86,
    traitDeltaFit: 88,
    constraintFit: 85,
    valueFit: 81,
    compatibilityFit: 79,
    availabilityFit: 100,
    confidence: 74,
    finalScore: 88,
    ...overrides,
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "monitor-dell-s2722qc",
    name: "Dell S2722QC",
    brand: "Dell",
    category: "monitor",
    priceUsd: 349,
    shortDescription: "27-inch USB-C monitor",
    strengths: ["clear text", "single-cable setup"],
    solves: ["eye_strain", "neck_pain"],
    constraints: {
      minDeskWidthInches: 30,
    },
    scoreHints: {
      comfort: 88,
      productivity: 90,
      accessibility: 72,
      value: 80,
    },
    ...overrides,
  };
}

function recommendation(overrides: Partial<ProductRecommendation> = {}): ProductRecommendation {
  const breakdown = scoreBreakdown();
  const deviceDelta: DeviceDelta = {
    currentDevice: {
      label: "Generic monitor",
      category: "monitor",
      missing: false,
      confidence: 70,
    },
    candidateDevice: {
      label: "Dell S2722QC",
      category: "monitor",
      missing: false,
      confidence: 86,
    },
    traitDeltas: {
      screenWorkspace: 68,
      textClarity: 52,
      eyeComfort: 36,
      spaceCost: -18,
    },
    totalImprovementScore: 91,
    problemSpecificImprovements: [
      "Screen Workspace higher by 68 points",
      "Text Clarity higher by 52 points",
    ],
    regressions: ["Desk space cost increases by 18 points."],
    explanationFacts: ["Better than Generic monitor: Screen Workspace higher by 68 points."],
    confidence: 78,
  };

  return {
    product: product(),
    finalRecommendationScore: breakdown.finalScore,
    fitScore: breakdown.ergonomicFit,
    traitDeltaScore: breakdown.traitDeltaFit,
    score: breakdown.finalScore,
    breakdown,
    scoreBreakdown: breakdown,
    deviceDelta,
    fit: "excellent",
    reasons: ["Monitor directly targets eye strain and neck pain."],
    explanation: {
      problemSolved: "A larger external monitor reduces laptop-only posture strain and gives more readable workspace.",
      whyNow: "The current screen setup is causing daily eye strain and neck pain.",
      whyThisModel: "This model fits the budget while keeping a strong balance of comfort and value.",
      tradeoff: "It still needs enough desk depth and the right display connection.",
      confidenceLevel: "high",
    },
    tradeoffs: ["It still needs enough desk depth and the right display connection."],
    whyNotCheaper: "Cheaper monitors save money, but they usually give up enough comfort or connectivity to reduce the fit.",
    whyNotMoreExpensive: "More expensive monitors may add polish, but they do not add enough impact for this profile.",
    isAspirational: false,
    currentBestPriceCents: 32999,
    priceDeltaFromExpected: -1901,
    lastCheckedAt: new Date("2026-04-25T12:00:00Z"),
    availabilityStatus: "available",
    profileFieldsUsed: ["user_private_profiles.comfortPriorities.largeDisplay"],
    missingDeviceSpecs: [],
    confidenceLevel: "medium",
    rankingChangedReason: "Fresh pricing improved the value fit without changing the underlying score weights.",
    ...overrides,
    bestOffer: overrides.bestOffer ?? null,
    estimatedMarketPriceCents: overrides.estimatedMarketPriceCents ?? null,
    priceStatus: overrides.priceStatus ?? "catalog_estimate",
    fetchedAt: overrides.fetchedAt ?? null,
    priceConfidence: overrides.priceConfidence ?? 38,
  };
}

function availability(overrides: Partial<AvailabilitySummary> = {}): AvailabilitySummary {
  return {
    provider: "pricesapi",
    productModelId: "monitor-dell-s2722qc",
    status: "available",
    label: "Available",
    listings: [],
    bestListing: {
      provider: "pricesapi",
      productModelId: "monitor-dell-s2722qc",
      title: "Dell S2722QC",
      brand: "Dell",
      model: "S2722QC",
      retailer: "Demo Store",
      available: true,
      priceCents: 32999,
      totalPriceCents: 32999,
      condition: "new",
      url: "https://example.com/dell-s2722qc",
      confidence: 0.91,
      checkedAt: new Date("2026-04-25T12:00:00Z"),
    },
    checkedAt: new Date("2026-04-25T12:00:00Z"),
    refreshSource: "live",
    ...overrides,
  };
}

describe("recommendation narrator", () => {
  it("preserves numeric scores from deterministic recommendation data", async () => {
    const deterministicRecommendation = recommendation();
    const input = buildLLMRecommendationInput({
      profile: profile(),
      inventory: [inventoryItem()],
      exactCurrentModelsProvided: true,
      categoryRecommendation: {
        category: "monitor",
        score: 84,
        reasons: ["A monitor is the highest-impact screen upgrade."],
      },
      productRecommendation: deterministicRecommendation,
      availability: availability(),
    });

    expect(input.categoryRecommendation.score).toBe(84);
    expect(input.productRecommendation.score).toBe(88);
    expect(input.scoreBreakdown.finalScore).toBe(88);
    expect(input.deviceDelta?.traitDeltas.screenWorkspace).toBe(68);
    expect(input.deviceDelta?.currentDevice.label).toBe("Generic monitor");
    expect(input.deviceDelta?.candidateDevice.label).toBe("Dell S2722QC");
    expect(input.deviceDelta?.regressions[0]).toContain("Desk space");
    expect(input.deviceDelta?.finalDeterministicScore).toBe(88);

    const result = await narrateRecommendation(
      {
        profile: profile(),
        inventory: [inventoryItem()],
        exactCurrentModelsProvided: true,
        categoryRecommendation: {
          category: "monitor",
          score: 84,
          reasons: ["A monitor is the highest-impact screen upgrade."],
        },
        productRecommendation: deterministicRecommendation,
        availability: availability(),
      },
      { provider: null },
    );

    expect(deterministicRecommendation.score).toBe(88);
    expect(deterministicRecommendation.scoreBreakdown.finalScore).toBe(88);
    expect(result.source).toBe("deterministic_fallback");
    expect(result.output.explanation).toContain("88/100");
  });

  it("does not describe unavailable products as currently available", async () => {
    const result = await narrateRecommendation(
      {
        profile: profile(),
        inventory: [inventoryItem()],
        exactCurrentModelsProvided: true,
        categoryRecommendation: {
          category: "monitor",
          score: 84,
          reasons: ["A monitor is the highest-impact screen upgrade."],
        },
        productRecommendation: recommendation({
          availabilityStatus: "unavailable",
          currentBestPriceCents: null,
          priceDeltaFromExpected: null,
          lastCheckedAt: null,
        }),
        availability: availability({
          status: "unavailable",
          label: "Unavailable",
          bestListing: null,
          refreshSource: "live",
        }),
      },
      { provider: null },
    );

    const combined = Object.values(result.output)
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();

    expect(combined).toContain("unavailable");
    expect(combined).not.toContain("currently available");
  });

  it("uses uncertainty language when current specs are missing", async () => {
    const result = await narrateRecommendation(
      {
        profile: profile(),
        inventory: [inventoryItem({ name: "Unknown monitor" })],
        exactCurrentModelsProvided: false,
        categoryRecommendation: {
          category: "monitor",
          score: 84,
          reasons: ["A monitor is the highest-impact screen upgrade."],
        },
        productRecommendation: recommendation(),
        availability: availability(),
      },
      { provider: null },
    );

    const combined = `${result.output.confidenceNote} ${result.output.followUpQuestion ?? ""}`.toLowerCase();
    expect(combined).toMatch(/confirm|missing|not provided|unknown/);
  });

  it("describes quota-limited cached prices accurately", async () => {
    const result = await narrateRecommendation(
      {
        profile: profile(),
        inventory: [inventoryItem()],
        exactCurrentModelsProvided: true,
        categoryRecommendation: {
          category: "monitor",
          score: 84,
          reasons: ["A monitor is the highest-impact screen upgrade."],
        },
        productRecommendation: recommendation(),
        availability: availability({
          refreshSource: "cached",
          refreshSkippedReason: "free_tier_quota",
        }),
      },
      { provider: null },
    );

    const combined = `${result.output.explanation} ${result.output.confidenceNote}`.toLowerCase();
    expect(combined).toContain("cached");
    expect(combined).toContain("quota");
  });

  it("falls back when model output is invalid", async () => {
    const provider = {
      name: "gemma",
      completeJson: async () => '{"headline":"Only headline"}',
    };

    const result = await narrateRecommendation(
      {
        profile: profile(),
        inventory: [inventoryItem()],
        exactCurrentModelsProvided: true,
        categoryRecommendation: {
          category: "monitor",
          score: 84,
          reasons: ["A monitor is the highest-impact screen upgrade."],
        },
        productRecommendation: recommendation(),
        availability: availability(),
      },
      { provider },
    );

    expect(result.source).toBe("deterministic_fallback");
    expect(result.output.explanation).toContain("88/100");
  });

  it("uses Gemma output only after it matches the exact narration schema", async () => {
    const provider = {
      name: "gemma",
      completeJson: async () =>
        JSON.stringify({
          headline: "A calmer monitor upgrade",
          explanation: "This explains the deterministic monitor recommendation without changing the score.",
          whyThisHelps: "It connects the larger screen to the listed eye strain and posture problems.",
          tradeoffs: "It still needs desk space and the right connection.",
          whyNotCheaper: "The cheaper option would lose important comfort or connectivity fit.",
          whyNotMoreExpensive: "A pricier model would not add enough extra impact for this budget.",
          confidenceNote: "The underlying 88/100 deterministic score remains unchanged.",
          followUpQuestion: "Do you want to confirm desk depth before buying?",
        }),
    };

    const result = await narrateRecommendation(
      {
        profile: profile(),
        inventory: [inventoryItem()],
        exactCurrentModelsProvided: true,
        categoryRecommendation: {
          category: "monitor",
          score: 84,
          reasons: ["A monitor is the highest-impact screen upgrade."],
        },
        productRecommendation: recommendation(),
        availability: availability(),
      },
      { provider },
    );

    expect(result.source).toBe("gemma");
    expect(result.output.headline).toBe("A calmer monitor upgrade");
    expect(result.output.confidenceNote).toContain("88/100");
  });

  it("accepts exact Gemma JSON wrapped in a fenced code block", async () => {
    const provider = {
      name: "gemma",
      completeJson: async () =>
        [
          "```json",
          JSON.stringify({
            headline: "A calmer monitor upgrade",
            explanation: "This explains the deterministic monitor recommendation without changing the score.",
            whyThisHelps: "It connects the larger screen to the listed eye strain and posture problems.",
            tradeoffs: "It still needs desk space and the right connection.",
            whyNotCheaper: "The cheaper option would lose important comfort or connectivity fit.",
            whyNotMoreExpensive: "A pricier model would not add enough extra impact for this budget.",
            confidenceNote: "The underlying 88/100 deterministic score remains unchanged.",
            followUpQuestion: "Do you want to confirm desk depth before buying?",
          }),
          "```",
        ].join("\n"),
    };

    const result = await narrateRecommendation(
      {
        profile: profile(),
        inventory: [inventoryItem()],
        exactCurrentModelsProvided: true,
        categoryRecommendation: {
          category: "monitor",
          score: 84,
          reasons: ["A monitor is the highest-impact screen upgrade."],
        },
        productRecommendation: recommendation(),
        availability: availability(),
      },
      { provider },
    );

    expect(result.source).toBe("gemma");
    expect(result.output.headline).toBe("A calmer monitor upgrade");
  });

  it("asks Gemma for the exact narration response schema", async () => {
    const requests: Array<{ responseSchema?: Record<string, unknown> }> = [];
    const provider = {
      name: "gemma",
      completeJson: async (request: { responseSchema?: Record<string, unknown> }) => {
        requests.push(request);
        return JSON.stringify({
          headline: "A calmer monitor upgrade",
          explanation: "This explains the deterministic monitor recommendation without changing the score.",
          whyThisHelps: "It connects the larger screen to the listed eye strain and posture problems.",
          tradeoffs: "It still needs desk space and the right connection.",
          whyNotCheaper: "The cheaper option would lose important comfort or connectivity fit.",
          whyNotMoreExpensive: "A pricier model would not add enough extra impact for this budget.",
          confidenceNote: "The underlying 88/100 deterministic score remains unchanged.",
          followUpQuestion: "Do you want to confirm desk depth before buying?",
        });
      },
    };

    await narrateRecommendation(
      {
        profile: profile(),
        inventory: [inventoryItem()],
        exactCurrentModelsProvided: true,
        categoryRecommendation: {
          category: "monitor",
          score: 84,
          reasons: ["A monitor is the highest-impact screen upgrade."],
        },
        productRecommendation: recommendation(),
        availability: availability(),
      },
      { provider },
    );

    expect(requests[0]?.responseSchema).toMatchObject({
      type: "OBJECT",
      properties: {
        headline: { type: "STRING" },
        explanation: { type: "STRING" },
        followUpQuestion: { type: "STRING" },
      },
      required: expect.arrayContaining(["headline", "explanation", "followUpQuestion"]),
    });
  });

  it("falls back when model output includes fields outside the exact JSON shape", async () => {
    const provider = {
      name: "gemma",
      completeJson: async () =>
        JSON.stringify({
          headline: "Helpful monitor",
          explanation: "Use this monitor.",
          whyThisHelps: "It helps.",
          tradeoffs: "Desk space.",
          whyNotCheaper: "Cheaper loses fit.",
          whyNotMoreExpensive: "More expensive adds little.",
          confidenceNote: "Scores are unchanged.",
          followUpQuestion: "Want to compare?",
          score: 100,
        }),
    };

    const result = await narrateRecommendation(
      {
        profile: profile(),
        inventory: [inventoryItem()],
        exactCurrentModelsProvided: true,
        categoryRecommendation: {
          category: "monitor",
          score: 84,
          reasons: ["A monitor is the highest-impact screen upgrade."],
        },
        productRecommendation: recommendation(),
        availability: availability(),
      },
      { provider },
    );

    expect(result.source).toBe("deterministic_fallback");
    expect(result.output.explanation).toContain("88/100");
  });
});
