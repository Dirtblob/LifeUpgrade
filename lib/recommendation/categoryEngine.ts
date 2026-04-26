import type {
  CategoryRecommendation,
  CategoryScore,
  InventoryItem,
  ProductCategory,
  RecommendationInput,
  UserProblem,
  UserProfile,
} from "./types";
import { PRODUCT_CATEGORIES } from "./types";
import { categoryLabels } from "./scoring";
import {
  normalizeChairSpecs,
  normalizeKeyboardSpecs,
  normalizeLaptopSpecs,
  normalizeMonitorSpecs,
  normalizeMouseSpecs,
} from "../catalog/specNormalizer";

type Priority = CategoryRecommendation["priority"];

interface CategoryAccumulator {
  category: ProductCategory;
  score: number;
  reasons: string[];
  problemsAddressed: Set<UserProblem>;
  missingFromInventory: boolean;
  missingOrUpgradeReason: string;
}

const lowCostHighImpactCategories = new Set<ProductCategory>([
  "laptop_stand",
  "mouse",
  "keyboard",
  "desk_lamp",
  "headphones",
  "storage",
  "cable_management",
]);

const expensiveCategories = new Set<ProductCategory>(["laptop", "chair", "monitor"]);

const productivityProfessions = ["software engineer", "developer", "student", "designer"];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function itemText(item: InventoryItem): string {
  return normalizeText(`${item.rawProductTitle ?? item.name} ${item.brand ?? ""} ${item.model ?? ""} ${item.category}`);
}

function itemHasCatalogRatings(item: InventoryItem): boolean {
  if (item.source === "bestbuy" || item.source === "custom" || item.hasCatalogRatings === false) return false;
  return true;
}

function itemSpecRaw(item: InventoryItem): Record<string, unknown> {
  return {
    name: item.name,
    category: item.category,
    condition: item.condition,
    painPoints: item.painPoints,
    ...(itemHasCatalogRatings(item) ? (item.specs ?? {}) : {}),
  };
}

function hasProblem(profile: UserProfile, problem: UserProblem): boolean {
  return profile.problems.includes(problem);
}

function hasAnyProblem(profile: UserProfile, problems: UserProblem[]): boolean {
  return problems.some((problem) => hasProblem(profile, problem));
}

function hasRoomConstraint(profile: UserProfile, constraint: string): boolean {
  return profile.roomConstraints?.includes(constraint as never) ?? false;
}

function isLaptopLike(item: InventoryItem): boolean {
  const text = itemText(item);
  return item.category === "laptop" || text.includes("laptop") || text.includes("macbook");
}

function isExternalMonitor(item: InventoryItem): boolean {
  const text = itemText(item);
  return item.category === "monitor" && !isLaptopLike(item) && !text.includes("built-in");
}

function isErgonomicInput(item: InventoryItem): boolean {
  if (!itemHasCatalogRatings(item)) return false;

  const text = itemText(item);
  const mouseSpecs = normalizeMouseSpecs(itemSpecRaw(item));
  const keyboardSpecs = normalizeKeyboardSpecs(itemSpecRaw(item));

  if (item.category === "mouse" && mouseSpecs.ergonomic === true) return true;
  if (item.category === "keyboard" && keyboardSpecs.ergonomic === true) return true;

  return (
    text.includes("ergo") ||
    text.includes("vertical") ||
    text.includes("trackball") ||
    text.includes("split") ||
    text.includes("low profile") ||
    text.includes("low-profile")
  );
}

function isErgonomicChair(item: InventoryItem): boolean {
  if (!itemHasCatalogRatings(item)) return false;

  const text = itemText(item);
  const specs = normalizeChairSpecs(itemSpecRaw(item));

  if (specs.lumbarSupport === false) return false;
  if (specs.lumbarSupport === true || specs.ergonomic === true || specs.adjustable === true) return true;

  return text.includes("ergo") || text.includes("lumbar") || text.includes("adjustable");
}

