import { productCatalog as defaultProductCatalog } from "../../data/seeds/productCatalog";
import type { AvailabilitySummary } from "../availability";
import { computeDeviceDelta, findCurrentDeviceForProduct } from "../devices/deviceDelta";
import type { DeviceDelta } from "../devices/deviceTypes";
import type {
  CategoryScore,
  InventoryItem,
  Product,
  ProductCategory,
  ProductRecommendation,
  RecommendationPriceSnapshot,
  RecommendationInput,
  ScoreBreakdown,
  UserProblem,
  UserProfile,
} from "./types";
import { explainProductRecommendation } from "./explanations";
import { scoreErgonomicFit } from "./fitScoring";
import { rankCategories } from "./scoring";
import { scoreToFit } from "./scoring";

const FINAL_WEIGHTS = {
  problemFit: 0.22,
  traitDeltaFit: 0.2,
  ergonomicFit: 0.18,
  constraintFit: 0.13,
  valueFit: 0.14,
  compatibilityFit: 0.05,
  availabilityFit: 0.05,
  confidence: 0.03,
} as const;

const RECENT_PRICE_WINDOW_MS = 1000 * 60 * 60 * 24;

const genericInventoryPattern = /\b(basic|built[- ]?in|generic|old|screen|laptop|keyboard|mouse|earbuds|unknown)\b/i;
const unratedInventoryExplanation = "This item is not rated yet, so fit scoring is limited.";

const accessoryCategories = new Set<ProductCategory>([
  "monitor",
  "laptop_stand",
  "keyboard",
  "mouse",
  "chair",
  "desk_lamp",
  "headphones",
  "webcam",
  "storage",
]);

function productPriceUsd(product: Product): number {
  return product.priceUsd;
}

function productExpectedPriceCents(product: Product): number {
  return Math.max(
    1,
    Math.round(product.estimatedPriceCents ?? product.typicalUsedPriceCents ?? product.priceUsd * 100),
  );
}

function requiredDeskWidth(product: Product): number | undefined {
  return product.constraints.minDeskWidthInches;
}

function isPortableProduct(product: Product): boolean {
  return Boolean(product.constraints.portable);
}

function isQuietProduct(product: Product): boolean {
  return Boolean(product.constraints.quiet);
}

function getAvailabilitySummary(
  availabilityByProductId: RecommendationInput["availabilityByProductId"],
  productId: string,
): AvailabilitySummary | undefined {
  if (!availabilityByProductId) return undefined;

  if (availabilityByProductId instanceof Map) {
    return availabilityByProductId.get(productId);
  }

  return availabilityByProductId[productId];
}

function getRecommendationPricing(
  pricingByProductId: RecommendationInput["pricingByProductId"],
  productId: string,
): RecommendationPriceSnapshot | undefined {
  if (!pricingByProductId) return undefined;

  if (pricingByProductId instanceof Map) {
    return pricingByProductId.get(productId);
  }

  return pricingByProductId[productId];
}

function cachedPricingCents(pricing: RecommendationPriceSnapshot | undefined): number | null {
  return pricing?.bestOffer?.totalPriceCents ?? pricing?.bestOffer?.priceCents ?? pricing?.estimatedMarketPriceCents ?? null;
}

function availabilityStatus(
  summary: AvailabilitySummary | undefined,
  pricing: RecommendationPriceSnapshot | undefined,
): ProductRecommendation["availabilityStatus"] {
  if (summary?.status === "available") return "available";
  if (summary?.status === "unavailable") return "unavailable";
  if (pricing?.bestOffer?.available) return "available";
  return "unknown";
}

function isRecentSnapshot(summary: AvailabilitySummary | undefined, currentDate: Date = new Date()): boolean {
  if (!summary?.checkedAt) return false;
  return currentDate.getTime() - summary.checkedAt.getTime() < RECENT_PRICE_WINDOW_MS;
}

function scoreAvailabilityFit(summary: AvailabilitySummary | undefined, currentDate: Date = new Date()): number {
  if (!summary || summary.status === "checking_not_configured") {
    return 40;
  }

  if (summary.status === "unavailable") {
    return 0;
  }

  return isRecentSnapshot(summary, currentDate) ? 100 : 70;
}

