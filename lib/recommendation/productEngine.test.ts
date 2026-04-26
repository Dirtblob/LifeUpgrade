import { describe, expect, it } from "vitest";
import { productCatalog } from "../../data/seeds/productCatalog";
import type { AvailabilitySummary } from "../availability";
import { matchesFilters, type RecommendationFilters } from "./dashboard";
import { buildHackathonDemoPriorityList } from "./demoMode";
import { getCategoryRecommendations } from "./categoryEngine";
import { rankCategories } from "./scoring";
import { getProductRecommendations, rankProductsForInput } from "./productEngine";
import type {
  CategoryScore,
  InventoryItem,
  Product,
  ProductCategory,
  RecommendationInput,
  RecommendationPriceSnapshot,
  UserProfile,
} from "./types";

type ProfileOverrides = Partial<Omit<UserProfile, "constraints">> & {
  constraints?: Partial<UserProfile["constraints"]>;
};

function profile(overrides: ProfileOverrides = {}): UserProfile {
  const base: UserProfile = {
    id: "product-test-profile",
    name: "Test User",
    ageRange: "18-24",
    profession: "CS student",
    budgetUsd: 300,
    spendingStyle: "balanced",
    preferences: [],
    problems: [],
    accessibilityNeeds: [],
    roomConstraints: [],
    constraints: {
      deskWidthInches: 48,
      roomLighting: "mixed",
      sharesSpace: false,
      portableSetup: false,
    },
  };

  return {
    ...base,
    ...overrides,
    constraints: {
      ...base.constraints,
      ...overrides.constraints,
    },
  };
}

function inventoryItem(
  category: ProductCategory,
  overrides: Partial<InventoryItem> = {},
): InventoryItem {
  return {
    id: `item-${category}`,
    name: category,
    category,
    condition: "good",
    painPoints: [],
    ...overrides,
  };
}

function input(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    profile: profile(),
    inventory: [],
    deviceType: "laptop",
    ports: ["USB-C"],
    usedItemsOkay: true,
    ...overrides,
  };
}

function categoryScore(category: ProductCategory, score = 80): CategoryScore {
  return {
    category,
    score,
    reasons: [`${category} test reason.`],
  };
}

function product(overrides: Partial<Product>): Product {
  return {
    id: "test-product",
    name: "Test Product",
    brand: "Test",
    category: "monitor",
    priceUsd: 100,
    shortDescription: "Test product.",
    strengths: ["Practical fit"],
    solves: ["eye_strain"],
    constraints: {},
    scoreHints: {
      comfort: 7,
      productivity: 7,
      accessibility: 7,
      value: 7,
    },
    ...overrides,
  };
}

function unavailableSummary(productModelId: string): AvailabilitySummary {
  return {
    provider: "mock",
    productModelId,
    status: "unavailable",
    label: "Unavailable",
    listings: [],
    bestListing: null,
    checkedAt: new Date("2026-01-01T00:00:00Z"),
    refreshSource: "live",
  };
}

function availableSummary(
  productModelId: string,
  options: {
    priceCents?: number;
    checkedAt?: Date;
    refreshSource?: AvailabilitySummary["refreshSource"];
    refreshSkippedReason?: AvailabilitySummary["refreshSkippedReason"];
  } = {},
): AvailabilitySummary {
  const checkedAt = options.checkedAt ?? new Date(Date.now() - 1000 * 60 * 60);
  const priceCents = options.priceCents ?? 10000;

  return {
    provider: "mock",
    productModelId,
    status: "available",
    label: "Available",
    listings: [],
    bestListing: {
      provider: "mock",
      productModelId,
      title: productModelId,
      brand: "Test",
      model: "Model",
      retailer: "Mock",
      available: true,
      priceCents,
      totalPriceCents: priceCents,
      condition: "new",
      url: "https://example.com/listing",
      confidence: 92,
      checkedAt,
    },
    checkedAt,
    refreshSource: options.refreshSource ?? "live",
    refreshSkippedReason: options.refreshSkippedReason,
  };
}

