import { NextResponse } from "next/server";
import { searchMongoDevices, type MongoCatalogDevice } from "@/lib/devices/mongoDeviceCatalog";
import { bestBuyProductSearchProvider, type ProductSearchResponse } from "@/lib/product-search/bestBuyProvider";
import { getCachedProductSearch, type ProductSearchCacheStatus } from "@/lib/product-search/cache";
import { normalizeProductQuery, normalizeTitle, type ProductSearchResult } from "@/lib/product-search/types";

type ProductSearchApiSource = "catalog" | "bestbuy" | "custom";
type ProductSearchApiCacheStatus = ProductSearchCacheStatus | "miss" | "mixed";

interface ProductSearchApiResult {
  id?: string;
  deviceCatalogId?: string;
  source: ProductSearchApiSource;
  externalId?: string;
  title: string;
  brand?: string;
  model?: string;
  category?: string;
  imageUrl?: string;
  priceCents?: number;
  currency?: string;
  condition?: string;
  productUrl?: string;
  hasCatalogRatings: boolean;
  precomputedTraits?: Record<string, unknown>;
  ergonomicSpecs?: Record<string, unknown>;
}

interface ProductSearchApiResponse {
  query: string;
  results: ProductSearchApiResult[];
  providersUsed: string[];
  cacheStatus: ProductSearchApiCacheStatus;
}

const CATALOG_LIMIT = 10;
const BEST_BUY_LIMIT = 10;

function definedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hasObjectKeys(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  return Boolean(value && Object.keys(value).length > 0);
}

function recordFromObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return hasObjectKeys(record) ? record : undefined;
}

function catalogTitle(device: MongoCatalogDevice): string {
  return [device.brand, device.model, device.variant].filter(Boolean).join(" ") || device.displayName;
}

function catalogResult(device: MongoCatalogDevice): ProductSearchApiResult {
  const precomputedTraits = {
    traitRatings: device.traitRatings,
    traitConfidence: device.traitConfidence,
    strengths: device.strengths,
    weaknesses: device.weaknesses,
    normalizedSpecs: device.normalizedSpecs,
  };

  return {
    id: device.id,
    deviceCatalogId: device._id,
    source: "catalog",
    title: catalogTitle(device),
    brand: device.brand,
    model: [device.model, device.variant].filter(Boolean).join(" ") || device.model,
    category: device.category,
    priceCents: device.estimatedPriceCents || undefined,
    currency: device.estimatedPriceCents ? "USD" : undefined,
    hasCatalogRatings: true,
    precomputedTraits,
    ergonomicSpecs: recordFromObject(device.ergonomicSpecs),
  };
}

function bestBuyResult(result: ProductSearchResult): ProductSearchApiResult | null {
  if (result.source !== "bestbuy") return null;

  return {
    id: result.id,
    source: "bestbuy",
    externalId: result.externalId,
    title: result.title,
    brand: result.brand,
    model: result.model,
    category: result.category,
    imageUrl: result.imageUrl,
    priceCents: result.priceCents,
    currency: result.currency,
    condition: result.condition,
    productUrl: result.productUrl,
    hasCatalogRatings: false,
  };
}

function customResult(query: string): ProductSearchApiResult {
  return {
    source: "custom",
    title: query,
    hasCatalogRatings: false,
  };
}

function dedupeKey(result: ProductSearchApiResult): string {
  const brand = normalizeProductQuery(result.brand ?? "");
  const modelOrTitle = normalizeProductQuery(definedText(result.model) ?? result.title);

  return [brand, modelOrTitle || normalizeTitle(result.title)].filter(Boolean).join("|");
}

function dedupeMergedResults(results: ProductSearchApiResult[]): ProductSearchApiResult[] {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = dedupeKey(result);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cacheStatusFromBestBuy(cacheStatus: ProductSearchCacheStatus | "miss", providerResponse?: ProductSearchResponse): ProductSearchApiCacheStatus {
  if (!providerResponse) return cacheStatus;
  if (providerResponse.status === "stale") return "stale";
  if (cacheStatus === "stale" && providerResponse.status === "live") return "mixed";
  if (providerResponse.status === "fresh") return "fresh";
  return cacheStatus;
}

function responseJson(input: ProductSearchApiResponse): NextResponse<ProductSearchApiResponse> {
  return NextResponse.json(input);
}

export async function GET(request: Request): Promise<NextResponse<ProductSearchApiResponse>> {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const normalizedQuery = normalizeProductQuery(query);

  if (normalizedQuery.length < 2) {
    return responseJson({
      query,
      results: [],
      providersUsed: [],
      cacheStatus: "miss",
    });
  }

  const providersUsed = new Set<string>();
  providersUsed.add("catalog");

  const catalogResults = (await searchMongoDevices({ q: query, limit: CATALOG_LIMIT })).map(catalogResult);
  const cachedBestBuy = await getCachedProductSearch("bestbuy", normalizedQuery);
  let bestBuyResults = cachedBestBuy?.status === "fresh" ? cachedBestBuy.results : [];
  let bestBuyCacheStatus: ProductSearchCacheStatus | "miss" = cachedBestBuy?.status ?? "miss";
  let providerResponse: ProductSearchResponse | undefined;

  if (cachedBestBuy) providersUsed.add("bestbuy");

  if (cachedBestBuy?.status !== "fresh" && normalizedQuery.length >= 3) {
    providersUsed.add("bestbuy");
    try {
      providerResponse = await bestBuyProductSearchProvider.searchProductsWithStatus(normalizedQuery, { limit: BEST_BUY_LIMIT });
      bestBuyResults = providerResponse.results;
    } catch {
      bestBuyResults = cachedBestBuy?.results ?? [];
      if (cachedBestBuy?.status === "stale") bestBuyCacheStatus = "stale";
    }
  }

  const normalizedBestBuyResults = bestBuyResults
    .map(bestBuyResult)
    .filter((result): result is ProductSearchApiResult => Boolean(result));
  const mergedResults = dedupeMergedResults([...catalogResults, ...normalizedBestBuyResults, customResult(query)]);

  providersUsed.add("custom");

  return responseJson({
    query,
    results: mergedResults,
    providersUsed: [...providersUsed],
    cacheStatus: cacheStatusFromBestBuy(bestBuyCacheStatus, providerResponse),
  });
}