function scoreAvailabilityFitWithPricing(
  summary: AvailabilitySummary | undefined,
  pricing: RecommendationPriceSnapshot | undefined,
  currentDate: Date = new Date(),
): number {
  const summaryScore = scoreAvailabilityFit(summary, currentDate);
  if (!pricing) return summaryScore;
  if (pricing.priceStatus === "cached") return Math.max(summaryScore, 82);
  return Math.max(summaryScore, 62);
}

function effectivePriceCents(product: Product, pricing: RecommendationPriceSnapshot | undefined): number {
  return cachedPricingCents(pricing) ?? productExpectedPriceCents(product);
}

function priceConfidence(pricing: RecommendationPriceSnapshot | undefined): number {
  if (!pricing) return 38;

  const offerConfidence = pricing.bestOffer?.confidence;
  const base = pricing.priceStatus === "cached" ? 84 : 58;
  return clampScore(offerConfidence === undefined ? base : base * 0.55 + offerConfidence * 0.45);
}

export function getProductRecommendations(
  input: RecommendationInput,
  categoryRecommendation: CategoryScore,
  productCatalog: Product[],
): ProductRecommendation[] {
  return productCatalog
    .filter((product) => product.category === categoryRecommendation.category)
    .filter((product) => passesHardFilters(product, input))
    .map((product) => buildRecommendation(product, input, categoryRecommendation, productCatalog))
    .sort((a, b) => b.score - a.score || productPriceUsd(a.product) - productPriceUsd(b.product));
}

export function rankProducts(profile: UserProfile, inventory: InventoryItem[]): ProductRecommendation[] {
  return rankProductsForInput({ profile, inventory });
}

export function rankProductsForInput(input: RecommendationInput): ProductRecommendation[] {
  const productCatalog = input.candidateProducts ?? defaultProductCatalog;

  return rankCategories(input.profile, input.inventory)
    .flatMap((categoryRecommendation) =>
      getProductRecommendations(input, categoryRecommendation, productCatalog),
    )
    .sort((a, b) => b.score - a.score || productPriceUsd(a.product) - productPriceUsd(b.product));
}

