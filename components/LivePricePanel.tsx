"use client";

import { useState } from "react";
import {
  buildLivePriceCardStateFromResponse,
  buttonLabelForLivePrice,
  type LivePriceCardState,
  type PricesCheckResponse,
} from "@/lib/availability/livePrice";
import { formatLastCheckedTimestamp } from "@/lib/availability/display";
import { formatUsdFromCents } from "@/lib/ui/format";

interface LivePricePanelProps {
  deviceCatalogId?: string | null;
  slug?: string | null;
  initialState: LivePriceCardState;
  className?: string;
}

function statusTone(status: LivePriceCardState["status"], quotaReached: boolean): string {
  if (quotaReached) return "bg-rose-400/20 text-rose-100";
  if (status === "live_checked") return "bg-emerald-400/20 text-emerald-100";
  if (status === "cached") return "bg-amber-300/20 text-amber-100";
  if (status === "stale_cached") return "bg-rose-400/16 text-rose-100";
  return "bg-white/10 text-slate-300";
}

export function LivePricePanel({ deviceCatalogId, slug, initialState, className = "" }: LivePricePanelProps) {
  const [state, setState] = useState(initialState);
  const [isChecking, setIsChecking] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const buttonLabel = buttonLabelForLivePrice(state);

  async function checkLivePrice() {
    if (!deviceCatalogId && !slug) {
      setRequestError("This recommendation is missing a catalog identifier.");
      return;
    }

    setIsChecking(true);
    setRequestError(null);

    try {
      const response = await fetch("/api/prices/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceCatalogId: deviceCatalogId ?? undefined,
          slug: slug ?? undefined,
          forceRefresh: state.status === "stale_cached",
        }),
      });
      const payload = (await response.json()) as PricesCheckResponse & { error?: string };

      if (!response.ok || !payload.status) {
        throw new Error(payload.error ?? "Could not check live pricing.");
      }

      setState(buildLivePriceCardStateFromResponse(payload, state.catalogEstimateCents));
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not check live pricing.");
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <div className={`rounded-2xl border border-white/10 bg-slate-900/65 p-4 text-slate-100 backdrop-blur-xl ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Live pricing</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusTone(state.status, state.quotaReached)}`}>
              {state.statusLabel}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
              {state.availabilityLabel}
            </span>
          </div>
        </div>

        {buttonLabel ? (
          <button
            type="button"
            onClick={checkLivePrice}
            disabled={isChecking}
            className="inline-flex min-w-[10.5rem] items-center justify-center rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/35 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isChecking ? "Checking live deals..." : buttonLabel}
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Best offer</p>
          <p className="mt-2 text-sm font-semibold text-slate-100">
            {state.bestOffer ? formatUsdFromCents(state.bestOffer.totalPriceCents) : state.catalogEstimateCents !== null ? formatUsdFromCents(state.catalogEstimateCents) : "No price yet"}
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            {state.bestOffer?.title ?? (state.catalogEstimateCents !== null ? "Showing the catalog estimate until a matching live offer is available." : "Click \"Check live deals\" to search for offers.")}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Seller</p>
          <p className="mt-2 text-sm font-semibold text-slate-100">{state.bestOffer?.seller ?? "No seller yet"}</p>
          <p className="mt-1 text-sm leading-6 text-slate-300">{state.offerCount} offer{state.offerCount === 1 ? "" : "s"} matched.</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Fetched at</p>
          <p className="mt-2 text-sm text-slate-300">{state.fetchedAtIso ? formatLastCheckedTimestamp(new Date(state.fetchedAtIso)) : "Not checked yet"}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Price basis</p>
          <p className="mt-2 text-sm text-slate-300">
            {state.bestOffer ? `Offer total ${formatUsdFromCents(state.bestOffer.totalPriceCents)}` : state.catalogEstimateCents !== null ? `Catalog estimate ${formatUsdFromCents(state.catalogEstimateCents)}` : "No estimate available"}
          </p>
        </div>
      </div>

      {state.message ? <p className="mt-3 text-sm leading-6 text-slate-300">{state.message}</p> : null}
      {requestError ? <p className="mt-3 text-sm leading-6 text-rose-200">{requestError}</p> : null}
    </div>
  );
}
