import type { AvailabilitySummary } from "../availability";
import { categoryLabels } from "./scoring";
import type {
  CategoryRecommendation,
  ProductCategory,
  ProductRecommendation,
  ScoreBreakdown,
  UserProblem,
  UserProfile,
} from "./types";

export type RecommendationSort = "highest_impact" | "best_value" | "lowest_cost" | "highest_confidence";

export interface RecommendationFilters {
  underBudgetOnly: boolean;
  availableOnly: boolean;
  quietProductsOnly: boolean;
  smallSpaceFriendlyOnly: boolean;
}

export interface ProductRecommendationView {
  categoryRecommendation: CategoryRecommendation;
  recommendation: ProductRecommendation;
  availability: AvailabilitySummary;
  priority: CategoryRecommendation["priority"];
  saved: boolean;
}

export interface CategoryRecommendationView {
  categoryRecommendation: CategoryRecommendation;
  scoreBreakdown: ScoreBreakdown;
  products: ProductRecommendationView[];
}

export interface LifeGapInsight {
  id: UserProblem;
  label: string;
  score: number;
  priority: CategoryRecommendation["priority"];
  explanation: string;
  topCategories: string[];
}

export interface NotRecommendedInsight {
  category: ProductCategory;
  score: number;
  reason: string;
  tradeoff: string;
}

const expensiveCategories = new Set<ProductCategory>(["laptop", "monitor", "chair"]);