function buildRecommendation(
  product: Product,
  input: RecommendationInput,
  categoryRecommendation: CategoryScore,
  productCatalog: Product[],
): ProductRecommendation {
  const summary = getAvailabilitySummary(input.availabilityByProductId, product.id);
  const pricing = getRecommendationPricing(input.pricingByProductId, product.id);
  const currentBestPriceCents = cachedPricingCents(pricing);
  const expectedPriceCents = productExpectedPriceCents(product);
  const deviceDelta = computeDeviceDelta(findCurrentDeviceForProduct(product, input.inventory), product, input.profile);
  let problemFit = scoreProblemFit(product, input.profile, input.inventory, categoryRecommendation, deviceDelta);
  let traitDeltaFit = scoreTraitDeltaFit(deviceDelta);
  const ergonomicFit = scoreErgonomicFit({
    product,
    profile: input.profile,
    privateProfile: input.privateProfile,
  });
  const constraintFit = scoreConstraintFit(product, input);
  const cheaperAccessoriesFirst =
    product.category === "laptop" &&
    !input.profile.problems.includes("slow_computer") &&
    cheaperAccessoriesSolveMainIssue(product, input, productCatalog);
  let valueFit = scoreValueFit(product, input.profile, categoryRecommendation, problemFit, pricing);
  let compatibilityFit = scoreCompatibilityFit(product, input);
  const availabilityFit = scoreAvailabilityFitWithPricing(summary, pricing);
  const confidence = clampScore(
    scoreConfidence(product, input, ergonomicFit.missingDeviceSpecs) * 0.65 + deviceDelta.confidence * 0.35,
  );

  if (product.category === "laptop" && input.profile.problems.includes("slow_computer")) {
    const weakCurrentLaptop = input.inventory.some(
      (item) => item.category === "laptop" && (item.condition === "poor" || item.condition === "fair"),
    );
    problemFit = clampScore(problemFit + (weakCurrentLaptop ? 14 : 8));
    traitDeltaFit = clampScore(traitDeltaFit + (weakCurrentLaptop ? 18 : 10));
  } else if (input.profile.problems.includes("slow_computer") && !product.solves.includes("slow_computer")) {
    const weakCurrentLaptop = input.inventory.some(
      (item) => item.category === "laptop" && (item.condition === "poor" || item.condition === "fair"),
    );
    if (weakCurrentLaptop) {
      problemFit = clampScore(problemFit - 18);
      traitDeltaFit = clampScore(traitDeltaFit - 10);
    }
  }

  if (cheaperAccessoriesFirst) {
    valueFit = clampScore(valueFit - 24);
    compatibilityFit = clampScore(compatibilityFit - 12);
  }

  const finalScore = clampScore(
    problemFit * FINAL_WEIGHTS.problemFit +
      traitDeltaFit * FINAL_WEIGHTS.traitDeltaFit +
      ergonomicFit.fitScore * FINAL_WEIGHTS.ergonomicFit +
      constraintFit * FINAL_WEIGHTS.constraintFit +
      valueFit * FINAL_WEIGHTS.valueFit +
      compatibilityFit * FINAL_WEIGHTS.compatibilityFit +
      availabilityFit * FINAL_WEIGHTS.availabilityFit +
      confidence * FINAL_WEIGHTS.confidence,
  );
  const scoreBreakdown: ScoreBreakdown = {
    problemFit,
    ergonomicFit: ergonomicFit.fitScore,
    traitDeltaFit,
    constraintFit,
    valueFit,
    compatibilityFit,
    availabilityFit,
    confidence,
    finalScore,
  };

  return {
    product,
    finalRecommendationScore: finalScore,
    fitScore: ergonomicFit.fitScore,
    traitDeltaScore: traitDeltaFit,
    score: finalScore,
    breakdown: scoreBreakdown,
    scoreBreakdown,
    deviceDelta,
    fit: scoreToFit(finalScore),
    reasons: buildReasons(product, input, categoryRecommendation, scoreBreakdown, productCatalog, pricing, summary, deviceDelta, ergonomicFit.reasons),
    explanation: explainProductRecommendation(product, input.profile, categoryRecommendation, input.inventory, finalScore),
    tradeoffs: buildTradeoffs(product, input),
    whyNotCheaper: explainCheaperAlternative(product, input, categoryRecommendation, productCatalog),
    whyNotMoreExpensive: explainMoreExpensiveAlternative(product, input, categoryRecommendation, productCatalog),
    isAspirational: effectivePriceCents(product, pricing) > input.profile.budgetUsd * 100,
    profileFieldsUsed: ergonomicFit.profileFieldsUsed,
    missingDeviceSpecs: ergonomicFit.missingDeviceSpecs,
    confidenceLevel: confidenceLevelForScore(confidence),
    currentBestPriceCents,
    priceDeltaFromExpected: currentBestPriceCents === null ? null : currentBestPriceCents - expectedPriceCents,
    lastCheckedAt: pricing?.fetchedAt ?? summary?.checkedAt ?? null,
    availabilityStatus: availabilityStatus(summary, pricing),
    rankingChangedReason: buildRankingChangedReason(product, input.profile, pricing, summary),
    bestOffer: pricing?.bestOffer ?? null,
    estimatedMarketPriceCents: pricing?.estimatedMarketPriceCents ?? (pricing ? null : expectedPriceCents),
    priceStatus: pricing?.priceStatus ?? "catalog_estimate",
    fetchedAt: pricing?.fetchedAt ?? null,
    priceConfidence: priceConfidence(pricing),
  };
}

function passesHardFilters(product: Product, input: RecommendationInput): boolean {
  const { profile } = input;

  if (
    product.category === "monitor" &&
    requiredDeskWidth(product) !== undefined &&
    profile.constraints.deskWidthInches < requiredDeskWidth(product)!
  ) {
    return false;
  }

  if (product.category === "keyboard" && hasNoiseSensitivity(profile) && !isQuietProduct(product)) {
    return false;
  }

  return true;
}

