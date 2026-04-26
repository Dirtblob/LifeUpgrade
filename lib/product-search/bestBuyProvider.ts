import "server-only";

import { getCachedProductSearch, saveProductSearchCache, type ProductSearchCacheStatus } from "./cache";
import { normalizeProductQuery, type ProductSearchOptions, type ProductSearchProvider, type ProductSearchResult } from "./types";

const DEFAULT_BASE_URL = "https://api.bestbuy.com/v1";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 6 * 60 * 60 * 1000;
const FAILED_TTL_MS = 60 * 60 * 1000;

interface BestBuyProviderEnv {
  BESTBUY_API_KEY?: string;
  BESTBUY_API_BASE_URL?: string;
  NODE_ENV?: string;
}

interface BestBuyProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  env?: BestBuyProviderEnv;
  useCache?: boolean;
}

interface BestBuyProductsResponse {
  products?: BestBuyProductRecord[];
}

interface BestBuyCategoryPathNode {
  name?: string | null;
}

interface BestBuyProductRecord {
  sku?: string | number | null;
  name?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
  modelNumber?: string | null;
  categoryPath?: BestBuyCategoryPathNode[] | null;
  category?: string | { name?: string | null } | null;
  salePrice?: string | number | null;
  regularPrice?: string | number | null;
  image?: string | null;
  thumbnailImage?: string | null;
  url?: string | null;
  onlineAvailability?: boolean | null;
  customerReviewAverage?: number | null;
  customerReviewCount?: number | null;
}

export interface ProductSearchResponse {
  status: "live" | ProductSearchCacheStatus;
  results: ProductSearchResult[];
}

export interface BestBuyProductSearchProvider extends ProductSearchProvider {
  searchProductsWithStatus(query: string, options?: ProductSearchOptions): Promise<ProductSearchResponse>;
}

function definedText(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return definedText(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

const SHOW_FIELDS = [
  "sku", "name", "manufacturer", "modelNumber",
  "categoryPath",
  "salePrice", "regularPrice",
  "image", "thumbnailImage",
  "url", "onlineAvailability",
  "customerReviewAverage", "customerReviewCount",
].join(",");

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value ?? Number.NaN)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value ?? DEFAULT_LIMIT)));
}

function moneyToCents(value: string | number | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value !== "string") return undefined;

  const parsed = Number(value.replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : undefined;
}

function searchTerms(query: string): string[] {
  return normalizeProductQuery(query)
    .split(" ")
    .map((term) => term.trim())
    .filter((term) => term.length > 1)
    .slice(0, 8);
}

/**
 * Build the full request URL using Best Buy's path-based search syntax:
 *   products(search=word1&search=word2&search=word3)?apiKey=...&format=json&...
 *
 * The URL string is constructed manually so that the `&` separators inside
 * the parenthesised search expression are never percent-encoded.
 */
function buildRequestUrl(
  baseUrl: string,
  query: string,
  apiKey: string,
  limit: number,
): { url: string; sanitizedUrl: string } {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const terms = searchTerms(query);

  const searchExpression =
    terms.length > 0
      ? `(${terms.map((t) => `search=${encodeURIComponent(t)}`).join("&")})`
      : "";

  const params = new URLSearchParams();
  params.set("apiKey", apiKey);
  params.set("format", "json");
  params.set("pageSize", String(limit));
  params.set("show", SHOW_FIELDS);

  const url = `${base}products${searchExpression}?${params.toString()}`;

  params.delete("apiKey");
  const sanitizedUrl = `${base}products${searchExpression}?${params.toString()}`;

  return { url, sanitizedUrl };
}

function categoryName(product: BestBuyProductRecord): string | undefined {
  const categoryPathName = product.categoryPath
    ?.map((entry) => definedText(entry.name))
    .filter((entry): entry is string => Boolean(entry))
    .at(-1);
  if (categoryPathName) return categoryPathName;

  if (typeof product.category === "string") return definedText(product.category);
  return definedText(product.category?.name);
}

function normalizeProduct(product: BestBuyProductRecord): ProductSearchResult | null {
  const title = textValue(product.name);
  if (!title) return null;

  return {
    source: "bestbuy",
    externalId: textValue(product.sku),
    title,
    brand: textValue(product.manufacturer) ?? textValue(product.brand),
    model: textValue(product.modelNumber),
    category: categoryName(product),
    imageUrl: textValue(product.image) ?? textValue(product.thumbnailImage),
    priceCents: moneyToCents(product.salePrice) ?? moneyToCents(product.regularPrice),
    currency: "USD",
    productUrl: textValue(product.url),
    condition: "new",
    seller: "Best Buy",
    hasCatalogRatings: false,
  };
}