const problemLabels: Record<UserProblem, string> = {
  eye_strain: "Reduce eye strain",
  neck_pain: "Fix posture-driven neck strain",
  wrist_pain: "Lower wrist strain",
  back_pain: "Improve seated comfort",
  slow_computer: "Remove slow-device friction",
  low_productivity: "Improve daily workflow speed",
  poor_focus: "Protect focus time",
  noise_sensitivity: "Reduce noise stress",
  clutter: "Clear desk clutter",
  bad_lighting: "Improve task lighting",
  limited_mobility: "Add easier-to-use gear",
  small_space: "Use space more efficiently",
  budget_limited: "Get more impact per dollar",
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function priorityForScore(score: number): CategoryRecommendation["priority"] {
  if (score >= 80) return "critical";
  if (score >= 65) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export function parseRecommendationSort(value: string | undefined): RecommendationSort {
  if (
    value === "highest_impact" ||
    value === "best_value" ||
    value === "lowest_cost" ||
    value === "highest_confidence"
  ) {
    return value;
  }

  return "highest_impact";
}

export function isSmallSpaceFriendly(
  recommendation: ProductRecommendation,
  profile: UserProfile,
): boolean {
  const requiredWidth = recommendation.product.constraints.minDeskWidthInches;

  if (recommendation.product.category === "chair") return false;
  if (recommendation.product.constraints.portable) return true;
  if (requiredWidth === undefined) return recommendation.product.priceUsd <= profile.budgetUsd * 0.6;

  return requiredWidth <= Math.min(profile.constraints.deskWidthInches, 36);
}

export function isDisplayableProduct(
  recommendation: ProductRecommendation,
  availability: AvailabilitySummary,
): boolean {
  if (availability.status === "unavailable") return false;

  const hasCatalogPrice = recommendation.product.priceUsd > 0
    || (recommendation.product.estimatedPriceCents != null && recommendation.product.estimatedPriceCents > 0)
    || (recommendation.product.typicalUsedPriceCents != null && recommendation.product.typicalUsedPriceCents > 0);
  const hasLivePrice = recommendation.currentBestPriceCents != null && recommendation.currentBestPriceCents > 0;
  if (!hasCatalogPrice && !hasLivePrice) return false;

  return true;
}

export function matchesFilters(
  recommendation: ProductRecommendation,
  availability: AvailabilitySummary,
  filters: RecommendationFilters,
  profile: UserProfile,
): boolean {
  if (!isDisplayableProduct(recommendation, availability)) return false;
  if (filters.underBudgetOnly && recommendation.product.priceUsd > profile.budgetUsd) return false;
  if (filters.availableOnly && availability.status !== "available") return false;
  if (filters.quietProductsOnly && !recommendation.product.constraints.quiet) return false;
  if (filters.smallSpaceFriendlyOnly && !isSmallSpaceFriendly(recommendation, profile)) return false;

  return true;
}

export function sortProductViews(
  products: ProductRecommendationView[],
  sort: RecommendationSort,
): ProductRecommendationView[] {
  return [...products].sort((left, right) => {
    if (sort === "best_value") {
      return (
        right.recommendation.scoreBreakdown.valueFit - left.recommendation.scoreBreakdown.valueFit ||
        right.recommendation.score - left.recommendation.score ||
        left.recommendation.product.priceUsd - right.recommendation.product.priceUsd
      );
    }

    if (sort === "lowest_cost") {
      return (
        left.recommendation.product.priceUsd - right.recommendation.product.priceUsd ||
        right.recommendation.score - left.recommendation.score
      );
    }

    if (sort === "highest_confidence") {
      return (
        right.recommendation.scoreBreakdown.confidence - left.recommendation.scoreBreakdown.confidence ||
        right.recommendation.score - left.recommendation.score
      );
    }

    return (
      right.recommendation.score - left.recommendation.score ||
      left.recommendation.product.priceUsd - right.recommendation.product.priceUsd
    );
  });
}

function categoryMetric(
  category: CategoryRecommendationView,
  sort: RecommendationSort,
): [number, number] {
  const topProduct = category.products[0];

  if (!topProduct) return [category.categoryRecommendation.score, 0];

  if (sort === "best_value") {
    return [
      topProduct.recommendation.scoreBreakdown.valueFit,
      topProduct.recommendation.score,
    ];
  }

  if (sort === "lowest_cost") {
    return [
      -topProduct.recommendation.product.priceUsd,
      category.categoryRecommendation.score,
    ];
  }

  if (sort === "highest_confidence") {
    return [
      topProduct.recommendation.scoreBreakdown.confidence,
      topProduct.recommendation.score,
    ];
  }

  return [category.categoryRecommendation.score, topProduct.recommendation.score];
}

export function sortCategoryViews(
  categories: CategoryRecommendationView[],
  sort: RecommendationSort,
): CategoryRecommendationView[] {
  return [...categories].sort((left, right) => {
    const [leftPrimary, leftSecondary] = categoryMetric(left, sort);
    const [rightPrimary, rightSecondary] = categoryMetric(right, sort);

    return (
      rightPrimary - leftPrimary ||
      rightSecondary - leftSecondary ||
      categoryLabels[left.categoryRecommendation.category].localeCompare(categoryLabels[right.categoryRecommendation.category])
    );
  });
}

export function buildCategoryScoreBreakdown(
  categoryRecommendation: CategoryRecommendation,
  productViews: ProductRecommendationView[],
  profile: UserProfile,
): ScoreBreakdown {
  const leadProduct = productViews[0];
  const problemFit = clampScore(
    categoryRecommendation.score * 0.55 + categoryRecommendation.problemsAddressed.length * 11,
  );
  const constraintFit = clampScore(
    leadProduct?.recommendation.scoreBreakdown.constraintFit ??
      (profile.constraints.deskWidthInches <= 36 && expensiveCategories.has(categoryRecommendation.category) ? 48 : 68),
  );
  const traitDeltaFit = clampScore(
    leadProduct?.recommendation.scoreBreakdown.traitDeltaFit ??
      (categoryRecommendation.missingFromInventory ? 64 : 48),
  );
  const ergonomicFit = clampScore(
    leadProduct?.recommendation.scoreBreakdown.ergonomicFit ??
      (categoryRecommendation.problemsAddressed.some((problem) => ["wrist_pain", "back_pain", "neck_pain"].includes(problem))
        ? 66
        : 58),
  );
  const valueFit = clampScore(
    leadProduct?.recommendation.scoreBreakdown.valueFit ??
      (expensiveCategories.has(categoryRecommendation.category) ? 52 : 74),
  );
  const compatibilityFit = clampScore(
    leadProduct?.recommendation.scoreBreakdown.compatibilityFit ??
      (categoryRecommendation.missingFromInventory ? 78 : 64),
  );
  const availabilityFit = clampScore(
    leadProduct?.recommendation.scoreBreakdown.availabilityFit ??
      (leadProduct?.availability.status === "available" ? 70 : leadProduct?.availability.status === "unavailable" ? 0 : 40),
  );
  const confidence = clampScore(
    leadProduct?.recommendation.scoreBreakdown.confidence ??
      (categoryRecommendation.problemsAddressed.length > 0 ? 76 : 58),
  );

  return {
    problemFit,
    ergonomicFit,
    traitDeltaFit,
    constraintFit,
    valueFit,
    compatibilityFit,
    availabilityFit,
    confidence,
    finalScore: categoryRecommendation.score,
  };
}

export function buildLifeGapInsights(
  profile: UserProfile,
  categories: CategoryRecommendationView[],
): LifeGapInsight[] {
  return profile.problems
    .map((problem) => {
      const relatedCategories = categories.filter((category) =>
        category.categoryRecommendation.problemsAddressed.includes(problem),
      );
      const topCategory = relatedCategories[0];
      const topProduct = relatedCategories[0]?.products[0];
      const score = clampScore(
        (topCategory?.categoryRecommendation.score ?? 0) * 0.58 +
          (topProduct?.recommendation.score ?? 0) * 0.32 +
          relatedCategories.length * 7,
      );

      return {
        id: problem,
        label: problemLabels[problem] ?? problem.replaceAll("_", " "),
        score,
        priority: priorityForScore(score),
        explanation:
          relatedCategories.length > 0
            ? `${problemLabels[problem] ?? problem} shows up across ${relatedCategories
                .slice(0, 2)
                .map((category) => categoryLabels[category.categoryRecommendation.category].toLowerCase())
                .join(" and ")}, making it one of the clearest opportunities to improve next.`
            : "This problem is recorded in the profile, but the current catalog has fewer strong matches for it.",
        topCategories: relatedCategories.slice(0, 3).map((category) => categoryLabels[category.categoryRecommendation.category]),
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

function explainSkippedCategory(
  category: CategoryRecommendationView,
  visibleCategories: Set<ProductCategory>,
  profile: UserProfile,
): NotRecommendedInsight | null {
  if (visibleCategories.has(category.categoryRecommendation.category)) return null;

  if (category.products.length === 0) {
    return {
      category: category.categoryRecommendation.category,
      score: category.categoryRecommendation.score,
      reason: "The active filters removed every suitable model in this category.",
      tradeoff: "Relaxing availability, budget, or quiet-space filters may bring it back into consideration.",
    };
  }

  if (category.categoryRecommendation.score < 45) {
    return {
      category: category.categoryRecommendation.category,
      score: category.categoryRecommendation.score,
      reason: category.categoryRecommendation.reasons[1] ?? "It solved fewer urgent problems than the categories above.",
      tradeoff: "It is still viable later, but it is not the most leveraged next move right now.",
    };
  }

  if (expensiveCategories.has(category.categoryRecommendation.category) && category.products[0].recommendation.product.priceUsd > profile.budgetUsd) {
    return {
      category: category.categoryRecommendation.category,
      score: category.categoryRecommendation.score,
      reason: "The best-fitting options push past the current budget.",
      tradeoff: "Smaller upgrades above are likely to solve more daily friction per dollar first.",
    };
  }

  return {
    category: category.categoryRecommendation.category,
    score: category.categoryRecommendation.score,
    reason: category.categoryRecommendation.reasons[0] ?? "The fit is decent, but not as urgent as the categories above.",
    tradeoff: "It was intentionally deprioritized so the first recommendations stay focused and practical.",
  };
}

export function buildNotRecommendedInsights(
  categories: CategoryRecommendationView[],
  visibleCategories: Set<ProductCategory>,
  profile: UserProfile,
): NotRecommendedInsight[] {
  return categories
    .map((category) => explainSkippedCategory(category, visibleCategories, profile))
    .filter((value): value is NotRecommendedInsight => value !== null)
    .sort((left, right) => left.score - right.score)
    .slice(0, 4);
}