function scoreProblemFit(
  product: Product,
  profile: UserProfile,
  inventory: InventoryItem[],
  categoryRecommendation: CategoryScore,
  deviceDelta?: DeviceDelta,
): number {
  const directMatches = profile.problems.filter((problem) => product.solves.includes(problem));
  const selectedProblemCount = Math.max(profile.problems.length, 1);
  const ownedPainMatches = inventory
    .filter((item) => item.category === product.category)
    .flatMap((item) => item.painPoints)
    .filter((problem) => product.solves.includes(problem));

  return clampScore(
    22 +
      (directMatches.length / selectedProblemCount) * 54 +
      categoryRecommendation.score * 0.22 +
      Math.min(ownedPainMatches.length * 7, 16) +
      (deviceDelta?.problemSpecificImprovements.length ?? 0) * 4,
  );
}

function scoreTraitDeltaFit(deviceDelta: DeviceDelta): number {
  const regressionPenalty = Math.min(24, deviceDelta.regressions.length * 6);
  const improvementBonus = Math.min(10, deviceDelta.problemSpecificImprovements.length * 2);

  return clampScore(deviceDelta.totalImprovementScore + improvementBonus - regressionPenalty);
}

function scoreConstraintFit(product: Product, input: RecommendationInput): number {
  const { profile } = input;
  let score = 76;

  const minDeskWidth = requiredDeskWidth(product);
  if (minDeskWidth !== undefined) {
    const clearance = profile.constraints.deskWidthInches - minDeskWidth;
    if (clearance >= 8) score += 7;
    else if (clearance >= 0) score += 2;
    else score -= 35;
  }

  if (profile.constraints.portableSetup) {
    score += isPortableProduct(product) ? 8 : -6;
  }

  if (hasNoiseSensitivity(profile) || profile.constraints.sharesSpace) {
    score += isQuietProduct(product) ? 8 : product.category === "keyboard" || product.category === "headphones" ? -18 : 0;
  }

  if (input.usedItemsOkay ?? profile.preferences.some((preference) => preference.toLowerCase().includes("used"))) {
    score += hintScore(product.scoreHints.value) >= 80 ? 4 : 0;
  }

  return clampScore(score);
}

function scoreValueFit(
  product: Product,
  profile: UserProfile,
  categoryRecommendation: CategoryScore,
  problemFit: number,
  pricing: RecommendationPriceSnapshot | undefined,
): number {
  const expectedImpact =
    problemFit * 0.42 +
    categoryRecommendation.score * 0.22 +
    hintScore(product.scoreHints.comfort) * 0.1 +
    hintScore(product.scoreHints.productivity) * 0.12 +
    hintScore(product.scoreHints.accessibility) * 0.08;
  const qualityScore = clampScore(
    hintScore(product.scoreHints.comfort) * 0.28 +
      hintScore(product.scoreHints.productivity) * 0.42 +
      hintScore(product.scoreHints.accessibility) * 0.18 +
      hintScore(product.scoreHints.value) * 0.12,
  );

  // Stale and catalog-only prices are displayed, but not trusted enough to move valueFit.
  if (!pricing || pricing.priceStatus === "stale") {
    return clampScore(
      expectedImpact * 0.52 +
        hintScore(product.scoreHints.value) * 0.24 +
        qualityScore * 0.24,
    );
  }

  const currentPriceCents = effectivePriceCents(product, pricing);
  const expectedPriceCents = productExpectedPriceCents(product);
  const budgetCents = Math.max(profile.budgetUsd * 100, 1);
  const priceDeltaRatio = (expectedPriceCents - currentPriceCents) / expectedPriceCents;
  const budgetRatio = currentPriceCents / budgetCents;
  let marketPriceScore = 62 + priceDeltaRatio * 55;

  if (budgetRatio <= 0.6) marketPriceScore += 8;
  else if (budgetRatio <= 0.85) marketPriceScore += 3;
  else if (budgetRatio > 1) {
    const overBudgetPenalty = 24 + (budgetRatio - 1) * 28;
    marketPriceScore -= overBudgetPenalty;

    if (isFrugalSpender(profile)) marketPriceScore -= 22;
    else if (isLeanSpender(profile)) marketPriceScore -= 10;
  }

  let valueFit =
    expectedImpact * 0.44 +
    hintScore(product.scoreHints.value) * 0.22 +
    qualityScore * 0.14 +
    clampScore(marketPriceScore) * 0.2;

  if (currentPriceCents <= expectedPriceCents * 0.72 && qualityScore < 62) {
    valueFit = Math.min(valueFit, clampScore(qualityScore + 8));
  }

  return clampScore(valueFit);
}

