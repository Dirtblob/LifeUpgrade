import Link from "next/link";
import { listPendingCatalogEnrichmentCandidates } from "@/lib/catalog/enrichmentCandidates";

export const dynamic = "force-dynamic";

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function titleFromCandidate(candidate: Awaited<ReturnType<typeof listPendingCatalogEnrichmentCandidates>>[number]): string {
  return [candidate.brand, candidate.model].filter(Boolean).join(" ") || candidate.normalizedTitle;
}

export default async function AdminEnrichmentCandidatesPage() {
  const candidates = await listPendingCatalogEnrichmentCandidates(50);

  return (
    <div className="space-y-6">
      <section className="rounded-[1.9rem] border border-white/70 bg-white/90 p-6 shadow-panel backdrop-blur md:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-moss">Catalog enrichment</p>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold md:text-4xl">Unrated product candidates</h1>
            <p className="mt-3 max-w-3xl leading-7 text-ink/64">
              These Best Buy and custom inventory selections are not in `device_catalog` yet. They are queued for manual
              review only; LifeUpgrade does not automatically invent trait ratings, ergonomic specs, or recommendation
              scores for them.
            </p>
          </div>
          <Link
            href="/admin/devices"
            className="inline-flex items-center justify-center rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink/70 transition hover:bg-mist"
          >
            Open device catalog
          </Link>
        </div>
      </section>

      <section className="rounded-[1.9rem] border border-white/70 bg-white/90 p-6 shadow-panel backdrop-blur md:p-8">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-moss">Top pending</p>
            <p className="mt-2 text-sm leading-6 text-ink/60">
              Approve candidates later by adding a curated `device_catalog` entry and manually entering traits/specs.
            </p>
          </div>
          <span className="rounded-full bg-mist px-4 py-2 text-sm font-semibold text-ink/60">
            {candidates.length} pending
          </span>
        </div>

        {candidates.length === 0 ? (
          <div className="mt-6 rounded-[1.4rem] border border-dashed border-ink/12 bg-mist/45 p-6 text-sm text-ink/58">
            No pending enrichment candidates yet.
          </div>
        ) : (
          <div className="mt-6 grid gap-4">
            {candidates.map((candidate) => (
              <article key={String(candidate._id)} className="rounded-[1.4rem] border border-ink/8 bg-mist/45 p-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-xs font-semibold text-ink/45">
                      {candidate.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={candidate.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        candidate.source.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-display text-xl font-semibold text-ink">{titleFromCandidate(candidate)}</h2>
                      <p className="mt-1 text-sm text-ink/58">
                        {candidate.source} {candidate.externalId ? `· ${candidate.externalId}` : ""}{" "}
                        {candidate.category ? `· ${candidate.category.replaceAll("_", " ")}` : ""}
                      </p>
                      {candidate.productUrl ? (
                        <a
                          href={candidate.productUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex text-sm font-semibold text-moss hover:text-ink"
                        >
                          View source product
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0 rounded-2xl bg-white px-4 py-3 text-sm text-ink/62">
                    <p className="font-semibold text-ink">{candidate.seenCount} seen</p>
                    <p className="mt-1">First: {formatDate(candidate.firstSeenAt)}</p>
                    <p>Last: {formatDate(candidate.lastSeenAt)}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
