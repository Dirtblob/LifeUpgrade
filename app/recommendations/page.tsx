import Link from "next/link";
import { DeviceDeltaComparison } from "@/components/DeviceDeltaComparison";
import { LivePricePanel } from "@/components/LivePricePanel";
import { ScoreBadge } from "@/components/ScoreBadge";
import { ActionButton } from "@/components/ui/ActionButton";
import { buildLivePriceCardState } from "@/lib/availability/livePrice";
import { ScoreBreakdownCard } from "@/components/ui/ScoreBreakdownCard";
import { buildRecommendationNarrationId } from "@/lib/llm/explanationCache";
import type { RecommendationNarrationSource } from "@/lib/llm/types";
import { readCachedRecommendationNarrations } from "@/lib/llm/recommendationNarrator";
import {
  buildHackathonDemoPriorityList,
  HACKATHON_DEMO_EXPLANATION,
  HACKATHON_DEMO_SCENARIO_ID,
} from "@/lib/recommendation/demoMode";
import { buildRecommendationRejections } from "@/lib/recommendation/rejections";
import {
  buildCategoryScoreBreakdown,
  buildLifeGapInsights,
  matchesFilters,
  parseRecommendationSort,
  priorityForScore,
  sortCategoryViews,
  sortProductViews,
  type RecommendationFilters,
  type RecommendationSort,
} from "@/lib/recommendation/dashboard";
import { getCategoryRecommendations } from "@/lib/recommendation/categoryEngine";
import { getProductRecommendations } from "@/lib/recommendation/productEngine";
import { categoryLabels } from "@/lib/recommendation/scoring";
import { formatUsd } from "@/lib/ui/format";
import { getAvailabilityForProduct, loadRecommendationContext } from "@/lib/userData";
import { refreshRecommendationExplanation, toggleSavedProduct } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const sortOptions: Array<{ value: RecommendationSort; label: string }> = [
  { value: "highest_impact", label: "Highest impact" },
  { value: "best_value", label: "Best value" },
  { value: "lowest_cost", label: "Lowest cost" },
  { value: "highest_confidence", label: "Highest confidence" },
];

const filterOptions: Array<{ key: keyof RecommendationFilters; label: string }> = [
  { key: "underBudgetOnly", label: "Under budget only" },
  { key: "availableOnly", label: "Available only" },
  { key: "quietProductsOnly", label: "Quiet products only" },
  { key: "smallSpaceFriendlyOnly", label: "Small-space friendly" },
];

function getFirstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isEnabled(value: string | undefined): boolean {
  return value === "1";
}

function buildHref(
  current: Record<string, string | string[] | undefined>,
  next: Partial<Record<string, string | undefined>>,
): string {
  const params = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(current)) {
    const value = getFirstValue(rawValue);
    if (value) params.set(key, value);
  }

  for (const [key, value] of Object.entries(next)) {
    if (!value || value === "0") params.delete(key);
    else params.set(key, value);
  }

  const query = params.toString();
  return query ? `/recommendations?${query}` : "/recommendations";
}