function scoreCompatibilityFit(product: Product, input: RecommendationInput): number {
  const { profile, inventory } = input;
  const ownedSameCategory = inventory.find((item) => item.category === product.category);
  let score = ownedSameCategory ? 62 : 76;

  if (ownedSameCategory?.condition === "poor") score += 22;
  if (ownedSameCategory?.condition === "fair") score += 14;
  if (ownedSameCategory?.condition === "good") score -= 6;
  if (ownedSameCategory?.painPoints.some((problem) => product.solves.includes(problem))) score += 12;

  if (input.deviceType === "laptop") {
    score += product.category === "laptop_stand" || product.category === "monitor" || product.category === "webcam" ? 7 : 0;
  }

  if (profile.constraints.portableSetup && isPortableProduct(product)) score += 8;
  if (requiredDeskWidth(product) !== undefined) {
    score += profile.constraints.deskWidthInches >= requiredDeskWidth(product)! ? 4 : -30;
  }

  if (input.ports && needsKnownPort(product) && !hasLikelyPortMatch(product, input.ports)) {
    score -= 18;
  }

  return clampScore(score);
}

function itemHasCatalogRatings(item: InventoryItem | undefined): boolean {
  if (!item || item.source === "bestbuy" || item.source === "custom" || item.hasCatalogRatings === false) return false;
  return true;
}

function hasUnratedSameCategoryInventory(product: Product, inventory: InventoryItem[]): boolean {
  return inventory.some((item) => item.category === product.category && !itemHasCatalogRatings(item));
}

function scoreConfidence(product: Product, input: RecommendationInput, missingDeviceSpecs: string[] = []): number {
  const sameCategoryItem = input.inventory.find((item) => item.category === product.category);
  const fitDataPenalty = missingDeviceSpecs.length > 0 ? 12 : 0;
  const unratedPenalty = sameCategoryItem && !itemHasCatalogRatings(sameCategoryItem) ? 20 : 0;
  const applyPenalty = (score: number) => clampScore(score - fitDataPenalty - unratedPenalty);

  if (input.exactCurrentModelsProvided === true) return applyPenalty(sameCategoryItem ? 90 : 80);
  if (input.exactCurrentModelsProvided === false) return applyPenalty(sameCategoryItem ? 60 : 66);
  if (!sameCategoryItem) return applyPenalty(input.inventory.length > 0 ? 72 : 56);

  return applyPenalty(genericInventoryPattern.test(sameCategoryItem.name) ? 62 : 86);
}

function buildReasons(
  product: Product,
  input: RecommendationInput,
  categoryRecommendation: CategoryScore,
  breakdown: ScoreBreakdown,
  productCatalog: Product[],
  pricing: RecommendationPriceSnapshot | undefined,
  summary: AvailabilitySummary | undefined,
  deviceDelta?: DeviceDelta,
  fitReasons: string[] = [],
): string[] {
  const solvedProblems = input.profile.problems.filter((problem) => product.solves.includes(problem));
  const reasons = [...categoryRecommendation.reasons];
  const displayedPriceUsd = Math.round(effectivePriceCents(product, pricing) / 100);

  if (hasUnratedSameCategoryInventory(product, input.inventory)) {
    reasons.push(unratedInventoryExplanation);
  }

  if (solvedProblems.length > 0) {
    reasons.push(`${product.name} directly targets ${formatProblemList(solvedProblems)}.`);
  }

  if (breakdown.valueFit >= 78) {
    reasons.push(`Strong value for the expected impact at $${displayedPriceUsd}.`);
  }

  if (breakdown.compatibilityFit >= 78) {
    reasons.push("Fits the current setup and inventory well.");
  }

  if (deviceDelta?.explanationFacts[0]) {
    reasons.push(deviceDelta.explanationFacts[0]);
  }

  reasons.push(...fitReasons);

  if (displayedPriceUsd > input.profile.budgetUsd) {
    reasons.push(
      pricing
        ? "Current listings run above budget, so this is a stretch option right now."
        : "Catalog estimate is above budget, so this is a stretch option right now.",
    );
  }

  if (summary?.refreshSkippedReason === "free_tier_quota") {
    reasons.push("Price is using cached data because the free-tier quota was reached.");
  }

  if (!pricing) {
    reasons.push("Price confidence is lower because only the catalog estimate is available.");
  } else if (pricing.priceStatus === "stale") {
    reasons.push("Price is based on a stale cached market snapshot.");
  }

  if (product.category === "laptop" && cheaperAccessoriesSolveMainIssue(product, input, productCatalog)) {
    reasons.push("Worth revisiting after the cheaper ergonomic and productivity fixes are handled first.");
  }

  return Array.from(new Set(reasons)).slice(0, 5);
}

