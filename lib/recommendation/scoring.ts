import type {
  CategoryScore,
  InventoryItem,
  Product,
  ProductCategory,
  Problem,
  UserProfile,
} from "./types";
import { PRODUCT_CATEGORIES } from "./types";
import {
  normalizeChairSpecs,
  normalizeKeyboardSpecs,
  normalizeLaptopSpecs,
  normalizeMonitorSpecs,
  normalizeMouseSpecs,
} from "../catalog/specNormalizer";

export const categoryLabels: Record<ProductCategory, string> = {
  laptop: "Laptop",
  monitor: "Monitor",
  laptop_stand: "Laptop stand",
  keyboard: "Keyboard",
  mouse: "Mouse",
  chair: "Chair",
  desk_lamp: "Desk lamp",
  headphones: "Headphones",
  webcam: "Webcam",
  storage: "Storage",
  cable_management: "Cable management",
};

const problemCategoryWeights: Record<Problem, Partial<Record<ProductCategory, number>>> = {
  eye_strain: { monitor: 26, desk_lamp: 22 },
  neck_pain: { monitor: 28, laptop_stand: 34, chair: 12 },
  wrist_pain: { keyboard: 24, mouse: 24, laptop_stand: 8 },
  back_pain: { chair: 34, laptop_stand: 10 },
  slow_computer: { laptop: 36, storage: 10, monitor: 6 },
  low_productivity: { monitor: 18, keyboard: 10, mouse: 10, webcam: 16, storage: 8 },
  poor_focus: { headphones: 28, monitor: 12, desk_lamp: 8 },
  noise_sensitivity: { headphones: 34, keyboard: 6, mouse: 4 },
  clutter: { storage: 28, cable_management: 28, laptop_stand: 18, keyboard: 8, mouse: 8, desk_lamp: 6 },
  bad_lighting: { desk_lamp: 34, webcam: 10, monitor: 6 },
  limited_mobility: { chair: 18, mouse: 12, keyboard: 10, laptop_stand: 8 },
  small_space: { laptop_stand: 16, storage: 14, cable_management: 14, desk_lamp: 12, headphones: 6 },
  budget_limited: { desk_lamp: 8, mouse: 8, keyboard: 8, laptop_stand: 8, cable_management: 8 },
};

const productCategorySet = new Set<ProductCategory>(PRODUCT_CATEGORIES);

function productPriceUsd(product: Product): number {
  return product.priceUsd;
}

function requiredDeskWidth(product: Product): number {
  return product.constraints.minDeskWidthInches ?? 0;
}

function isPortableProduct(product: Product): boolean {
  return Boolean(product.constraints.portable);
}

