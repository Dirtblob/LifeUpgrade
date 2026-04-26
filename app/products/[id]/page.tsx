import Link from "next/link";
import { notFound } from "next/navigation";
import { ScoreBadge } from "@/components/ScoreBadge";
import { getCachedAvailabilitySummaries } from "@/lib/availability";
import { availabilityDetailMessages } from "@/lib/availability/display";
import { loadCachedRecommendationPriceSnapshots } from "@/lib/availability/priceSnapshots";
import { recordRecentlyViewedProduct } from "@/lib/jobs/selectProductsForRefresh";
import { recommendationProductToAvailabilityModel } from "@/lib/recommendation/mongoDeviceProducts";
import { productCatalog } from "@/data/seeds/productCatalog";
import { getCategoryRecommendations } from "@/lib/recommendation/categoryEngine";
import { getProductRecommendations } from "@/lib/recommendation/productEngine";
import { categoryLabels } from "@/lib/recommendation/scoring";
import { loadRecommendationContext } from "@/lib/userData";

export const dynamic = "force-dynamic";

interface ProductPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { id } = await params;
  const context = await loadRecommendationContext();
  const candidateProducts = context?.candidateProducts ?? productCatalog;
  const product = candidateProducts.find((candidate) => candidate.id === id);
  if (!product) notFound();

  const availabilityModel = recommendationProductToAvailabilityModel(product, { allowUsed: context?.usedItemsOkay });
  const [availability, pricingByProductId] = await Promise.all([
    getCachedAvailabilitySummaries([availabilityModel]).then((summaries) => summaries[product.id]),
    context?.pricingByProductId
      ? Promise.resolve(Object.fromEntries(context.pricingByProductId))
      : loadCachedRecommendationPriceSnapshots([availabilityModel]),
  ]);
  const availabilityMessages = availabilityDetailMessages(availability);
  const recommendationInput = context
    ? {
        profile: context.profile,
        inventory: context.inventory,
        candidateProducts,
        privateProfile: context.privateProfile,
        exactCurrentModelsProvided: context.exactCurrentModelsProvided,
        usedItemsOkay: context.usedItemsOkay,
        availabilityByProductId: {
          [product.id]: availability,
        },
        pricingByProductId,
      }
    : null;
  const recommendation = recommendationInput
    ? getCategoryRecommendations(recommendationInput)
        .flatMap((categoryRecommendation) =>
          getProductRecommendations(recommendationInput, categoryRecommendation, candidateProducts),
        )
        .find((item) => item.product.id === product.id)
    : undefined;
  if (context?.profileId) {
    await recordRecentlyViewedProduct(context.profileId, product.id);
  }

  return (
    <div className="space-y-6">
      <Link href="/recommendations" className="text-sm font-semibold text-moss hover:text-ink">
        Back to recommendations
      </Link>
      <section className="grid gap-6 rounded-2xl bg-white p-6 shadow-soft lg:grid-cols-[1fr_0.65fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-clay">
            {categoryLabels[product.category]}
          </p>
          <h1 className="mt-3 text-4xl font-semibold">{product.name}</h1>
          <p className="mt-2 text-lg text-ink/60">
            {product.brand}{product.priceUsd > 0 ? ` · $${product.priceUsd}` : ""}
          </p>
          <p className="mt-5 max-w-3xl leading-8 text-ink/70">{product.shortDescription}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {product.solves.map((strength) => (
              <span key={strength} className="rounded-full bg-mist px-3 py-2 text-sm font-medium text-ink/70">
                {strength.replaceAll("_", " ")}
              </span>
            ))}
          </div>
        </div>
        <aside className="rounded-2xl bg-mist p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-ink/60">Price</p>
              <p className="mt-2 text-3xl font-semibold">{product.priceUsd > 0 ? `$${product.priceUsd}` : "Price TBD"}</p>
            </div>
            <ScoreBadge score={recommendation?.score ?? 0} />
          </div>
          <div className="mt-6 space-y-3 text-sm">
            <p>
              <span className="font-semibold">Availability:</span> {availability.label}
            </p>
            <p>
              <span className="font-semibold">Current best price:</span>{" "}
              {recommendation?.currentBestPriceCents
                ? `$${Math.round(recommendation.currentBestPriceCents / 100)}`
                : product.priceUsd > 0 ? `$${product.priceUsd}` : "Not checked"}
            </p>
            <p>
              <span className="font-semibold">Provider:</span> {availability.provider ?? "Not configured"}
            </p>
            {availabilityMessages.map((message) => (
              <p key={message}>{message}</p>
            ))}
            <p>
              <span className="font-semibold">Fit:</span> {recommendation?.fit ?? "situational"}
            </p>
            {recommendation ? (
              <>
                <p>
                  <span className="font-semibold">Final recommendation score:</span>{" "}
                  {recommendation.finalRecommendationScore}/100
                </p>
                <p>
                  <span className="font-semibold">Fit score:</span> {recommendation.fitScore}/100
                </p>
                <p>
                  <span className="font-semibold">Trait delta score:</span> {recommendation.traitDeltaScore}/100
                </p>
                <p>
                  <span className="font-semibold">Profile fields used:</span>{" "}
                  {recommendation.profileFieldsUsed.length
                    ? recommendation.profileFieldsUsed.join(", ")
                    : "No private profile fields used."}
                </p>
                <p>
                  <span className="font-semibold">Missing device specs:</span>{" "}
                  {recommendation.missingDeviceSpecs.length
                    ? recommendation.missingDeviceSpecs.join(", ")
                    : "No fit-critical device specs missing."}
                </p>
              </>
            ) : null}
            {recommendation ? (
              <p>
                <span className="font-semibold">Ranking changed because:</span> {recommendation.rankingChangedReason}
              </p>
            ) : null}
          </div>
        </aside>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-soft">
        <h2 className="text-xl font-semibold">Why it was recommended</h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {(recommendation?.reasons ?? ["This product exists in the current Mongo-backed catalog but is below the top rankings for this profile."]).map(
            (reason) => (
              <li key={reason} className="rounded-xl bg-mist p-4 text-sm leading-6 text-ink/70">
                {reason}
              </li>
            ),
          )}
        </ul>
      </section>
    </div>
  );
}