function sanitizeResponseBody(body: string, apiKey: string): string {
  return body.slice(0, 1000).replaceAll(apiKey, "[REDACTED]");
}

export function createBestBuyProductSearchProvider(options: BestBuyProviderOptions = {}): BestBuyProductSearchProvider {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const useCache = options.useCache ?? true;

  async function searchProductsWithStatus(query: string, searchOptions?: ProductSearchOptions): Promise<ProductSearchResponse> {
    const apiKey = definedText(options.apiKey ?? env.BESTBUY_API_KEY);
    if (!apiKey) return { status: "live", results: [] };

    const normalizedQuery = normalizeProductQuery(query);
    if (!normalizedQuery) return { status: "live", results: [] };

    const cached = useCache ? await getCachedProductSearch("bestbuy", normalizedQuery) : null;
    if (cached?.status === "fresh") {
      return { status: "fresh", results: cached.results.slice(0, clampLimit(searchOptions?.limit)) };
    }

    const baseUrl = definedText(options.baseUrl ?? env.BESTBUY_API_BASE_URL) ?? DEFAULT_BASE_URL;
    const limit = clampLimit(searchOptions?.limit);
    const { url, sanitizedUrl } = buildRequestUrl(baseUrl, normalizedQuery, apiKey, limit);

    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
      });

      const contentType = response.headers.get("content-type") ?? "unknown";

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.warn("[BestBuy] HTTP error.", {
          sanitizedUrl,
          status: response.status,
          contentType,
          body: sanitizeResponseBody(body, apiKey),
        });
        if (useCache && !cached) await saveProductSearchCache("bestbuy", normalizedQuery, [], FAILED_TTL_MS, `HTTP ${response.status}`);
        return cached ? { status: "stale", results: cached.results.slice(0, limit) } : { status: "live", results: [] };
      }

      const rawText = await response.text();

      let payload: BestBuyProductsResponse;
      try {
        payload = JSON.parse(rawText) as BestBuyProductsResponse;
      } catch {
        console.warn("[BestBuy] Response is not valid JSON.", {
          sanitizedUrl,
          status: response.status,
          contentType,
          body: sanitizeResponseBody(rawText, apiKey),
        });
        if (useCache && !cached) await saveProductSearchCache("bestbuy", normalizedQuery, [], FAILED_TTL_MS, "invalid JSON");
        return cached ? { status: "stale", results: cached.results.slice(0, limit) } : { status: "live", results: [] };
      }

      if (!payload.products) {
        console.warn("[BestBuy] response.products missing.", {
          sanitizedUrl,
          status: response.status,
          topLevelKeys: Object.keys(payload),
          body: sanitizeResponseBody(rawText, apiKey),
        });
      }

      const results = (payload.products ?? [])
        .map(normalizeProduct)
        .filter((result): result is ProductSearchResult => Boolean(result))
        .slice(0, limit);

      if (results.length === 0) {
        console.warn("[BestBuy] 0 results.", {
          sanitizedUrl,
          status: response.status,
          contentType,
          body: sanitizeResponseBody(rawText, apiKey),
        });
      }

      if (useCache) {
        await saveProductSearchCache("bestbuy", normalizedQuery, results, results.length > 0 ? SUCCESS_TTL_MS : EMPTY_TTL_MS);
      }

      return { status: "live", results };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("[BestBuy] Fetch failed.", { sanitizedUrl, error: message });
      if (useCache && !cached) await saveProductSearchCache("bestbuy", normalizedQuery, [], FAILED_TTL_MS, message);
      return cached ? { status: "stale", results: cached.results.slice(0, limit) } : { status: "live", results: [] };
    }
  }

  return {
    name: "bestbuy",
    searchProductsWithStatus,
    async searchProducts(query: string, searchOptions?: ProductSearchOptions): Promise<ProductSearchResult[]> {
      const response = await searchProductsWithStatus(query, searchOptions);
      return response.results;
    },
  };
}

export const bestBuyProductSearchProvider = createBestBuyProductSearchProvider();