function isQuietProduct(product: Product): boolean {
  return Boolean(product.constraints.quiet);
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

function itemHasCatalogRatings(item: InventoryItem): boolean {
  if (item.source === "bestbuy" || item.source === "custom" || item.hasCatalogRatings === false) return false;
  return true;
}

function hasExternalMonitor(inventory: InventoryItem[]): boolean {
  return inventory.some((item) => item.category === "monitor" && !item.name.toLowerCase().includes("built-in"));
}

function hasLowRamLaptop(inventory: InventoryItem[]): boolean {
  return inventory.some(
    (item) =>
      itemHasCatalogRatings(item) &&
      item.category === "laptop" &&
      (normalizeLaptopSpecs(itemSpecRaw(item)).ramGb ?? Number.POSITIVE_INFINITY) <= 8,
  );
}

function hasBelow1080pMonitor(inventory: InventoryItem[]): boolean {
  return inventory.some(
    (item) =>
      itemHasCatalogRatings(item) &&
      item.category === "monitor" &&
      normalizeMonitorSpecs(itemSpecRaw(item)).resolutionClass === "below_1080p",
  );
}

function hasNonErgonomicMouse(inventory: InventoryItem[]): boolean {
  return inventory.some(
    (item) => itemHasCatalogRatings(item) && item.category === "mouse" && normalizeMouseSpecs(itemSpecRaw(item)).ergonomic !== true,
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

function hasDisplayProblem(profile: UserProfile): boolean {
  return profile.problems.some((problem) =>
    ["eye_strain", "low_productivity", "poor_focus", "slow_computer", "neck_pain"].includes(problem),
  );
}

export function ownedCategories(inventory: InventoryItem[]): Set<ProductCategory> {
  return new Set(
    inventory
      .map((item) => item.category)
      .filter((category): category is ProductCategory => productCategorySet.has(category as ProductCategory)),
  );
}

export function scoreCategory(
  category: ProductCategory,
  profile: UserProfile,
  inventory: InventoryItem[],
): CategoryScore {
  const owned = ownedCategories(inventory);
  const reasons: string[] = [];
  let score = owned.has(category) ? 12 : 26;

  if (!owned.has(category)) {
    reasons.push(`Missing ${categoryLabels[category].toLowerCase()} from current inventory.`);
  }

  for (const problem of profile.problems) {
    const weight = problemCategoryWeights[problem][category] ?? 0;
    if (weight > 0) {
      score += weight;
      reasons.push(`Directly addresses ${problem.replace(/_/g, " ")}.`);
    }
  }

  const weakOwnedItem = inventory.find(
    (item) => item.category === category && (item.condition === "poor" || item.condition === "fair"),
  );
  if (weakOwnedItem) {
    score += weakOwnedItem.condition === "poor" ? 22 : 12;
    reasons.push(`${weakOwnedItem.name} is marked ${weakOwnedItem.condition}.`);
  }

  if (category === "laptop" && profile.problems.includes("slow_computer") && hasLowRamLaptop(inventory)) {
    score += 22;
    reasons.push("Selected laptop specs show 8GB RAM or less.");
  }

  if (category === "monitor" && hasDisplayProblem(profile)) {
    if (!hasExternalMonitor(inventory)) {
      score += 12;
      reasons.push("No external monitor is available for visual workspace.");
    } else if (hasBelow1080pMonitor(inventory)) {
      score += 18;
      reasons.push("Current monitor resolution is below 1080p.");
    }
  }

  if (category === "mouse" && profile.problems.includes("wrist_pain") && hasNonErgonomicMouse(inventory)) {
    score += 20;
    reasons.push("Current mouse specs do not show ergonomic support.");
  }

  if (category === "keyboard" && profile.problems.includes("noise_sensitivity") && hasLoudKeyboard(inventory)) {
    score += 26;
    reasons.push("Current keyboard appears loud for a noise-sensitive setup.");
  }

  if (category === "chair" && profile.problems.includes("back_pain") && hasChairWithoutLumbar(inventory)) {
    score += 26;
    reasons.push("Current chair lacks lumbar support.");
  }

  if (profile.constraints.portableSetup && category === "laptop_stand") {
    score += 8;
    reasons.push("Portable setup benefits from a compact ergonomic lift.");
  }

  if (profile.constraints.sharesSpace && category === "headphones") {
    score += 10;
    reasons.push("Shared space makes call clarity and noise control more valuable.");
  }

  return {
    category,
    score: Math.min(Math.round(score), 100),
    reasons: reasons.slice(0, 4),
  };
}

export function rankCategories(profile: UserProfile, inventory: InventoryItem[]): CategoryScore[] {
  return PRODUCT_CATEGORIES.map((category) => scoreCategory(category, profile, inventory)).sort(
    (a, b) => b.score - a.score,
  );
}

export function scoreProduct(
  product: Product,
  categoryScore: CategoryScore,
  profile: UserProfile,
  inventory: InventoryItem[],
): number {
  let score = categoryScore.score * 0.55;

  const solvedProblems = profile.problems.filter((problem) => product.solves.includes(problem));
  score += solvedProblems.length * 9;

  score += product.scoreHints.comfort * 0.9;
  score += product.scoreHints.productivity * 0.8;
  score += product.scoreHints.accessibility * 0.7;
  score += product.scoreHints.value * 0.8;

  // Budget fit is intentionally smooth so a slightly expensive product can still win
  // when it solves several acute problems.
  const budgetShare = productPriceUsd(product) / Math.max(profile.budgetUsd, 1);
  if (budgetShare <= 0.35) score += 14;
  else if (budgetShare <= 0.65) score += 8;
  else if (budgetShare <= 1) score += 2;
  else score -= 18;

  if (profile.constraints.deskWidthInches < requiredDeskWidth(product)) {
    score -= 28;
  }

  if (profile.constraints.portableSetup && isPortableProduct(product)) {
    score += 8;
  }

  if (profile.constraints.sharesSpace && isQuietProduct(product)) {
    score += 6;
  }

  const replacingPoorItem = inventory.some(
    (item) => item.category === product.category && item.condition === "poor",
  );
  if (replacingPoorItem) score += 10;

  return Math.max(0, Math.min(Math.round(score), 100));
}

export function scoreToFit(score: number): "excellent" | "strong" | "situational" {
  if (score >= 82) return "excellent";
  if (score >= 66) return "strong";
  return "situational";
}
