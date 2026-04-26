import Link from "next/link";
import { ActionButton } from "@/components/ui/ActionButton";
import { getCurrentUserProfileRecord } from "@/lib/currentUser";
import { db } from "@/lib/db";
import { productCatalog } from "@/data/seeds/productCatalog";
import { markAlertSeenAction } from "./actions";

export const dynamic = "force-dynamic";

function formatPrice(priceCents: number | null | undefined): string {
  if (priceCents === null || priceCents === undefined) {
    return "Unknown";
  }

  return `$${(priceCents / 100).toFixed(2)}`;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export default async function AlertsPage() {
  const profile = await getCurrentUserProfileRecord();
  const alerts = profile
    ? await db.watchlistAlert.findMany({
        where: {
          userProfileId: profile.id,
        },
        orderBy: [{ seen: "asc" }, { createdAt: "desc" }],
      })
    : [];
  const unreadCount = alerts.filter((alert) => !alert.seen).length;

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-[linear-gradient(145deg,rgba(23,33,31,1)_0%,rgba(31,46,42,1)_46%,rgba(66,104,90,0.96)_100%)] p-8 text-white shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">Watchlist alerts</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">Better prices and better upgrade signals.</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-white/72">
          Background price refreshes now create in-app alerts when a watched product becomes available, crosses your
          target, drops sharply, gains score, or enters the top 3 for its category.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <div className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold">
            {alerts.length} total alerts
          </div>
          <div className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold">
            {unreadCount} unread
          </div>
        </div>
      </section>

      {alerts.length === 0 ? (
        <section className="rounded-[2rem] border border-dashed border-ink/15 bg-white/85 p-10 text-center shadow-panel">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-clay">No alerts yet</p>
          <h2 className="mt-3 font-display text-3xl font-semibold">Your watchlist is quiet for now.</h2>
          <p className="mx-auto mt-4 max-w-2xl leading-7 text-ink/65">
            Save products in recommendations, then run a price refresh to generate alert events here.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/recommendations" className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white">
              Open recommendations
            </Link>
            <Link href="/settings" className="rounded-full border border-ink/10 px-5 py-3 text-sm font-semibold text-ink">
              Review profile
            </Link>
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          {alerts.map((alert) => {
            const product = productCatalog.find((catalogItem) => catalogItem.id === alert.productModelId);

            return (
              <article
                key={alert.id}
                className={`rounded-[1.75rem] border p-6 shadow-soft transition ${
                  alert.seen ? "border-ink/10 bg-white/75" : "border-gold/45 bg-white"
                }`}
              >
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
                          alert.seen ? "bg-ink/8 text-ink/55" : "bg-gold/20 text-ink"
                        }`}
                      >
                        {alert.seen ? "Seen" : "New"}
                      </span>
                      <span className="text-sm font-medium text-ink/45">{formatDate(alert.createdAt)}</span>
                    </div>

                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-moss">Product</p>
                      <h2 className="mt-1 font-display text-2xl font-semibold text-ink">
                        {product?.name ?? alert.productModelId}
                      </h2>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]">
                      <div className="rounded-2xl bg-mist px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Reason</p>
                        <p className="mt-2 font-semibold text-ink">{alert.title}</p>
                        <p className="mt-2 text-sm leading-6 text-ink/65">{alert.message}</p>
                      </div>
                      <div className="rounded-2xl bg-mist px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">New price</p>
                        <p className="mt-2 text-xl font-semibold text-ink">{formatPrice(alert.newPriceCents)}</p>
                        <p className="mt-2 text-sm text-ink/60">Provider: {alert.provider}</p>
                      </div>
                      <div className="rounded-2xl bg-mist px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Previous price</p>
                        <p className="mt-2 text-xl font-semibold text-ink">{formatPrice(alert.oldPriceCents)}</p>
                        <p className="mt-2 text-sm text-ink/60">
                          Target: {alert.thresholdCents ? formatPrice(alert.thresholdCents) : "Not set"}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-mist px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Score</p>
                        <p className="mt-2 text-xl font-semibold text-ink">{alert.scoreAtAlert}</p>
                        <p className="mt-2 text-sm text-ink/60">{product?.category.replaceAll("_", " ") ?? "watched product"}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 lg:min-w-44">
                    {alert.url ? (
                      <Link
                        href={alert.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-moss"
                      >
                        View product
                      </Link>
                    ) : null}
                    {alert.seen ? (
                      <span className="inline-flex items-center justify-center rounded-full border border-ink/10 px-5 py-3 text-sm font-semibold text-ink/55">
                        Seen
                      </span>
                    ) : (
                      <form action={markAlertSeenAction}>
                        <input type="hidden" name="alertId" value={alert.id} />
                        <ActionButton pendingText="Updating..." variant="secondary" className="w-full">
                          Mark as seen
                        </ActionButton>
                      </form>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <section className="rounded-2xl border border-dashed border-ink/15 bg-white/80 p-5 text-sm leading-6 text-ink/65 shadow-soft">
        Email and push delivery are future work. For now, watchlist alerts stay in-app so the experience remains local
        and dependency-light.
      </section>
    </div>
  );
}
