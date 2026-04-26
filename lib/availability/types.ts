export interface AvailabilityProductModel {
  id: string;
  brand: string;
  model?: string;
  displayName?: string;
  category: string;
  estimatedPriceCents?: number;
  searchQueries?: string[];
  gtin?: string;
  upc?: string;
  allowUsed?: boolean;
  deviceCatalogId?: string;
  slug?: string;
}

export interface AvailabilityProvider {
  name: string;
  search(productModel: AvailabilityProductModel): Promise<AvailabilitySearchResponse>;
}

export interface AvailabilityResult {
  provider: string;
  productModelId: string;
  title: string;
  brand: string;
  model: string;
  retailer: string;
  available: boolean;
  priceCents: number;
  shippingCents?: number | null;
  totalPriceCents: number;
  condition: string;
  url: string;
  imageUrl?: string;
  confidence: number;
  checkedAt: Date;
}

export interface AvailabilitySearchResponse {
  listings: AvailabilityResult[];
  checkedAt: Date;
  refreshSource: AvailabilityRefreshSource;
  refreshSkippedReason?: AvailabilityRefreshSkipReason;
  isStale?: boolean;
}

export type AvailabilityDisplayStatus = "available" | "unavailable" | "checking_not_configured";
export type AvailabilityRefreshSource = "live" | "cached" | "not_configured";
export type AvailabilityRefreshSkipReason = "free_tier_quota" | "refresh_window" | "cache_only";

export interface AvailabilitySummary {
  provider: string | null;
  productModelId: string;
  status: AvailabilityDisplayStatus;
  label: "Available" | "Unavailable" | "Availability unknown";
  listings: AvailabilityResult[];
  bestListing: AvailabilityResult | null;
  checkedAt: Date | null;
  refreshSource: AvailabilityRefreshSource;
  refreshSkippedReason?: AvailabilityRefreshSkipReason;
  isStale?: boolean;
}
