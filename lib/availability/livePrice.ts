import type { AvailabilitySummary } from "./types";

export type LivePriceStatus = "not_checked" | "cached" | "stale_cached" | "live_checked";
export type PricesCheckStatus = "fresh" | "cached" | "stale" | "quota_limited" | "error";

export interface LivePriceOfferDetails {
  seller: string;
  title: string;
  priceCents: number;
  totalPriceCents: number;
  url: string;
  condition?: string;
}

export interface PricesCheckQuotaSummary {
  requestsUsedThisMinute: number;
  requestsUsedThisMonth: number;
  remainingMinuteRequests: number;
  remainingMonthlyRequests: number;
  limitPerMinute: number;
  limitPerMonth: number;
}

export interface PricesCheckResponse {
  status: PricesCheckStatus;
  bestOffer: LivePriceOfferDetails | null;
  offers: LivePriceOfferDetails[];
  offerCount: number;
  estimatedMarketPriceCents: number | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  quota: PricesCheckQuotaSummary;
  message?: string | null;
  error?: string | null;
}

export interface LivePriceCardState {
  status: LivePriceStatus;
  statusLabel: "Live price not checked" | "Cached price" | "Stale cached price" | "Live price checked";
  availabilityLabel: string;
  bestOffer: LivePriceOfferDetails | null;
  offerCount: number;
  fetchedAtIso: string | null;
  quotaReached: boolean;
  message: string | null;
  catalogEstimateCents: number | null;
}

export function getLivePriceStatus(summary: AvailabilitySummary | undefined): LivePriceStatus {
  if (!summary?.checkedAt) {
    return "not_checked";
  }

  if (summary.refreshSource === "live") {
    return "live_checked";
  }

  if (summary.isStale) {
    return "stale_cached";
  }

  return "cached";
}

function labelForStatus(status: LivePriceStatus): LivePriceCardState["statusLabel"] {
  if (status === "cached") return "Cached price";
  if (status === "stale_cached") return "Stale cached price";
  if (status === "live_checked") return "Live price checked";
  return "Live price not checked";
}

function statusFromPricesCheckResponse(response: PricesCheckResponse): LivePriceStatus {
  if (response.status === "fresh") {
    return "live_checked";
  }

  if (response.status === "cached") {
    return "cached";
  }

  if (response.status === "stale") {
    return "stale_cached";
  }

  if (response.expiresAt && new Date(response.expiresAt).getTime() <= Date.now()) {
    return "stale_cached";
  }

  if (response.fetchedAt) {
    return "cached";
  }

  return "not_checked";
}

export function buttonLabelForLivePrice(state: LivePriceCardState): "Check live deals" | "Refresh live price" | null {
  if (state.status === "stale_cached") {
    return "Refresh live price";
  }

  if (!state.bestOffer) {
    return "Check live deals";
  }

  return null;
}

export function buildLivePriceCardState(
  summary: AvailabilitySummary | undefined,
  catalogEstimateCents: number | null,
  options: { message?: string | null; quotaReached?: boolean } = {},
): LivePriceCardState {
  const status = getLivePriceStatus(summary);
  const bestOffer = summary?.bestListing
    ? {
        seller: summary.bestListing.retailer,
        title: summary.bestListing.title,
        priceCents: summary.bestListing.priceCents,
        totalPriceCents: summary.bestListing.totalPriceCents,
        url: summary.bestListing.url,
      }
    : null;
  const quotaReached = options.quotaReached ?? summary?.refreshSkippedReason === "free_tier_quota";

  return {
    status,
    statusLabel: labelForStatus(status),
    availabilityLabel: summary?.label ?? "Availability unknown",
    bestOffer,
    offerCount: summary?.listings.length ?? 0,
    fetchedAtIso: summary?.checkedAt?.toISOString() ?? null,
    quotaReached,
    message: options.message ?? (quotaReached ? "Live price quota reached. Showing cached/catalog estimate." : null),
    catalogEstimateCents,
  };
}

export function buildLivePriceCardStateFromResponse(
  response: PricesCheckResponse,
  fallbackCatalogEstimateCents: number | null,
): LivePriceCardState {
  const status = statusFromPricesCheckResponse(response);
  const quotaReached = response.status === "quota_limited";

  return {
    status,
    statusLabel: labelForStatus(status),
    availabilityLabel: response.bestOffer ? "Available" : "Unavailable",
    bestOffer: response.bestOffer,
    offerCount: response.offerCount,
    fetchedAtIso: response.fetchedAt,
    quotaReached,
    message: response.message ?? response.error ?? (quotaReached ? "Live price quota reached. Showing cached/catalog estimate." : null),
    catalogEstimateCents: response.estimatedMarketPriceCents ?? fallbackCatalogEstimateCents,
  };
}
