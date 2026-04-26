import Link from "next/link";
import type { AvailabilitySummary } from "@/lib/availability";
import { buildLivePriceCardState } from "@/lib/availability/livePrice";
import type { LLMRecommendationOutput, RecommendationNarrationSource } from "@/lib/llm/types";
import { categoryLabels } from "@/lib/recommendation/scoring";
import type { ProductRecommendation } from "@/lib/recommendation/types";
import { formatUsd, formatUsdFromCents } from "@/lib/ui/format";
import { DeviceDeltaComparison } from "./DeviceDeltaComparison";
import { LivePricePanel } from "./LivePricePanel";
import { ScoreBadge } from "./ScoreBadge";

interface RecommendationCardProps {
  recommendation: ProductRecommendation;
  availability?: AvailabilitySummary;
  narration?: LLMRecommendationOutput | null;
  narrationSource?: RecommendationNarrationSource | null;
}

function narratorSourceLabel(source: RecommendationNarrationSource | null | undefined): string {
  return source === "gemma" ? "Gemma" : "deterministic fallback";
}

export function RecommendationCard({ recommendation, availability, narration, narrationSource }: RecommendationCardProps) {
  const { product } = recommendation;
  const summary = product.strengths.slice(0, 2).join(", ");
  const displayedPrice =
    recommendation.currentBestPriceCents != null
      ? formatUsdFromCents(recommendation.currentBestPriceCents)
      : product.priceUsd > 0
        ? formatUsd(product.priceUsd)
        : "Price TBD";
  const catalogCents = product.priceUsd > 0 ? Math.round(product.priceUsd * 100) : null;
  const livePriceState = buildLivePriceCardState(availability, catalogCents);
  const betterThanCurrentRow = recommendation.deviceDelta?.explanationFacts[0]
    ? (["Why this is better", recommendation.deviceDelta.explanationFacts[0]] satisfies [string, string])
    : null;
  const explanationRows: Array<[string, string]> = narration
    ? [
        ["Why it helps", narration.whyThisHelps],
        ...(betterThanCurrentRow ? [betterThanCurrentRow] : []),
        ["Tradeoffs", narration.tradeoffs],
        ["Confidence", narration.confidenceNote],
        ["Ranking changed because", recommendation.rankingChangedReason],
      ]
    : [
        ["Why it helps", recommendation.explanation.problemSolved],
        ...(betterThanCurrentRow ? [betterThanCurrentRow] : []),
        ["Why now", recommendation.explanation.whyNow],
        ["Why this model", recommendation.explanation.whyThisModel],
        ["Profile fields used", recommendation.profileFieldsUsed.length ? recommendation.profileFieldsUsed.join(", ") : "No private profile fields used."],
        ["Missing device specs", recommendation.missingDeviceSpecs.length ? recommendation.missingDeviceSpecs.join(", ") : "No fit-critical device specs missing."],
        ["Confidence", `${recommendation.confidenceLevel} (${recommendation.scoreBreakdown.confidence}/100)`],
        ["Ranking changed because", recommendation.rankingChangedReason],
      ];

  return (
    <article className="rounded-[1.85rem] border border-white/10 bg-slate-900/70 p-6 text-slate-100 shadow-[0_24px_65px_rgba(2,6,23,0.55)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-5">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200/80">
            {categoryLabels[product.category]}
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">{product.name}</h2>
          <p className="mt-1 text-sm font-medium text-slate-400">
            {product.brand} · {displayedPrice} · {availability?.label ?? "Availability unknown"}
          </p>
        </div>
        <ScoreBadge score={recommendation.score} size="md" />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {[
          ["Final", recommendation.finalRecommendationScore],
          ["Fit", recommendation.fitScore],
          ["Trait delta", recommendation.traitDeltaScore],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-1 font-display text-2xl font-semibold text-slate-100">{value}/100</p>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-[1.4rem] border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.95),rgba(6,78,59,0.9))] p-4 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
          {narration ? `Narrator layer: ${narratorSourceLabel(narrationSource)}` : "Personal summary"}
        </p>
        <p className="mt-3 font-display text-xl font-semibold text-white">{narration?.headline ?? product.name}</p>
        <p className="mt-2 text-sm leading-7 text-white/82">{narration?.explanation ?? summary}</p>
      </div>

      <dl className="mt-5 grid gap-3">
        {explanationRows.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</dt>
            <dd className="mt-1 text-sm leading-6 text-slate-300">{value}</dd>
          </div>
        ))}
      </dl>

      <DeviceDeltaComparison delta={recommendation.deviceDelta} />

      <div className="mt-5">
        <LivePricePanel
          deviceCatalogId={product.catalogDeviceId ?? product.id}
          slug={product.catalogDeviceId ?? product.id}
          initialState={livePriceState}
        />
      </div>

      {narration?.followUpQuestion ? (
        <div className="mt-5 rounded-2xl border border-dashed border-cyan-300/30 bg-white/5 p-4 text-sm leading-6 text-slate-300">
          {narration.followUpQuestion}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {product.solves.slice(0, 3).map((problem) => (
          <span key={problem} className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100 shadow-[inset_0_0_0_1px_rgba(45,212,191,0.22)]">
            {problem.replaceAll("_", " ")}
          </span>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/10 pt-4">
        <span className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
          {recommendation.fit} fit
        </span>
        <Link href={`/products/${product.id}`} className="text-sm font-semibold text-cyan-200 hover:text-cyan-100">
          Details
        </Link>
      </div>
    </article>
  );
}