function buildTradeoffs(product: Product, input: RecommendationInput): string[] {
  const tradeoffs: string[] = [];
  const priceShare = productPriceUsd(product) / Math.max(input.profile.budgetUsd, 1);

  if (priceShare > 0.75) tradeoffs.push("Uses a large share of the available budget.");
  if (requiredDeskWidth(product) !== undefined) {
    tradeoffs.push(`Needs about ${requiredDeskWidth(product)} inches of desk width.`);
  }
  if (input.profile.constraints.portableSetup && !isPortableProduct(product)) {
    tradeoffs.push("Less portable than the rest of the setup.");
  }
  if (product.category === "monitor") tradeoffs.push("Ports and cable support should be confirmed before buying.");

  return tradeoffs.length > 0 ? tradeoffs : ["No major tradeoff beyond confirming fit and availability."];
}

function buildRankingChangedReason(
  product: Product,
  profile: UserProfile,
  pricing: RecommendationPriceSnapshot | undefined,
  summary: AvailabilitySummary | undefined,
): string {
  const currentPriceCents = cachedPricingCents(pricing);

  if (summary?.status === "unavailable") {
    return `This ${product.category.replaceAll("_", " ")} moved down because it is currently unavailable.`;
  }

  if (!pricing) {
    return `${product.name} is using the catalog estimate because no cached market snapshot is available.`;
  }

  if (pricing.priceStatus === "stale") {
    return `${product.name} is using a stale cached market snapshot until pricing is refreshed manually.`;
  }

  if (!summary || summary.status === "checking_not_configured") {
    return `${product.name} is using cached market pricing; current availability has not been refreshed automatically.`;
  }

  if (summary.refreshSkippedReason === "free_tier_quota") {
    return "This price is cached because the free-tier quota was reached.";
  }

  const expectedPriceCents = productExpectedPriceCents(product);
  if (currentPriceCents === null) {
    return `${product.name} stayed in place because the latest listing price could not be verified.`;
  }

  if (currentPriceCents < expectedPriceCents) {
    return `This ${product.category.replaceAll("_", " ")} moved up because its current price dropped below your target.`;
  }

  if (currentPriceCents > profile.budgetUsd * 100) {
    return `This ${product.category.replaceAll("_", " ")} moved down because current listings are above your budget.`;
  }

  if (summary.refreshSource === "cached") {
    return `${product.name} is using a cached market snapshot while newer pricing is pending.`;
  }

  return `${product.name} kept its place because current availability still matches the expected price range.`;
}

function explainCheaperAlternative(
  product: Product,
  input: RecommendationInput,
  categoryRecommendation: CategoryScore,
  productCatalog: Product[],
): string {
  const cheaper = comparableProducts(product, input, categoryRecommendation, productCatalog)
    .filter((candidate) => productPriceUsd(candidate) < productPriceUsd(product))
    .sort((a, b) => productPriceUsd(b) - productPriceUsd(a))[0];

  if (!cheaper) {
    return "This is already the lowest-priced suitable model in this category.";
  }

  const solvedGap =
    product.solves.filter((problem) => input.profile.problems.includes(problem)).length -
    cheaper.solves.filter((problem) => input.profile.problems.includes(problem)).length;

  if (solvedGap > 0 || hintScore(product.scoreHints.productivity) > hintScore(cheaper.scoreHints.productivity)) {
    return `${cheaper.name} costs less, but ${product.name} better matches the selected problems or productivity impact.`;
  }

  return `${cheaper.name} is cheaper, but this model has the stronger overall balance of fit, constraints, and confidence.`;
}

