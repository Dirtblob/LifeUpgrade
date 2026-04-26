import "server-only";

import { getCachedProductSearch, saveProductSearchCache } from "./cache";
import { normalizeProductQuery, type ProductSearchOptions, type ProductSearchProvider, type ProductSearchResult } from "./types";

const DEFAULT_BASE_URL = "https://api.upcitemdb.com/prod/trial";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 6 * 60 * 60 * 1000;
const FAILED_TTL_MS = 60 * 60 * 1000;

interface UpcitemdbProviderOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  env?: UpcitemdbProviderEnv;
}

interface UpcitemdbProviderEnv {
  NODE_ENV?: string;
}

interface UpcitemdbSearchResponse {
  items?: UpcitemdbItem[];
}

interface UpcitemdbOffer {
  link?: string | null;
}

interface UpcitemdbItem {
  ean?: string | number | null;
  upc?: string | number | null;
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  images?: unknown;
  offers?: UpcitemdbOffer[] | null;
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

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value ?? Number.NaN)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value ?? DEFAULT_LIMIT)));
}

function firstImageUrl(images: unknown): string | undefined {
  if (typeof images === "string") return definedText(images);
  if (!Array.isArray(images)) return undefined;

  return images.find((image): image is string => typeof image === "string" && image.trim().length > 0)?.trim();
}

function firstProductUrl(offers: UpcitemdbOffer[] | null | undefined): string | undefined {
  return offers?.map((offer) => definedText(offer.link)).find((link): link is string => Boolean(link));
}

function buildUrl(baseUrl: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("search", normalizedBaseUrl);
}

function normalizeItem(item: UpcitemdbItem): ProductSearchResult | null {
  const title = textValue(item.title);
  if (!title) return null;

  return {
    source: "upcitemdb",
    externalId: textValue(item.upc) ?? textValue(item.ean),
    title,
    brand: textValue(item.brand),
    model: textValue(item.model),
    category: textValue(item.category),
    imageUrl: firstImageUrl(item.images),
    productUrl: firstProductUrl(item.offers),
    hasCatalogRatings: false,
  };
}

function logDevelopmentFailure(
  message: string,
  details?: Record<string, string | number | undefined>,
  env: UpcitemdbProviderEnv = process.env,
): void {
  if (env.NODE_ENV !== "development") return;
  console.warn(message, details);
}

export function createUpcitemdbProductSearchProvider(options: UpcitemdbProviderOptions = {}): ProductSearchProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const env = options.env ?? process.env;

  return {
    name: "upcitemdb",
    async searchProducts(query: string, searchOptions?: ProductSearchOptions): Promise<ProductSearchResult[]> {
      const normalizedQuery = normalizeProductQuery(query);
      if (!normalizedQuery) return [];

      const limit = clampLimit(searchOptions?.limit);
      const cached = await getCachedProductSearch("upcitemdb", normalizedQuery);
      if (cached?.status === "fresh") return cached.results.slice(0, limit);

      const baseUrl = definedText(options.baseUrl) ?? DEFAULT_BASE_URL;
      const url = buildUrl(baseUrl);
      url.searchParams.set("s", normalizedQuery);
      url.searchParams.set("match_mode", "0");
      url.searchParams.set("type", "product");

      try {
        // UPCitemdb's free/trial endpoint has small request limits, so callers must cache results.
        // This provider is metadata discovery only and does not represent current availability.
        const response = await fetchImpl(url, {
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          logDevelopmentFailure("UPCitemdb product search failed.", { status: response.status }, env);
          if (!cached) await saveProductSearchCache("upcitemdb", normalizedQuery, [], FAILED_TTL_MS, `HTTP ${response.status}`);
          return cached ? cached.results.slice(0, limit) : [];
        }

        const payload = (await response.json()) as UpcitemdbSearchResponse;
        const results = (payload.items ?? [])
          .map(normalizeItem)
          .filter((result): result is ProductSearchResult => Boolean(result))
          .slice(0, limit);

        await saveProductSearchCache("upcitemdb", normalizedQuery, results, results.length > 0 ? SUCCESS_TTL_MS : EMPTY_TTL_MS);

        return results;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logDevelopmentFailure("UPCitemdb product search failed.", { error: message }, env);
        if (!cached) await saveProductSearchCache("upcitemdb", normalizedQuery, [], FAILED_TTL_MS, message);
        return cached ? cached.results.slice(0, limit) : [];
      }
    },
  };
}

export const upcitemdbProductSearchProvider = createUpcitemdbProductSearchProvider();
