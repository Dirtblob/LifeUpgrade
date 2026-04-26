import Link from "next/link";
import type { ReactNode } from "react";
import { ConfirmActionForm } from "@/components/admin/ConfirmActionForm";
import { productCatalog } from "@/data/seeds/productCatalog";
import { buildAdminDashboardData } from "@/lib/admin/dashboard";
import {
  clearAdminDemoDataAction,
  runAdminDemoProfileAction,
  runAdminPriceRefreshAction,
  testGemmaExplanationAction,
} from "./actions";

export const dynamic = "force-dynamic";

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "Never";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatSignedScore(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${value}`;
}

function formatUsdFromCents(value: number | null | undefined): string {
  if (value === null || value === undefined) return "No live price";
  return `$${(value / 100).toFixed(2)}`;
}

function formatUsdDeltaFromCents(value: number | null | undefined): string {
  if (value === null || value === undefined) return "No delta";
  const dollars = value / 100;
  return `${dollars > 0 ? "+" : ""}$${dollars.toFixed(2)}`;
}

function buttonLinkClassName(tone: "default" | "accent" = "default"): string {
  return `inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition ${
    tone === "accent"
      ? "bg-gold text-ink hover:bg-white"
      : "border border-ink/10 bg-white text-ink hover:border-moss/25 hover:bg-mist"
  }`;
}

function StatTile({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warning" | "success";
}) {
  const toneClassName =
    tone === "warning" ? "border-gold/25 bg-gold/10" : tone === "success" ? "border-moss/20 bg-moss/8" : "border-ink/10 bg-white";

  return (
    <div className={`rounded-[1.45rem] border p-4 ${toneClassName}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">{label}</p>
      <p className="mt-3 font-display text-3xl font-semibold text-ink">{value}</p>
      <p className="mt-2 text-sm leading-6 text-ink/64">{detail}</p>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.9rem] border border-white/70 bg-white/90 p-6 shadow-panel backdrop-blur md:p-7">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-moss">{title}</p>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-ink/64">{subtitle}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default async function AdminDashboardPage() {
  const data = await buildAdminDashboardData();
  const productNameById = new Map(productCatalog.map((product) => [product.id, product.name]));
  const limitingRemainingCalls = Math.min(data.quotaSnapshot.monthlyRemaining, data.quotaSnapshot.minuteRemaining);
  const limitingWindow =
    limitingRemainingCalls === data.quotaSnapshot.minuteRemaining
      ? "minute"
      : "month";

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[2.15rem] bg-[linear-gradient(145deg,rgba(23,33,31,1)_0%,rgba(32,47,43,1)_42%,rgba(66,104,90,0.96)_100%)] text-white shadow-panel">
        <div className="bg-[radial-gradient(circle_at_top_left,rgba(224,171,69,0.28),transparent_18rem),radial-gradient(circle_at_bottom_right,rgba(66,104,90,0.3),transparent_22rem)] p-8 md:p-10">
          <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">Admin debug dashboard</p>
              <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight md:text-5xl">
                Hackathon development control room
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-white/74">
                Monitor catalog coverage, quota headroom, job health, ranking drift from price updates, vision scan
                telemetry, and narrator fallbacks from one final admin view.
              </p>
            </div>

            <div className="grid gap-3 rounded-[1.8rem] border border-white/12 bg-white/8 p-5 backdrop-blur">
              <ConfirmActionForm
                action={runAdminDemoProfileAction}
                confirmMessage="Run the demo profile and overwrite the current local demo setup?"
                pendingText="Loading demo..."
                variant="accent"
              >
                Run demo profile
              </ConfirmActionForm>
              <ConfirmActionForm action={runAdminPriceRefreshAction} pendingText="Refreshing prices..." variant="glass">
                Run price refresh
              </ConfirmActionForm>
              <ConfirmActionForm action={testGemmaExplanationAction} pendingText="Testing Gemma..." variant="glass">
                Test Gemma explanation
              </ConfirmActionForm>
              <ConfirmActionForm
                action={clearAdminDemoDataAction}
                confirmMessage="Clear the local demo profile, inventory, watchlist, and generated recommendations?"
                pendingText="Clearing demo data..."
                variant="danger"
              >
                Clear demo data
              </ConfirmActionForm>
              <Link href="/admin/training-data/export" className={buttonLinkClassName()}>
                Export training examples
              </Link>
              <Link href="/admin/api-usage" className={buttonLinkClassName()}>
                Open quota dashboard
              </Link>
              <Link href="/admin/catalog" className={buttonLinkClassName()}>
                Open catalog admin
              </Link>
              <Link href="/admin/devices" className={buttonLinkClassName()}>
                Open device intelligence
              </Link>
              <Link href="/admin/enrichment-candidates" className={buttonLinkClassName()}>
                Enrichment candidates
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title="Product Catalog Health"
          subtitle="Quick checks for whether the hackathon catalog is complete enough to trust during demos and refresh jobs."
        >
          <div className="grid gap-4 md:grid-cols-3">
            <StatTile
              label="Catalog products"
              value={`${data.catalogHealth.productCount}`}
              detail="Seed models currently available to onboarding, scoring, and availability refresh flows."
              tone="success"
            />
            <StatTile
              label="Missing specs"
              value={`${data.catalogHealth.missingSpecsCount}`}
              detail="Products with no structured `features` payload yet."
              tone={data.catalogHealth.missingSpecsCount > 0 ? "warning" : "success"}
            />
            <StatTile
              label="Missing search queries"
              value={`${data.catalogHealth.missingSearchQueriesCount}`}
              detail="Catalog entries without search terms for future provider lookups."
              tone={data.catalogHealth.missingSearchQueriesCount > 0 ? "warning" : "success"}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="PricesAPI free-tier quota"
          subtitle="Live quota snapshot for the current provider, including the window most likely to block the next refresh."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <StatTile
              label="Monthly usage"
              value={`${data.quotaSnapshot.monthlyCallsUsed} / ${data.quotaSnapshot.policy.limitPerMonth}`}
              detail={`${data.quotaSnapshot.monthlyRemaining} calls remain this month.`}
              tone={data.quotaSnapshot.monthlyRemaining < 100 ? "warning" : "default"}
            />
            <StatTile
              label="Minute usage"
              value={`${data.quotaSnapshot.minuteCallsUsed} / ${data.quotaSnapshot.policy.limitPerMinute}`}
              detail={`${data.quotaSnapshot.minuteRemaining} calls remain in the current minute window.`}
              tone={data.quotaSnapshot.minuteRemaining <= 1 ? "warning" : "default"}
            />
            <StatTile
              label="Remaining monthly requests"
              value={`${data.quotaSnapshot.monthlyRemaining}`}
              detail="Requests left in the current monthly PricesAPI budget."
              tone={data.quotaSnapshot.monthlyRemaining < 100 ? "warning" : "success"}
            />
            <StatTile
              label="Current bottleneck"
              value={`${limitingRemainingCalls}`}
              detail={`The ${limitingWindow} window is the current bottleneck. Safe average remaining this month: ${data.quotaMetrics.safeAverageCallsPerDay}/day.`}
              tone={limitingRemainingCalls <= 1 ? "warning" : "success"}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Background Jobs"
          subtitle="Refresh job activity, quota skips, and the latest recorded failure from manual or cron-driven refreshes."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <StatTile
              label="Last refresh job"
              value={formatDateTime(data.lastRefreshJob?.createdAt)}
              detail={data.lastRefreshJob ? `Status ${data.lastRefreshJob.status}.` : "No refresh job has been recorded yet."}
            />
            <StatTile
              label="Last error"
              value={data.lastBackgroundJobError ? formatDateTime(data.lastBackgroundJobError.recordedAtIso) : "None"}
              detail={data.lastBackgroundJobError?.message ?? "No background job error has been persisted yet."}
              tone={data.lastBackgroundJobError ? "warning" : "success"}
            />
            <StatTile
              label="Products checked"
              value={`${data.lastRefreshJob?.productsChecked ?? 0}`}
              detail={
                data.lastRefreshJob
                  ? `${data.lastRefreshJob.productsEligible} products were eligible in the most recent run.`
                  : "A refresh run will populate this counter."
              }
            />
            <StatTile
              label="Skipped due to quota"
              value={`${data.lastRefreshJob?.productsSkippedDueToQuota ?? 0}`}
              detail={
                data.lastRefreshJob
                  ? `${data.lastRefreshJob.remainingMinuteCalls} minute and ${data.lastRefreshJob.remainingMonthlyCalls} monthly calls remained afterward.`
                  : "Quota skips appear after the first constrained run."
              }
              tone={(data.lastRefreshJob?.productsSkippedDueToQuota ?? 0) > 0 ? "warning" : "default"}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Recommendation Engine"
          subtitle="Recent generated recommendations plus the strongest score changes caused by cached or refreshed market prices."
        >
          <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Latest generated recommendations</p>
              {data.latestRecommendations.length > 0 ? (
                data.latestRecommendations.map((recommendation) => (
                  <div key={recommendation.id} className="rounded-[1.35rem] border border-ink/10 bg-mist/55 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-semibold text-ink">
                        {productNameById.get(recommendation.productModelId ?? "") ?? recommendation.category.replaceAll("_", " ")}
                      </p>
                      <span className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">
                        {recommendation.score}/100
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-ink/68">
                      {recommendation.userProfile?.name ?? recommendation.userProfile?.profession ?? "Profile"} · {recommendation.category.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-ink/42">
                      Generated {formatDateTime(recommendation.createdAt)}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-[1.35rem] border border-dashed border-ink/12 bg-white p-4 text-sm text-ink/64">
                  No generated recommendations are stored yet.
                </div>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Top score changes due to price updates</p>
              {data.scoreChanges.length > 0 ? (
                data.scoreChanges.map((change) => (
                  <div key={change.productId} className="rounded-[1.35rem] border border-ink/10 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-semibold text-ink">{change.productName}</p>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          change.delta === 0 ? "bg-ink/8 text-ink/70" : change.delta > 0 ? "bg-moss/12 text-moss" : "bg-gold/16 text-ink"
                        }`}
                      >
                        {formatSignedScore(change.delta)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-ink/66">
                      {change.beforeScore} to {change.afterScore}. Best price {formatUsdFromCents(change.currentBestPriceCents)}.
                    </p>
                    <p className="mt-1 text-sm leading-6 text-ink/58">
                      Price delta from expected: {formatUsdDeltaFromCents(change.priceDeltaFromExpected)}.
                    </p>
                    <p className="mt-2 text-xs leading-5 text-ink/48">{change.rankingChangedReason}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-[1.35rem] border border-dashed border-ink/12 bg-white p-4 text-sm text-ink/64">
                  No active profile is available yet for a price-sensitive recommendation comparison.
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Vision Scan Status"
          subtitle="Latest browser-side TFJS scan status recorded from the scan flow, including the last captured summary when one exists."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <StatTile
              label="Model status"
              value={
                data.visionStatus
                  ? data.visionStatus.modelStatus === "loaded"
                    ? "Loaded"
                    : "Unavailable"
                  : "Unknown"
              }
              detail={
                data.visionStatus
                  ? `Last ping ${formatDateTime(data.visionStatus.recordedAtIso)}.${data.visionStatus.error ? ` ${data.visionStatus.error}` : ""}`
                  : "No scan debug event has been recorded yet."
              }
              tone={data.visionStatus?.modelStatus === "unavailable" ? "warning" : "success"}
            />
            <div className="rounded-[1.45rem] border border-ink/10 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Last scan summary</p>
              {data.visionStatus?.summary ? (
                <div className="mt-3 space-y-2 text-sm leading-6 text-ink/66">
                  <p>
                    {data.visionStatus.summary.sampledFrameCount} frames, {data.visionStatus.summary.totalDetections} detections,
                    {` ${data.visionStatus.summary.suggestedInventoryCount} suggested items.`}
                  </p>
                  <p>Estimated style: {data.visionStatus.summary.estimatedStyle.replaceAll("_", " ")}.</p>
                  <p>
                    Issues:{" "}
                    {data.visionStatus.summary.possibleIssues.length > 0
                      ? data.visionStatus.summary.possibleIssues.join(", ")
                      : "none flagged"}
                    .
                  </p>
                  <p>
                    Categories:{" "}
                    {data.visionStatus.summary.detectedCategories.length > 0
                      ? data.visionStatus.summary.detectedCategories
                          .map((category) => `${category.category.replaceAll("_", " ")} x${category.countEstimate}`)
                          .join(", ")
                      : "none saved"}
                    .
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-ink/64">No scan summary has been saved yet.</p>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="LLM Narrator Status"
          subtitle="Gemini usage controls for hosted Gemma narration, including cache behavior, failures, and deterministic fallback usage today."
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatTile
              label="Narrator mode"
              value={data.narratorStatus.mode}
              detail={
                data.narratorStatus.configured
                  ? `Gemini is configured for ${data.narratorStatus.usage.model}.`
                  : "No Gemini API key is configured, so refreshes store deterministic fallback narration."
              }
              tone={data.narratorStatus.configured ? "success" : "warning"}
            />
            <StatTile
              label="Gemini calls today"
              value={`${data.narratorStatus.usage.callsToday} / ${data.narratorStatus.usage.dailySoftCap}`}
              detail={`${data.narratorStatus.usage.dailyRemaining} calls remain before the daily soft cap blocks refreshes.`}
              tone={data.narratorStatus.usage.dailyRemaining <= 0 ? "warning" : "default"}
            />
            <StatTile
              label="Cached hits"
              value={`${data.narratorStatus.usage.cachedHitsToday}`}
              detail="Recommendation renders served a stored narrator explanation instead of calling Gemini."
              tone="success"
            />
            <StatTile
              label="Failures"
              value={`${data.narratorStatus.usage.failuresToday}`}
              detail="API errors, rate limits, invalid JSON, or exhausted daily soft cap events today."
              tone={data.narratorStatus.usage.failuresToday > 0 ? "warning" : "success"}
            />
            <StatTile
              label="Fallbacks"
              value={`${data.narratorStatus.usage.fallbackCountToday}`}
              detail="Deterministic explanation outputs used when no cache or usable Gemini response was available."
              tone={data.narratorStatus.usage.fallbackCountToday > 0 ? "warning" : "success"}
            />
            <div className="rounded-[1.45rem] border border-ink/10 bg-white p-4 md:col-span-2 xl:col-span-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">Latest narration errors</p>
              {data.latestNarrationErrors.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {data.latestNarrationErrors.map((error) => (
                    <div key={`${error.recordedAtIso}-${error.message}`} className="rounded-[1.1rem] bg-mist/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-ink">{error.provider}</p>
                        <p className="text-xs uppercase tracking-[0.14em] text-ink/42">
                          {formatDateTime(error.recordedAtIso)}
                        </p>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-ink/66">{error.message}</p>
                      <p className="mt-1 text-xs text-ink/48">
                        {error.category ? `Category ${error.category.replaceAll("_", " ")}` : "Unknown category"}
                        {error.productId ? ` · ${productNameById.get(error.productId) ?? error.productId}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-ink/64">No narration failures have been recorded yet.</p>
              )}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