function hasLowRamLaptop(inventory: InventoryItem[]): boolean {
  return inventory.some(
    (item) =>
      itemHasCatalogRatings(item) &&
      isLaptopLike(item) &&
      (normalizeLaptopSpecs(itemSpecRaw(item)).ramGb ?? Number.POSITIVE_INFINITY) <= 8,
  );
}

function hasBelow1080pMonitor(inventory: InventoryItem[]): boolean {
  return inventory.some(
    (item) =>
      itemHasCatalogRatings(item) &&
      isExternalMonitor(item) &&
      normalizeMonitorSpecs(itemSpecRaw(item)).resolutionClass === "below_1080p",
  );
}

function hasLoudKeyboard(inventory: InventoryItem[]): boolean {
  return inventory.some(
    (item) => itemHasCatalogRatings(item) && item.category === "keyboard" && normalizeKeyboardSpecs(itemSpecRaw(item)).loud === true,
  );
}

function hasChairWithoutLumbar(inventory: InventoryItem[]): boolean {
  return inventory.some(
    (item) => itemHasCatalogRatings(item) && item.category === "chair" && normalizeChairSpecs(itemSpecRaw(item)).lumbarSupport === false,
  );
}

function selectedDisplayProblems(profile: UserProfile): UserProblem[] {
  return profile.problems.filter((problem) =>
    ["eye_strain", "low_productivity", "poor_focus", "slow_computer", "neck_pain"].includes(problem),
  );
}

function hasGoodCategory(inventory: InventoryItem[], category: ProductCategory): boolean {
  return inventory.some((item) => item.category === category && item.condition !== "poor");
}

function hasWeakCategory(inventory: InventoryItem[], category: ProductCategory): boolean {
  return inventory.some(
    (item) => item.category === category && (item.condition === "poor" || item.condition === "fair"),
  );
}

function isBudgetLimited(profile: UserProfile): boolean {
  return (
    hasProblem(profile, "budget_limited") ||
    profile.budgetUsd < 250 ||
    ["lean", "frugal", "FRUGAL"].includes(profile.spendingStyle)
  );
}

function budgetAllowsLaptop(profile: UserProfile): boolean {
  return profile.budgetUsd >= 800 || (profile.spendingStyle === "premium" && profile.budgetUsd >= 650);
}

function hasSmallSpace(profile: UserProfile): boolean {
  return (
    hasProblem(profile, "small_space") ||
    hasRoomConstraint(profile, "small_space") ||
    hasRoomConstraint(profile, "limited_desk_width") ||
    profile.constraints.deskWidthInches <= 36
  );
}

function hasBadLighting(profile: UserProfile): boolean {
  return (
    hasProblem(profile, "bad_lighting") ||
    hasRoomConstraint(profile, "low_light") ||
    hasRoomConstraint(profile, "mixed_lighting") ||
    profile.constraints.roomLighting === "low"
  );
}

function isProductivityProfession(profile: UserProfile): boolean {
  const profession = normalizeText(profile.profession);
  return productivityProfessions.some((keyword) => profession.includes(keyword));
}

function isRemoteWorker(profile: UserProfile): boolean {
  const profession = normalizeText(profile.profession);
  return profession.includes("remote") || profession.includes("work from home") || profile.constraints.sharesSpace;
}