function explainMoreExpensiveAlternative(
  product: Product,
  input: RecommendationInput,
  categoryRecommendation: CategoryScore,
  productCatalog: Product[],
): string {
  const moreExpensive = comparableProducts(product, input, categoryRecommendation, productCatalog)
    .filter((candidate) => productPriceUsd(candidate) > productPriceUsd(product))
    .sort((a, b) => productPriceUsd(a) - productPriceUsd(b))[0];

  if (!moreExpensive) {
    return "A more expensive suitable model is not needed for the stated problems and constraints.";
  }

  if (productPriceUsd(moreExpensive) > input.profile.budgetUsd && !isPremiumSpender(input.profile)) {
    return `${moreExpensive.name} may add polish, but it exceeds the current budget without enough extra impact.`;
  }

  return `${moreExpensive.name} may add premium features, but this model keeps better value for the expected impact.`;
}

function comparableProducts(
  product: Product,
  input: RecommendationInput,
  categoryRecommendation: CategoryScore,
  productCatalog: Product[],
): Product[] {
  return productCatalog.filter(
    (candidate) =>
      candidate.category === product.category &&
      candidate.id !== product.id &&
      categoryRecommendation.category === candidate.category &&
      passesHardFilters(candidate, input),
  );
}

function cheaperAccessoriesSolveMainIssue(
  product: Product,
  input: RecommendationInput,
  productCatalog: Product[],
): boolean {
  const mainProblems = input.profile.problems.filter((problem) => product.solves.includes(problem));
  if (mainProblems.length === 0) return false;

  return productCatalog.some(
    (candidate) =>
      accessoryCategories.has(candidate.category) &&
      candidate.id !== product.id &&
      productPriceUsd(candidate) <= productPriceUsd(product) * 0.35 &&
      mainProblems.some((problem) => candidate.solves.includes(problem)),
  );
}

function hasNoiseSensitivity(profile: UserProfile): boolean {
  return (
    profile.problems.includes("noise_sensitivity") ||
    profile.roomConstraints?.includes("needs_quiet") ||
    [...profile.accessibilityNeeds, ...profile.preferences].some((value) => {
      const normalized = value.toLowerCase().replace(/[- ]/g, "_");
      return normalized.includes("noise_sensitivity") || normalized.includes("quiet");
    })
  );
}

function needsKnownPort(product: Product): boolean {
  return product.category === "monitor" || product.category === "webcam";
}

function hasLikelyPortMatch(product: Product, ports: string[]): boolean {
  const normalizedPorts = ports.map((port) => port.toLowerCase());
  if (product.category === "monitor") {
    return normalizedPorts.some((port) => port.includes("usb-c") || port.includes("hdmi") || port.includes("displayport") || port.includes("thunderbolt"));
  }
  if (product.category === "webcam") {
    return normalizedPorts.some((port) => port.includes("usb") || port.includes("thunderbolt"));
  }
  return true;
}

function isPremiumSpender(profile: UserProfile): boolean {
  return profile.spendingStyle.toLowerCase() === "premium";
}

function isFrugalSpender(profile: UserProfile): boolean {
  return profile.spendingStyle.toLowerCase() === "frugal";
}

function isLeanSpender(profile: UserProfile): boolean {
  const style = profile.spendingStyle.toLowerCase();
  return style === "lean" || style === "frugal" || style === "value";
}

function confidenceLevelForScore(score: number): ProductRecommendation["confidenceLevel"] {
  if (score >= 80) return "high";
  if (score >= 62) return "medium";
  return "low";
}

function hintScore(value: number): number {
  return clampScore(value <= 10 ? value * 10 : value * 4);
}

function formatProblemList(problems: UserProblem[]): string {
  return problems.map((problem) => problem.replaceAll("_", " ")).join(", ");
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