function cachedPricing(
  productModelId: string,
  priceCents: number,
  options: {
    fetchedAt?: Date;
    priceStatus?: RecommendationPriceSnapshot["priceStatus"];
  } = {},
): RecommendationPriceSnapshot {
  const fetchedAt = options.fetchedAt ?? new Date("2026-04-25T12:00:00Z");

  return {
    bestOffer: {
      title: productModelId,
      brand: "Test",
      model: "Model",
      retailer: "Cached Shop",
      available: true,
      priceCents,
      totalPriceCents: priceCents,
      condition: "used",
      url: "https://example.com/cached-listing",
      confidence: 90,
    },
    estimatedMarketPriceCents: priceCents,
    priceStatus: options.priceStatus ?? "cached",
    fetchedAt,
  };
}

describe("product recommendation engine", () => {
  it("ranks laptop stand and monitor above laptop for a laptop-only coder with neck pain", () => {
    const priorities = buildHackathonDemoPriorityList();
    const laptopStand = priorities.find((item) => item.category === "laptop_stand");
    const monitor = priorities.find((item) => item.category === "monitor");
    const laptop = priorities.find((item) => item.category === "laptop");

    expect(laptopStand?.rank).toBeLessThan(laptop?.rank ?? Number.POSITIVE_INFINITY);
    expect(monitor?.rank).toBeLessThan(laptop?.rank ?? Number.POSITIVE_INFINITY);
    expect(laptopStand?.recommendation?.score).toBeGreaterThan(laptop?.recommendation?.score ?? 0);
    expect(monitor?.recommendation?.score).toBeGreaterThan(laptop?.recommendation?.score ?? 0);
  });

  it("does not give a budget-limited student premium-first recommendations", () => {
    const recommendations = rankProductsForInput(
      input({
        profile: profile({
          budgetUsd: 300,
          spendingStyle: "VALUE",
          problems: ["neck_pain", "eye_strain", "low_productivity", "budget_limited"],
          preferences: ["quiet products", "value"],
          constraints: { portableSetup: true },
        }),
        inventory: [inventoryItem("laptop", { name: "MacBook Air M1 8GB" })],
      }),
    );

    expect(recommendations.slice(0, 4).every((recommendation) => recommendation.product.priceUsd <= 300)).toBe(true);
    expect(recommendations.slice(0, 4).some((recommendation) => recommendation.product.aspirational)).toBe(false);
  });

  it("does not return loud keyboard recommendations for a noise-sensitive user", () => {
    const recommendations = getProductRecommendations(
      input({
        profile: profile({
          problems: ["wrist_pain", "noise_sensitivity"],
          preferences: ["quiet products"],
          accessibilityNeeds: ["noise_sensitivity"],
        }),
      }),
      categoryScore("keyboard"),
      productCatalog,
    );

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.every((recommendation) => recommendation.product.constraints.quiet)).toBe(true);
    expect(recommendations.map((recommendation) => recommendation.product.id)).not.toContain("keyboard-keychron-k-series");
  });

  it("penalizes large ultrawide monitors for a small desk user", () => {
    const smallDeskInput = input({
      profile: profile({
        budgetUsd: 700,
        problems: ["small_space", "low_productivity"],
        roomConstraints: ["small_space", "limited_desk_width"],
        constraints: { deskWidthInches: 32, portableSetup: true },
      }),
      inventory: [inventoryItem("laptop", { name: "Laptop" })],
    });
    const monitorCategory = getCategoryRecommendations(smallDeskInput).find(
      (recommendation) => recommendation.category === "monitor",
    );
    expect(monitorCategory).toBeDefined();

    const recommendations = getProductRecommendations(smallDeskInput, monitorCategory!, productCatalog);

    expect(recommendations.map((recommendation) => recommendation.product.id)).not.toContain("monitor-lg-34wp65c-b");
  });

  it("recommends laptop upgrades for a slow computer user with high budget", () => {
    const recommendations = rankProductsForInput(
      input({
        profile: profile({
          budgetUsd: 1800,
          spendingStyle: "premium",
          problems: ["slow_computer", "low_productivity"],
        }),
        inventory: [
          inventoryItem("laptop", {
            name: "Old slow laptop",
            condition: "poor",
            painPoints: ["slow_computer"],
          }),
        ],
      }),
    );

    expect(recommendations[0].product.category).toBe("laptop");
    expect(recommendations[0].product.solves).toContain("slow_computer");
  });

  it("recommends ergonomic mouse options for wrist pain", () => {
    const recommendations = rankProductsForInput(
      input({
        profile: profile({ problems: ["wrist_pain"] }),
        inventory: [
          inventoryItem("mouse", {
            name: "Basic mouse",
            condition: "fair",
            painPoints: ["wrist_pain"],
          }),
        ],
      }),
    );

    expect(recommendations[0].product.category).toBe("mouse");
    expect(recommendations[0].product.name.toLowerCase()).toMatch(/vertical|ergonomic/);
  });

  it("lets normalized current specs change product recommendation scores", () => {
    const testProfile = profile({
      budgetUsd: 300,
      problems: ["noise_sensitivity"],
      preferences: ["quiet products"],
    });
    const loudKeyboardCategory = rankCategories(testProfile, [
      inventoryItem("keyboard", { name: "loud clicky blue switch keyboard" }),
    ]).find((recommendation) => recommendation.category === "keyboard");
    const quietKeyboardCategory = rankCategories(testProfile, [
      inventoryItem("keyboard", { name: "quiet low-profile keyboard" }),
    ]).find((recommendation) => recommendation.category === "keyboard");

    expect(loudKeyboardCategory).toBeDefined();
    expect(quietKeyboardCategory).toBeDefined();
    expect(loudKeyboardCategory!.score).toBeGreaterThan(quietKeyboardCategory!.score);

    const recommendations = getProductRecommendations(
      input({
        profile: testProfile,
        inventory: [inventoryItem("keyboard", { name: "loud clicky blue switch keyboard" })],
      }),
      loudKeyboardCategory!,
      productCatalog,
    );

    expect(recommendations[0].product.category).toBe("keyboard");
    expect(recommendations[0].product.constraints.quiet).toBe(true);
  });

  it("includes score breakdowns and explanations for product recommendations", () => {
    const recommendation = getProductRecommendations(
      input({
        profile: profile({ problems: ["eye_strain"] }),
        inventory: [],
      }),
      categoryScore("monitor"),
      [product({ id: "monitor-with-explanation", name: "Monitor With Explanation" })],
    )[0];

    expect(recommendation.scoreBreakdown.finalScore).toBe(recommendation.score);
    expect(recommendation.scoreBreakdown.problemFit).toBeGreaterThan(0);
    expect(recommendation.scoreBreakdown.availabilityFit).toBe(40);
    expect(recommendation.explanation.problemSolved).toContain("Monitor With Explanation");
    expect(recommendation.explanation.whyThisModel).toContain("Monitor With Explanation");
  });

  it("moves a product up when its current price drops", () => {
    const recommendations = getProductRecommendations(
      input({
        profile: profile({ problems: ["eye_strain"], budgetUsd: 300 }),
        pricingByProductId: {
          "discounted-monitor": cachedPricing("discounted-monitor", 14000),
          "full-price-monitor": cachedPricing("full-price-monitor", 20000),
        },
        availabilityByProductId: {
          "discounted-monitor": availableSummary("discounted-monitor", { priceCents: 14000 }),
          "full-price-monitor": availableSummary("full-price-monitor", { priceCents: 20000 }),
        },
      }),
      categoryScore("monitor"),
      [
        product({ id: "discounted-monitor", name: "Discounted Monitor", priceUsd: 200 }),
        product({ id: "full-price-monitor", name: "Full Price Monitor", priceUsd: 200 }),
      ],
    );

    expect(recommendations[0]?.product.id).toBe("discounted-monitor");
    expect(recommendations[0]?.rankingChangedReason).toContain("moved up");
    expect(recommendations[0]?.priceDeltaFromExpected).toBe(-6000);
  });

  it("moves a product down when it becomes unavailable", () => {
    const recommendations = getProductRecommendations(
      input({
        profile: profile({ problems: ["eye_strain"], budgetUsd: 300 }),
        availabilityByProductId: {
          "unavailable-monitor": unavailableSummary("unavailable-monitor"),
          "available-monitor": availableSummary("available-monitor", { priceCents: 18000 }),
        },
      }),
      categoryScore("monitor"),
      [
        product({ id: "unavailable-monitor", name: "Unavailable Monitor", priceUsd: 180 }),
        product({ id: "available-monitor", name: "Available Monitor", priceUsd: 180 }),
      ],
    );

    const unavailableRecommendation = recommendations.find(
      (recommendation) => recommendation.product.id === "unavailable-monitor",
    );

    expect(recommendations[0]?.product.id).toBe("available-monitor");
    expect(unavailableRecommendation?.availabilityStatus).toBe("unavailable");
    expect(unavailableRecommendation?.rankingChangedReason).toContain("currently unavailable");
    expect(unavailableRecommendation?.scoreBreakdown.availabilityFit).toBe(0);
  });

  it("applies a stronger over-budget penalty for frugal users", () => {
    const expensiveChair = product({
      id: "expensive-chair",
      category: "chair",
      name: "Expensive Chair",
      priceUsd: 450,
      solves: ["back_pain"],
      scoreHints: {
        comfort: 8,
        productivity: 7,
        accessibility: 7,
        value: 7,
      },
    });

    const frugalRecommendation = getProductRecommendations(
      input({
        profile: profile({ budgetUsd: 300, spendingStyle: "FRUGAL", problems: ["back_pain"] }),
        pricingByProductId: {
          "expensive-chair": cachedPricing("expensive-chair", 45000),
        },
      }),
      categoryScore("chair"),
      [expensiveChair],
    )[0];
    const balancedRecommendation = getProductRecommendations(
      input({
        profile: profile({ budgetUsd: 300, spendingStyle: "balanced", problems: ["back_pain"] }),
        pricingByProductId: {
          "expensive-chair": cachedPricing("expensive-chair", 45000),
        },
      }),
      categoryScore("chair"),
      [expensiveChair],
    )[0];

    expect(frugalRecommendation.scoreBreakdown.valueFit).toBeLessThan(balancedRecommendation.scoreBreakdown.valueFit);
  });

  it("keeps cached prices usable in scoring", () => {
    const recommendation = getProductRecommendations(
      input({
        profile: profile({ problems: ["eye_strain"] }),
        pricingByProductId: {
          "cached-monitor": cachedPricing("cached-monitor", 10000),
        },
        availabilityByProductId: {
          "cached-monitor": availableSummary("cached-monitor", {
            priceCents: 10000,
            checkedAt: new Date(Date.now() - 1000 * 60 * 60 * 36),
            refreshSource: "cached",
          }),
        },
      }),
      categoryScore("monitor"),
      [product({ id: "cached-monitor", name: "Cached Monitor" })],
    )[0];

    expect(recommendation.currentBestPriceCents).toBe(10000);
    expect(recommendation.scoreBreakdown.availabilityFit).toBe(82);
    expect(recommendation.availabilityStatus).toBe("available");
    expect(recommendation.priceStatus).toBe("cached");
    expect(recommendation.priceConfidence).toBeGreaterThan(38);
    expect(recommendation.rankingChangedReason).toContain("cached market snapshot");
  });

  it("marks catalog-only estimates as lower confidence without using them for value fit", () => {
    const recommendations = getProductRecommendations(
      input({
        profile: profile({ problems: ["eye_strain"], budgetUsd: 300 }),
      }),
      categoryScore("monitor"),
      [
        product({ id: "catalog-cheap-monitor", name: "Catalog Cheap Monitor", priceUsd: 120, estimatedPriceCents: 12000 }),
        product({ id: "catalog-pricey-monitor", name: "Catalog Pricey Monitor", priceUsd: 900, estimatedPriceCents: 90000 }),
      ],
    );

    expect(recommendations[0]?.scoreBreakdown.valueFit).toBe(recommendations[1]?.scoreBreakdown.valueFit);
    expect(recommendations.every((recommendation) => recommendation.priceStatus === "catalog_estimate")).toBe(true);
    expect(recommendations.every((recommendation) => recommendation.priceConfidence < 50)).toBe(true);
    expect(recommendations.every((recommendation) => recommendation.currentBestPriceCents === null)).toBe(true);
    expect(recommendations.map((recommendation) => recommendation.estimatedMarketPriceCents).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      12000,
      90000,
    ]);
  });

  it("attaches stale snapshots without letting stale prices change value fit", () => {
    const recommendations = getProductRecommendations(
      input({
        profile: profile({ problems: ["eye_strain"], budgetUsd: 300 }),
        pricingByProductId: {
          "stale-price-monitor": cachedPricing("stale-price-monitor", 5000, { priceStatus: "stale" }),
        },
      }),
      categoryScore("monitor"),
      [
        product({ id: "catalog-only-monitor", name: "Catalog Only Monitor", priceUsd: 200, estimatedPriceCents: 20000 }),
        product({ id: "stale-price-monitor", name: "Stale Price Monitor", priceUsd: 200, estimatedPriceCents: 20000 }),
      ],
    );
    const catalogOnly = recommendations.find((recommendation) => recommendation.product.id === "catalog-only-monitor");
    const stale = recommendations.find((recommendation) => recommendation.product.id === "stale-price-monitor");

    expect(stale?.priceStatus).toBe("stale");
    expect(stale?.currentBestPriceCents).toBe(5000);
    expect(stale?.fetchedAt).toEqual(new Date("2026-04-25T12:00:00Z"));
    expect(stale?.scoreBreakdown.valueFit).toBe(catalogOnly?.scoreBreakdown.valueFit);
  });

  it("shows quota-limited pricing status in the ranking explanation", () => {
    const recommendation = getProductRecommendations(
      input({
        profile: profile({ problems: ["eye_strain"] }),
        pricingByProductId: {
          "quota-monitor": cachedPricing("quota-monitor", 10000),
        },
        availabilityByProductId: {
          "quota-monitor": availableSummary("quota-monitor", {
            priceCents: 10000,
            refreshSource: "cached",
            refreshSkippedReason: "free_tier_quota",
          }),
        },
      }),
      categoryScore("monitor"),
      [product({ id: "quota-monitor", name: "Quota Monitor" })],
    )[0];

    expect(recommendation.rankingChangedReason).toBe("This price is cached because the free-tier quota was reached.");
  });

  it("hides unavailable products when availableOnly is true", () => {
    const recommendation = getProductRecommendations(
      input({ profile: profile({ problems: ["eye_strain"] }) }),
      categoryScore("monitor"),
      [product({ id: "unavailable-monitor" })],
    )[0];
    const filters: RecommendationFilters = {
      underBudgetOnly: false,
      availableOnly: true,
      quietProductsOnly: false,
      smallSpaceFriendlyOnly: false,
    };

    expect(matchesFilters(recommendation, unavailableSummary("unavailable-monitor"), filters, profile())).toBe(false);
  });

  it("uses traitDeltaFit to rank better same-category upgrades", () => {
    const currentLaptop = inventoryItem("laptop", {
      name: "Apple MacBook Air M1 8GB",
      condition: "fair",
      painPoints: ["slow_computer"],
    });
    const recommendations = getProductRecommendations(
      input({
        profile: profile({ budgetUsd: 2200, problems: ["slow_computer"], profession: "Software engineer" }),
        inventory: [currentLaptop],
      }),
      categoryScore("laptop"),
      [
        product({
          id: "test-laptop-mba-m2",
          name: "MacBook Air M2 8GB",
          brand: "Apple",
          category: "laptop",
          priceUsd: 999,
          solves: ["slow_computer"],
        }),
        product({
          id: "test-laptop-mba-m5",
          name: "MacBook Air M5 24GB",
          brand: "Apple",
          category: "laptop",
          priceUsd: 1499,
          solves: ["slow_computer"],
        }),
      ],
    );

    const m5 = recommendations.find((recommendation) => recommendation.product.id === "test-laptop-mba-m5");
    const m2 = recommendations.find((recommendation) => recommendation.product.id === "test-laptop-mba-m2");

    expect(recommendations[0].product.id).toBe("test-laptop-mba-m5");
    expect(m5?.scoreBreakdown.traitDeltaFit).toBeGreaterThan(m2?.scoreBreakdown.traitDeltaFit ?? 0);
  });

  it("includes why-this-is-better facts in recommendation reasons", () => {
    const recommendation = getProductRecommendations(
      input({
        profile: profile({ problems: ["eye_strain", "low_productivity"] }),
        inventory: [],
      }),
      categoryScore("monitor"),
      [product({ id: "monitor-dell-s2722qc", name: "Dell S2722QC 27-inch 4K USB-C Monitor", brand: "Dell" })],
    )[0];

    expect(recommendation.deviceDelta?.explanationFacts[0]).toContain("Better than");
    expect(recommendation.reasons.join(" ")).toContain("Better than");
  });

  it("handles unrated Best Buy inventory without inventing trait fit", () => {
    const ratedMouse = inventoryItem("mouse", {
      name: "Rated ergonomic mouse",
      deviceCatalogId: "mouse-rated",
      catalogProductId: "mouse-rated",
      hasCatalogRatings: true,
      specs: {
        catalogDeviceId: "mouse-rated",
        traitRatings: {
          wristComfort: 70,
          ergonomicSupport: 72,
        },
      },
    });
    const unratedMouse = inventoryItem("mouse", {
      name: "Best Buy gaming mouse",
      rawProductTitle: "Best Buy gaming mouse",
      source: "bestbuy",
      priceCents: 4999,
      hasCatalogRatings: false,
      specs: {
        traitRatings: {
          wristComfort: 99,
          ergonomicSupport: 99,
        },
      },
    });
    const candidate = product({
      id: "upgrade-mouse",
      name: "Upgrade Mouse",
      category: "mouse",
      solves: ["wrist_pain"],
      traitRatings: {
        wristComfort: 80,
        ergonomicSupport: 80,
      },
      traitConfidence: 0.9,
    });

    const ratedRecommendation = rankProductsForInput(input({
      profile: profile({ problems: ["wrist_pain"], budgetUsd: 200 }),
      inventory: [ratedMouse],
      candidateProducts: [candidate],
    }))[0];
    const unratedRecommendation = rankProductsForInput(input({
      profile: profile({ problems: ["wrist_pain"], budgetUsd: 200 }),
      inventory: [unratedMouse],
      candidateProducts: [candidate],
    }))[0];

    expect(unratedRecommendation).toBeDefined();
    expect(unratedRecommendation?.reasons).toContain("This item is not rated yet, so fit scoring is limited.");
    expect(unratedRecommendation?.breakdown?.confidence).toBeLessThan(ratedRecommendation?.breakdown?.confidence ?? 100);
    expect(unratedRecommendation?.deviceDelta?.explanationFacts).toContain("This item is not rated yet, so fit scoring is limited.");
  });

  it("still recommends products when inventory only contains custom unrated items", () => {
    const recommendations = rankProductsForInput(input({
      profile: profile({ problems: ["low_productivity"], budgetUsd: 300 }),
      inventory: [
        inventoryItem("keyboard", {
          name: "My old keyboard",
          rawProductTitle: "My old keyboard",
          source: "custom",
          hasCatalogRatings: false,
          specs: undefined,
        }),
      ],
      candidateProducts: [
        product({
          id: "keyboard-upgrade",
          name: "Quiet Keyboard",
          category: "keyboard",
          solves: ["low_productivity"],
        }),
      ],
    }));

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.reasons).toContain("This item is not rated yet, so fit scoring is limited.");
  });
});