function priorityForScore(score: number): Priority {
  if (score >= 80) return "critical";
  if (score >= 65) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function makeMissingReason(category: ProductCategory, inventory: InventoryItem[]): string {
  const label = categoryLabels[category].toLowerCase();
  const weakItem = inventory.find(
    (item) => item.category === category && (item.condition === "poor" || item.condition === "fair"),
  );

  if (weakItem) return `${weakItem.name} is marked ${weakItem.condition}, so this is an upgrade opportunity.`;
  if (category === "monitor") return "No external monitor is listed in the current setup.";
  if (category === "laptop_stand") return "No laptop stand is listed to raise the laptop screen.";
  if (category === "desk_lamp") return "No dedicated desk lamp is listed for task lighting.";
  if (category === "cable_management") return "No cable management is listed for reducing desk clutter.";
  if (category === "storage") return "No storage item is listed for clearing the work surface.";

  return `Missing ${label} from current inventory.`;
}

function createAccumulator(category: ProductCategory, inventory: InventoryItem[]): CategoryAccumulator {
  const missingFromInventory = !hasGoodCategory(inventory, category);
  const weakCategory = hasWeakCategory(inventory, category);
  const baseScore = category === "laptop" ? 4 : missingFromInventory ? 18 : 8;
  const score = baseScore + (weakCategory ? 10 : 0);
  const reasons = [makeMissingReason(category, inventory)];

  return {
    category,
    score,
    reasons,
    problemsAddressed: new Set<UserProblem>(),
    missingFromInventory,
    missingOrUpgradeReason: reasons[0],
  };
}

function addScore(
  scores: Map<ProductCategory, CategoryAccumulator>,
  category: ProductCategory,
  points: number,
  reason: string,
  problems: UserProblem[] = [],
): void {
  const current = scores.get(category);
  if (!current) return;

  current.score += points;
  current.reasons.push(reason);
  problems.forEach((problem) => current.problemsAddressed.add(problem));
}

function applyBudgetRules(scores: Map<ProductCategory, CategoryAccumulator>, profile: UserProfile): void {
  if (!isBudgetLimited(profile)) return;

  for (const category of lowCostHighImpactCategories) {
    addScore(scores, category, 12, "Budget limits favor lower-cost upgrades with fast daily impact.", [
      "budget_limited",
    ]);
  }

  for (const category of expensiveCategories) {
    addScore(scores, category, category === "laptop" ? -24 : -10, "Budget limits make this a later upgrade.", [
      "budget_limited",
    ]);
  }
}

function applyProfessionRules(scores: Map<ProductCategory, CategoryAccumulator>, profile: UserProfile): void {
  if (!isProductivityProfession(profile)) return;

  addScore(scores, "monitor", 14, "This profession benefits from more screen space and easier context switching.");
  addScore(scores, "laptop_stand", 6, "A raised laptop supports longer focused work sessions.");
  addScore(scores, "keyboard", 6, "Input comfort matters for long writing, coding, or design sessions.");
  addScore(scores, "mouse", 6, "Pointing-device comfort matters for long writing, coding, or design sessions.");

  if (normalizeText(profile.profession).includes("designer")) {
    addScore(scores, "desk_lamp", 4, "Design work benefits from more consistent lighting.");
  }
}

function applySmallSpaceRules(scores: Map<ProductCategory, CategoryAccumulator>, profile: UserProfile): void {
  if (!hasSmallSpace(profile)) return;

  addScore(scores, "laptop_stand", 10, "Small spaces benefit from vertical organization.", ["small_space"]);
  addScore(scores, "storage", 16, "Small spaces need storage before adding bulky gear.", ["small_space"]);
  addScore(scores, "cable_management", 14, "Cable management frees usable desk area.", ["small_space"]);
  addScore(scores, "monitor", -14, "Small desk width penalizes large monitor upgrades.", ["small_space"]);
  addScore(scores, "chair", -14, "Small rooms make bulky chair upgrades less practical.", ["small_space"]);
}

export function getCategoryRecommendations(input: RecommendationInput): CategoryRecommendation[] {
  const { profile, inventory } = input;
  const scores = new Map<ProductCategory, CategoryAccumulator>(
    PRODUCT_CATEGORIES.map((category) => [category, createAccumulator(category, inventory)]),
  );

  const usesLaptop = inventory.some(isLaptopLike) || profile.constraints.portableSetup;
  const hasExternalMonitor = inventory.some(isExternalMonitor);
  const hasLaptopStand = hasGoodCategory(inventory, "laptop_stand");
  const hasErgonomicMouse = inventory.some((item) => item.category === "mouse" && isErgonomicInput(item));
  const hasErgonomicKeyboard = inventory.some((item) => item.category === "keyboard" && isErgonomicInput(item));
  const hasErgonomicChair = inventory.some((item) => item.category === "chair" && isErgonomicChair(item));
  const lowRamLaptop = hasLowRamLaptop(inventory);
  const below1080pMonitor = hasBelow1080pMonitor(inventory);
  const loudKeyboard = hasLoudKeyboard(inventory);
  const chairWithoutLumbar = hasChairWithoutLumbar(inventory);
  const hasDeskLamp = hasGoodCategory(inventory, "desk_lamp");
  const productivityProblems = hasAnyProblem(profile, ["slow_computer", "low_productivity", "poor_focus"]);
  const displayProblems = selectedDisplayProblems(profile);

  if ((productivityProblems || hasProblem(profile, "eye_strain")) && !hasExternalMonitor) {
    addScore(scores, "monitor", 14, "No external monitor is available for focused work and visual comfort.", [
      ...displayProblems,
    ]);
  } else if ((productivityProblems || hasProblem(profile, "eye_strain")) && below1080pMonitor) {
    addScore(scores, "monitor", 18, "The current monitor is below 1080p, so a sharper display is a real upgrade.", [
      ...displayProblems,
    ]);
  }

  if (hasProblem(profile, "neck_pain") && usesLaptop) {
    if (!hasExternalMonitor) {
      addScore(scores, "monitor", 34, "Neck pain plus laptop-only screen use makes an external monitor high impact.", [
        "neck_pain",
      ]);
    }

    if (!hasLaptopStand) {
      addScore(scores, "laptop_stand", 42, "A laptop stand raises the screen and directly reduces hunching.", [
        "neck_pain",
      ]);
    }
  }

  if (hasProblem(profile, "eye_strain")) {
    if (!hasExternalMonitor) {
      addScore(scores, "monitor", 30, "Eye strain improves with a larger external display.", ["eye_strain"]);
    }

    if (!hasDeskLamp || hasBadLighting(profile)) {
      addScore(scores, "desk_lamp", 28, "Eye strain plus weak lighting makes task lighting a strong upgrade.", [
        "eye_strain",
        "bad_lighting",
      ]);
    }
  }

  if (hasProblem(profile, "wrist_pain")) {
    if (!hasErgonomicMouse) {
      addScore(scores, "mouse", 42, "Wrist pain and no ergonomic mouse makes pointing comfort a priority.", [
        "wrist_pain",
      ]);

      if (inventory.some((item) => item.category === "mouse")) {
        addScore(scores, "mouse", 18, "The current mouse is present but does not appear ergonomic.", [
          "wrist_pain",
        ]);
      }
    }

    if (!hasErgonomicKeyboard) {
      addScore(scores, "keyboard", 38, "Wrist pain and no ergonomic keyboard makes typing posture a priority.", [
        "wrist_pain",
      ]);
    }
  }

  if (hasProblem(profile, "back_pain") && !hasErgonomicChair) {
    addScore(
      scores,
      "chair",
      chairWithoutLumbar ? 48 : 42,
      chairWithoutLumbar
        ? "The current chair lacks lumbar support, which makes back pain a direct upgrade signal."
        : "Back pain without an ergonomic chair is a direct comfort gap.",
      ["back_pain"],
    );
  }

  if (hasProblem(profile, "slow_computer")) {
    if (lowRamLaptop) {
      addScore(scores, "laptop", 26, "The selected laptop appears to have 8GB RAM or less, matching the slow-computer complaint.", [
        "slow_computer",
      ]);
    }

    if (budgetAllowsLaptop(profile)) {
      addScore(scores, "laptop", 42, "The budget can support replacing the slow computer.", ["slow_computer"]);
    } else if (productivityProblems || isProductivityProfession(profile)) {
      addScore(scores, "monitor", 18, "Budget is tight, so improve productivity around the current computer first.", [
        "slow_computer",
      ]);
      addScore(scores, "laptop_stand", 12, "A stand is a low-cost productivity and posture improvement.", [
        "slow_computer",
      ]);
      addScore(scores, "keyboard", 8, "A better keyboard can improve daily productivity before replacing the laptop.", [
        "slow_computer",
      ]);
      addScore(scores, "mouse", 8, "A better mouse can improve daily productivity before replacing the laptop.", [
        "slow_computer",
      ]);
      addScore(scores, "laptop", -18, "Laptop replacement is deferred because the budget is tight.", [
        "slow_computer",
      ]);
    }
  }

  if (hasAnyProblem(profile, ["poor_focus", "noise_sensitivity"])) {
    const points = hasProblem(profile, "noise_sensitivity") ? 42 : 34;
    addScore(scores, "headphones", points, "Focus or noise sensitivity makes isolation and call audio high impact.", [
      ...(hasProblem(profile, "poor_focus") ? (["poor_focus"] as UserProblem[]) : []),
      ...(hasProblem(profile, "noise_sensitivity") ? (["noise_sensitivity"] as UserProblem[]) : []),
    ]);
  }

  if (hasProblem(profile, "noise_sensitivity") && loudKeyboard) {
    addScore(scores, "keyboard", 36, "The current keyboard appears loud, so a quiet replacement directly fits noise sensitivity.", [
      "noise_sensitivity",
    ]);
  }

  if (isRemoteWorker(profile)) {
    addScore(scores, "headphones", 6, "Shared or remote work increases the value of reliable audio.");
  }

  if (hasProblem(profile, "clutter")) {
    addScore(scores, "storage", 36, "Clutter is best addressed with storage that clears the desk.", ["clutter"]);
    addScore(scores, "cable_management", 34, "Cable management removes visual noise and frees surface area.", [
      "clutter",
    ]);
    addScore(scores, "laptop_stand", 10, "A stand can reclaim desk space by stacking the laptop vertically.", [
      "clutter",
    ]);
  }

  if (hasBadLighting(profile) && !hasDeskLamp) {
    addScore(scores, "desk_lamp", 24, "Bad lighting makes a dedicated desk lamp practical and high impact.", [
      "bad_lighting",
    ]);
  }

  applyBudgetRules(scores, profile);
  applyProfessionRules(scores, profile);
  applySmallSpaceRules(scores, profile);

  return Array.from(scores.values())
    .map((recommendation) => {
      const score = clampScore(recommendation.score);
      const reasons = Array.from(new Set(recommendation.reasons)).slice(0, 5);
      const problemsAddressed = Array.from(recommendation.problemsAddressed);
      const topReason = reasons[1] ?? reasons[0] ?? "it fills a setup gap";

      return {
        category: recommendation.category,
        score,
        priority: priorityForScore(score),
        problemsAddressed,
        missingOrUpgradeReason: recommendation.missingOrUpgradeReason,
        explanation: `${categoryLabels[recommendation.category]} scored ${score}/100 because ${topReason.toLowerCase()}`,
        reasons,
        relatedProblems: problemsAddressed,
        missingFromInventory: recommendation.missingFromInventory,
      };
    })
    .sort((a, b) => b.score - a.score || categoryLabels[a.category].localeCompare(categoryLabels[b.category]));
}

export function rankCategories(profile: UserProfile, inventory: InventoryItem[]): CategoryScore[] {
  return getCategoryRecommendations({ profile, inventory }).map((recommendation) => ({
    category: recommendation.category,
    score: recommendation.score,
    reasons: recommendation.reasons,
  }));
}