function formatPriority(priority: string): string {
  return priority.replace(/_/g, " ");
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function scoreTone(score: number): string {
  if (score >= 80) return "bg-emerald-500/85 text-white";
  if (score >= 60) return "bg-amber-300 text-slate-900";
  return "bg-rose-500/85 text-white";
}

function pillTone(enabled: boolean): string {
  return enabled
    ? "border border-cyan-300/45 bg-cyan-400/18 text-cyan-100 shadow-[0_12px_30px_rgba(45,212,191,0.18)]"
    : "border border-white/10 bg-white/5 text-slate-300 hover:border-cyan-300/35 hover:text-cyan-100";
}

function availabilityTone(status: string): string {
  if (status === "available") return "bg-emerald-500/20 text-emerald-100";
  if (status === "checking_not_configured") return "bg-white/10 text-slate-300";
  return "bg-rose-500/20 text-rose-100";
}

function priorityTone(priority: string): string {
  if (priority === "critical") return "bg-rose-500/85 text-white";
  if (priority === "high") return "bg-amber-300 text-slate-900";
  if (priority === "medium") return "bg-emerald-500/85 text-white";
  return "bg-white/10 text-slate-300";
}

function narratorSourceLabel(source: RecommendationNarrationSource | null | undefined): string {
  return source === "gemma" ? "Gemma" : "deterministic fallback";
}

export default async function RecommendationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const sort = parseRecommendationSort(getFirstValue(params.sort));
  const filters: RecommendationFilters = {
    underBudgetOnly: isEnabled(getFirstValue(params.under_budget)),
    availableOnly: isEnabled(getFirstValue(params.available_only)),
    quietProductsOnly: isEnabled(getFirstValue(params.quiet_only)),
    smallSpaceFriendlyOnly: isEnabled(getFirstValue(params.small_space)),
  };
  const context = await loadRecommendationContext();

  if (!context) {
    return (
      <div className="rounded-[2rem] border border-dashed border-ink/15 bg-white/85 p-10 text-center shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-clay">Recommendations</p>
        <h1 className="mt-3 font-display text-3xl font-semibold">Create a profile before scoring upgrades.</h1>
        <p className="mx-auto mt-4 max-w-2xl leading-7 text-ink/65">
          Recommendations need your onboarding profile first, then this page can rank upgrade opportunities,
          recommended categories, and specific models to consider.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/onboarding" className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">
            Complete onboarding
          </Link>
          <Link href="/inventory" className="rounded-full border border-ink/10 px-5 py-3 text-sm font-semibold text-ink">
            Open inventory
          </Link>
        </div>
      </div>
    );
  }

  const {
    profileId,
    profile,
    inventory,
    availabilityByProductId,
    demoScenarioId,
    exactCurrentModelsProvided,
    savedProductIds,
    usedItemsOkay,
    ports,
    deviceType,
    privateProfile,
    pricingByProductId,
    candidateProducts,
  } = context;
  const recommendationInput = {
    profile,
    inventory,
    candidateProducts,
    privateProfile,
    exactCurrentModelsProvided,
    ports,
    deviceType,
    usedItemsOkay,
    availabilityByProductId,
    pricingByProductId,
  };
  const demoPriorityList =
    demoScenarioId === HACKATHON_DEMO_SCENARIO_ID ? buildHackathonDemoPriorityList(recommendationInput) : [];
  const categoryRecommendations = getCategoryRecommendations(recommendationInput);
  const productsByCategory = categoryRecommendations.map((categoryRecommendation) => ({
    categoryRecommendation,
    recommendations: getProductRecommendations(recommendationInput, categoryRecommendation, candidateProducts),
  }));
  const categoryViews = sortCategoryViews(
    productsByCategory.map(({ categoryRecommendation, recommendations }) => {
      const rawProducts = recommendations.map((recommendation) => {
        const availability = getAvailabilityForProduct(availabilityByProductId, recommendation.product.id);
        return {
          categoryRecommendation,
          recommendation,
          availability,
          priority: priorityForScore(recommendation.score),
          saved: savedProductIds.has(recommendation.product.id),
        };
      });
      const filteredProducts = sortProductViews(
        rawProducts.filter((productView) =>
          matchesFilters(productView.recommendation, productView.availability, filters, profile),
        ),
        sort,
      );

      return {
        categoryRecommendation,
        scoreBreakdown: buildCategoryScoreBreakdown(categoryRecommendation, filteredProducts, profile),
        products: filteredProducts,
      };
    }),
    sort,
  );

  const visibleCategoryViews = categoryViews.filter((categoryView) => categoryView.products.length > 0).slice(0, 4);
  const visibleCategoryIds = new Set(visibleCategoryViews.map((categoryView) => categoryView.categoryRecommendation.category));
  const lifeGaps = buildLifeGapInsights(profile, categoryViews);
  const visibleProductViews = visibleCategoryViews.flatMap((categoryView) =>
    categoryView.products.slice(0, 3).map((productView) => ({
      categoryRecommendation: categoryView.categoryRecommendation,
      productView,
    })),
  );
  const narratedRecommendations = await readCachedRecommendationNarrations(
    visibleProductViews.map(({ categoryRecommendation, productView }) => ({
      recommendationId: buildRecommendationNarrationId(profileId, categoryRecommendation.category),
      profile,
      inventory,
      exactCurrentModelsProvided,
      categoryRecommendation,
      productRecommendation: productView.recommendation,
      availability: productView.availability,
    })),
  );
  const narratorMode = narratedRecommendations.some((entry) => entry.source === "gemma" && entry.cacheStatus === "hit")
    ? "Cached Gemma explanations active"
    : "Deterministic fallback active";
  const narrationByProductId = new Map(
    narratedRecommendations.map((entry) => [entry.input.productRecommendation.id, entry]),
  );
  const visibleProductIds = new Set(
    visibleCategoryViews.flatMap((categoryView) =>
      categoryView.products.slice(0, 3).map((productView) => productView.recommendation.product.id),
    ),
  );
  const rejections = buildRecommendationRejections(recommendationInput, {
    recommendedCategoryIds: visibleCategoryIds,
    recommendedProductIds: visibleProductIds,
    maxItems: 4,
  });
  const heroProduct = visibleCategoryViews[0]?.products[0];
  const heroNarration = heroProduct ? narrationByProductId.get(heroProduct.recommendation.product.id) : null;
  const topProductCount = visibleCategoryViews.reduce(
    (total, categoryView) => total + Math.min(categoryView.products.length, 3),
    0,
  );
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="space-y-8">
      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="overflow-hidden rounded-[2rem] border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(2,6,23,0.98)_0%,rgba(8,47,73,0.94)_46%,rgba(6,78,59,0.9)_100%)] text-white shadow-[0_30px_90px_rgba(2,6,23,0.6)]">
          <div className="bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.26),transparent_19rem),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.24),transparent_22rem)] p-8 md:p-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
                Recommendations dashboard
              </span>
              <span className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200/80">
                {sortOptions.find((option) => option.value === sort)?.label}
              </span>
            </div>

            <div className="mt-6 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <p className="text-sm font-medium text-slate-200/80">
                  Built from the active profile, current inventory, and deterministic category + product scoring.
                </p>
                <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold tracking-tight md:text-5xl">
                  Upgrade opportunities for {profile.name}
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-slate-200/88">
                  {profile.profession} profile, {formatUsd(profile.budgetUsd)} budget, {inventory.length} inventory items, and{" "}
                  {profile.problems.length} reported pain points. Filters refine what shows up without hiding why the
                  engine scored things the way it did.
                </p>

                {heroProduct ? (
                  <div className="mt-6 rounded-[1.6rem] border border-white/15 bg-white/10 p-5 backdrop-blur">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">Top next move</p>
                    <div className="mt-3 flex items-start justify-between gap-4">
                      <div>
                        <h2 className="font-display text-2xl font-semibold">{heroProduct.recommendation.product.name}</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-200/88">
                          {heroNarration?.output.explanation ?? heroProduct.recommendation.explanation.problemSolved}
                        </p>
                        {heroNarration ? (
                          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300/75">
                            Explanation source: {narratorSourceLabel(heroNarration.source)}
                          </p>
                        ) : null}
                      </div>
                      <ScoreBadge score={heroProduct.recommendation.score} size="lg" />
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 rounded-[1.6rem] border border-white/15 bg-white/10 p-5 text-sm leading-6 text-slate-200/85 backdrop-blur">
                    No products are visible right now. Loosen the active filters to reveal specific models again.
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Budget", formatUsd(profile.budgetUsd)],
                  ["Top categories", String(visibleCategoryViews.length)],
                  ["Specific models", String(topProductCount)],
                  ["Active filters", String(activeFilterCount)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-3xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300/80">{label}</p>
                    <p className="mt-3 font-display text-3xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <aside className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-6 shadow-[0_24px_70px_rgba(2,6,23,0.55)] backdrop-blur-xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Sort and filter</p>
          <h2 className="mt-3 font-display text-2xl font-semibold text-white">Tune the ranking view</h2>
          <p className="mt-3 leading-7 text-slate-300">
            Sort changes how categories and models are ordered. Filters hide options that do not fit the moment.
          </p>

          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Sort by</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {sortOptions.map((option) => (
                <Link
                  key={option.value}
                  href={buildHref(params, { sort: option.value })}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${pillTone(sort === option.value)}`}
                >
                  {option.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Filters</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {filterOptions.map((option) => {
                const paramKey =
                  option.key === "underBudgetOnly"
                    ? "under_budget"
                    : option.key === "availableOnly"
                      ? "available_only"
                      : option.key === "quietProductsOnly"
                        ? "quiet_only"
                        : "small_space";
                const enabled = filters[option.key];

                return (
                  <Link
                    key={option.key}
                    href={buildHref(params, { [paramKey]: enabled ? undefined : "1" })}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${pillTone(enabled)}`}
                  >
                    {option.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Current setup</p>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              {profile.constraints.deskWidthInches}&quot; desk width, {profile.constraints.roomLighting} room lighting,
              {profile.constraints.sharesSpace ? " shared room" : " private room"}, and{" "}
              {profile.constraints.portableSetup ? "portable setup" : "mostly fixed desk"}.
            </p>
          </div>

          <div className="mt-4 rounded-3xl border border-cyan-300/25 bg-cyan-500/8 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">Narrator guardrail</p>
            <p className="mt-3 text-sm leading-7 text-slate-200">
              {narratorMode}. Page renders only read cached explanations or deterministic fallback copy. Gemini is
              called only when you generate or refresh an explanation, and it never changes category scores, product
              scores, ranking order, or budget logic.
            </p>
          </div>
        </aside>
      </section>

      {demoPriorityList.length > 0 ? (
        <section className="rounded-[2rem] border border-gold/30 bg-gold/10 p-6 shadow-panel">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-clay">Demo mode</p>
              <h2 className="mt-2 font-display text-3xl font-semibold">Laptop-only student priority stack</h2>
            </div>
            <p className="max-w-3xl text-sm leading-7 text-ink/68">{HACKATHON_DEMO_EXPLANATION}</p>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-5">
            {demoPriorityList.map((item) => (
              <article key={item.category} className="rounded-[1.5rem] border border-white/70 bg-white/90 p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-clay">{item.rank}</p>
                <h3 className="mt-3 font-display text-xl font-semibold">{categoryLabels[item.category]}</h3>
                <p className="mt-2 text-sm font-medium text-ink/58">
                  {item.recommendation?.product.name ?? "Upgrade later"}
                </p>
                <p className="mt-3 text-sm leading-6 text-ink/65">
                  {item.recommendation?.explanation.problemSolved ??
                    "Only then does a full laptop replacement become worth the bigger spend."}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/80">1</p>
            <h2 className="mt-2 font-display text-3xl font-semibold text-white">Your biggest upgrade opportunities</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            These are the strongest life gaps based on the current problems, constraints, and the categories that can
            relieve them most directly.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {lifeGaps.map((gap) => (
            <article key={gap.id} className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6 shadow-[0_24px_65px_rgba(2,6,23,0.55)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${priorityTone(gap.priority)}`}>
                    {formatPriority(gap.priority)}
                  </span>
                  <h3 className="mt-4 font-display text-2xl font-semibold text-white">{gap.label}</h3>
                </div>
                <ScoreBadge score={gap.score} />
              </div>
              <p className="mt-4 leading-7 text-slate-300">{gap.explanation}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {gap.topCategories.map((label) => (
                  <span key={label} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300">
                    {label}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/80">2</p>
            <h2 className="mt-2 font-display text-3xl font-semibold text-white">Recommended categories</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            Category cards explain why a type of upgrade is important before picking specific models.
          </p>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          {visibleCategoryViews.map((categoryView) => (
            <article
              key={categoryView.categoryRecommendation.category}
              className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6 shadow-[0_24px_65px_rgba(2,6,23,0.55)] backdrop-blur-xl"
            >
              <div className="flex items-start justify-between gap-5">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${priorityTone(categoryView.categoryRecommendation.priority)}`}>
                      {formatPriority(categoryView.categoryRecommendation.priority)} priority
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                      {categoryLabels[categoryView.categoryRecommendation.category]}
                    </span>
                  </div>
                  <h3 className="mt-4 font-display text-2xl font-semibold text-white">
                    {categoryLabels[categoryView.categoryRecommendation.category]}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {categoryView.categoryRecommendation.missingOrUpgradeReason}
                  </p>
                </div>
                <ScoreBadge score={categoryView.categoryRecommendation.score} />
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <DetailBlock
                  label="Problems solved"
                  value={
                    categoryView.categoryRecommendation.problemsAddressed.length > 0
                      ? categoryView.categoryRecommendation.problemsAddressed.map(humanize).join(", ")
                      : "Primarily fills a setup gap."
                  }
                />
                <DetailBlock label="Confidence" value={`${categoryView.scoreBreakdown.confidence}/100`} />
                <DetailBlock label="Explanation" value={categoryView.categoryRecommendation.explanation} />
                <DetailBlock
                  label="Tradeoffs"
                  value={categoryView.products[0]?.recommendation.tradeoffs[0] ?? "The category is strong, but the best product still needs fit and price checks."}
                />
              </div>

              <div className="mt-5">
                <ScoreBreakdownCard breakdown={categoryView.scoreBreakdown} />
              </div>

              <details className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-slate-100">Why this?</summary>
                <div className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                  {categoryView.categoryRecommendation.reasons.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                </div>
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/80">3</p>
            <h2 className="mt-2 font-display text-3xl font-semibold text-white">Specific models to consider</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            Each category runs through the product recommendation engine so the models below inherit the same profile,
            budget, and constraint context.
          </p>
        </div>

        {visibleCategoryViews.length === 0 ? (
          <div className="rounded-[1.75rem] border border-dashed border-ink/15 bg-white/80 p-8 text-center shadow-panel">
            <h3 className="font-display text-2xl font-semibold">No models match the current filter set.</h3>
            <p className="mx-auto mt-3 max-w-2xl leading-7 text-ink/65">
              The category engine still ran, but the active filters removed every product candidate. Loosen one or two
              filters to see specific model recommendations again.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {visibleCategoryViews.map((categoryView) => (
              <section
                key={categoryView.categoryRecommendation.category}
                className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6 shadow-[0_24px_65px_rgba(2,6,23,0.55)] backdrop-blur-xl"
              >
                <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/80">
                      {categoryLabels[categoryView.categoryRecommendation.category]}
                    </p>
                    <h3 className="mt-2 font-display text-2xl font-semibold text-white">
                      Best models for {categoryLabels[categoryView.categoryRecommendation.category].toLowerCase()}
                    </h3>
                  </div>
                  <span className={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${scoreTone(categoryView.categoryRecommendation.score)}`}>
                    Category score {categoryView.categoryRecommendation.score}
                  </span>
                </div>

                <div className="mt-6 grid gap-5 xl:grid-cols-2">
                  {categoryView.products.slice(0, 3).map((productView) => {
                    const catalogCents = productView.recommendation.product.priceUsd > 0
                      ? Math.round(productView.recommendation.product.priceUsd * 100)
                      : null;
                    const livePriceState = buildLivePriceCardState(
                      productView.availability,
                      catalogCents,
                    );
                    const narration = narrationByProductId.get(productView.recommendation.product.id);
                    const narrationOutput = narration?.output;
                    const explanationActionLabel =
                      narration?.source === "gemma"
                        ? "Refresh explanation"
                        : narration?.cacheStatus === "hit"
                          ? "Retry Gemma explanation"
                          : "Generate explanation";

                    return (
                      <article
                        key={productView.recommendation.product.id}
                        className="flex h-full flex-col rounded-[1.5rem] border border-white/10 bg-white/5 p-5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex flex-wrap gap-2">
                              <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${priorityTone(productView.priority)}`}>
                                {formatPriority(productView.priority)} priority
                              </span>
                              <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${availabilityTone(productView.availability.status)}`}>
                                {productView.availability.label}
                              </span>
                            </div>
                            <h4 className="mt-4 font-display text-2xl font-semibold text-white">
                              {productView.recommendation.product.name}
                            </h4>
                            {narrationOutput ? (
                              <p className="mt-2 text-sm font-semibold text-cyan-200">{narrationOutput.headline}</p>
                            ) : null}
                            <p className="mt-2 text-sm font-medium text-slate-300">
                              {productView.recommendation.product.brand} · {categoryLabels[productView.recommendation.product.category]} ·{" "}
                              {productView.recommendation.product.priceUsd > 0 ? formatUsd(productView.recommendation.product.priceUsd) : "Price TBD"}
                            </p>
                          </div>
                          <ScoreBadge score={productView.recommendation.score} />
                        </div>

                        <div className="mt-5">
                          <LivePricePanel
                            deviceCatalogId={productView.recommendation.product.catalogDeviceId ?? productView.recommendation.product.id}
                            slug={productView.recommendation.product.catalogDeviceId ?? productView.recommendation.product.id}
                            initialState={livePriceState}
                          />
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          <DetailBlock
                            label="Problems solved"
                            value={productView.recommendation.product.solves.map(humanize).join(", ")}
                          />
                          <DetailBlock
                            label="Final recommendation score"
                            value={`${productView.recommendation.finalRecommendationScore}/100`}
                          />
                          <DetailBlock
                            label="Fit score"
                            value={`${productView.recommendation.fitScore}/100`}
                          />
                          <DetailBlock
                            label="Trait delta score"
                            value={`${productView.recommendation.traitDeltaScore}/100`}
                          />
                          <DetailBlock
                            label="Confidence"
                            value={
                              narrationOutput?.confidenceNote ??
                              `${productView.recommendation.confidenceLevel} (${productView.recommendation.scoreBreakdown.confidence}/100)`
                            }
                          />
                          <DetailBlock
                            label="Profile fields used"
                            value={
                              productView.recommendation.profileFieldsUsed.length
                                ? productView.recommendation.profileFieldsUsed.join(", ")
                                : "No private profile fields used."
                            }
                          />
                          <DetailBlock
                            label="Missing device specs"
                            value={
                              productView.recommendation.missingDeviceSpecs.length
                                ? productView.recommendation.missingDeviceSpecs.join(", ")
                                : "No fit-critical device specs missing."
                            }
                          />
                          <DetailBlock
                            label="Explanation"
                            value={narrationOutput?.explanation ?? productView.recommendation.explanation.whyThisModel}
                          />
                          {productView.recommendation.deviceDelta?.explanationFacts[0] ? (
                            <DetailBlock
                              label="Why this is better"
                              value={productView.recommendation.deviceDelta.explanationFacts[0]}
                            />
                          ) : null}
                          <DetailBlock
                            label="Tradeoffs"
                            value={narrationOutput?.tradeoffs ?? productView.recommendation.tradeoffs.join(" ")}
                          />
                        </div>

                        <div className="mt-5">
                          <ScoreBreakdownCard breakdown={productView.recommendation.scoreBreakdown} />
                        </div>

                        <DeviceDeltaComparison delta={productView.recommendation.deviceDelta} />

                        {narrationOutput ? (
                          <div className="mt-5 rounded-3xl border border-cyan-300/20 bg-cyan-500/8 p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100">
                              Narrator layer: {narratorSourceLabel(narration?.source)}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-slate-200">{narrationOutput.whyThisHelps}</p>
                          </div>
                        ) : null}

                        <div className="mt-5 flex flex-wrap items-center gap-3">
                          <form action={refreshRecommendationExplanation}>
                            <input type="hidden" name="productId" value={productView.recommendation.product.id} />
                            <input type="hidden" name="returnTo" value={buildHref(params, {})} />
                            <ActionButton pendingText="Generating..." variant="secondary" className="px-4 py-2">
                              {explanationActionLabel}
                            </ActionButton>
                          </form>
                          <form action={toggleSavedProduct}>
                            <input type="hidden" name="profileId" value={profileId} />
                            <input type="hidden" name="productId" value={productView.recommendation.product.id} />
                            <input type="hidden" name="returnTo" value={buildHref(params, {})} />
                            <ActionButton
                              pendingText="Updating..."
                              variant={productView.saved ? "success" : "primary"}
                              className="px-4 py-2"
                            >
                              {productView.saved ? "Watching item" : "Save / watch this item"}
                            </ActionButton>
                          </form>
                          <Link
                            href={`/products/${productView.recommendation.product.id}`}
                            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/35 hover:text-cyan-100"
                          >
                            View details
                          </Link>
                        </div>

                        <details className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-4">
                          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-100">Why this?</summary>
                          <div className="mt-3 space-y-3 text-sm leading-6 text-slate-300">
                            <p>{narrationOutput?.explanation ?? productView.recommendation.explanation.problemSolved}</p>
                            <p>{narrationOutput?.whyThisHelps ?? productView.recommendation.explanation.whyNow}</p>
                            <p>{narrationOutput?.tradeoffs ?? productView.recommendation.explanation.tradeoff}</p>
                            <p>{narrationOutput?.whyNotCheaper ?? productView.recommendation.whyNotCheaper}</p>
                            <p>{narrationOutput?.whyNotMoreExpensive ?? productView.recommendation.whyNotMoreExpensive}</p>
                            {narrationOutput?.followUpQuestion ? <p>{narrationOutput.followUpQuestion}</p> : null}
                          </div>
                        </details>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/80">4</p>
            <h2 className="mt-2 font-display text-3xl font-semibold text-white">What we intentionally did not recommend</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            This keeps the dashboard explainable by showing where the engine deliberately held back.
          </p>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          {rejections.map((item) => (
            <article key={item.id} className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6 shadow-[0_24px_65px_rgba(2,6,23,0.55)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/80">
                    {item.kind === "model" ? "Model held back" : "Category deprioritized"}
                  </p>
                  <h3 className="mt-3 font-display text-2xl font-semibold text-white">{item.item}</h3>
                  <p className="mt-2 text-sm font-medium text-slate-400">{categoryLabels[item.category]}</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                  {item.kind}
                </span>
              </div>
              <div className="mt-5 grid gap-3">
                <DetailBlock label="Reason" value={item.reason} />
                <DetailBlock label="Would recommend if" value={item.wouldRecommendIf} />
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.08)]">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-2 text-sm leading-6 text-slate-300">{value}</p>
    </div>
  );
}
