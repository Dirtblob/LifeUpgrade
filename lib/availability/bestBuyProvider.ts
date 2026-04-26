import { scoreOfferConfidence, shouldRejectAvailabilityCandidate, compareAvailabilityResults } from "./offerMatcher";
import {
  findPriceSnapshot,
  normalizePriceSnapshotQuery,
  priceSnapshotToSearchResponse,
  writePriceSnapshot,
} from "./priceSnapshots";
import type { AvailabilityProductModel, AvailabilityProvider, AvailabilityResult, AvailabilitySearchResponse } from "./types";

const PROVIDER_NAME = "bestbuy";
const DEFAULT_BASE_URL = "https://api.bestbuy.com/v1";
const PAGE_SIZE = 15;
const MIN_CONFIDENCE = 60;

export interface BestBuyProduct {
  sku: number;
  name: string;
  manufacturer?: string;
  modelNumber?: string;
  upc?: string;
  salePrice: number;
  regularPrice?: number;
  onlineAvailability?: boolean;
  inStoreAvailability?: boolean;
  url?: string;
  image?: string;
  thumbnailImage?: string;
  condition?: string;
  categoryPath?: Array<{ id: string; name: string }>;
}

interface BestBuySearchResponse {
  from: number;
  to: number;
  currentPage: number;
  totalPages: number;
  total: number;
  products: BestBuyProduct[];
}

export interface BestBuyProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  forceRefresh?: boolean;
}

function definedText(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cacheSlug(productModel: AvailabilityProductModel): string | undefined {
  return definedText(productModel.slug) ?? definedText(productModel.deviceCatalogId) ?? definedText(productModel.id);
}

function buildSearchTerms(productModel: AvailabilityProductModel): string[] {
  const terms: string[] = [];

  if (definedText(productModel.brand) && definedText(productModel.model)) {
    terms.push(`${productModel.brand} ${productModel.model}`);
  }

  const displayQuery = `${productModel.displayName ?? productModel.id} ${productModel.category.replaceAll("_", " ")}`.trim();
  terms.push(displayQuery);

  for (const query of productModel.searchQueries ?? []) {
    if (definedText(query)) terms.push(query);
  }

  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = term.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function searchTokens(term: string): string[] {
  return term
    .replace(/[()&|]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function buildSearchFilter(term: string): string {
  const tokens = searchTokens(term).map((token) => encodeURIComponent(token));
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return `search=${tokens[0]}`;
  return tokens.map((token) => `(search=${token})`).join("&");
}

function getBestBuySku(productModel: AvailabilityProductModel): string | undefined {
  const directSku = definedText((productModel as AvailabilityProductModel & { bestBuySku?: string }).bestBuySku);
  const featureSku = (productModel as AvailabilityProductModel & { features?: { bestBuySku?: unknown } }).features?.bestBuySku;
  if (directSku) return directSku;
  if (typeof featureSku === "string") return definedText(featureSku);
  if (typeof featureSku === "number" && Number.isFinite(featureSku)) return String(featureSku);
  return undefined;
}

function buildSkuTerms(productModel: AvailabilityProductModel): string[] {
  const candidates = [
    getBestBuySku(productModel),
    ...(productModel.searchQueries ?? []).map((query) => /\bSKU\s+(\d{5,})\b/i.exec(query)?.[1]),
  ];

  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is string => {
    const key = candidate?.trim();
    if (!key || !/^\d+$/.test(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resultAliases(productModel: AvailabilityProductModel): string[] {
  return [
    productModel.displayName,
    productModel.model,
    ...(productModel.searchQueries ?? []),
  ].filter((value): value is string => Boolean(definedText(value)));
}

function scoreProduct(productModel: AvailabilityProductModel, product: BestBuyProduct): number {
  const title = product.name;
  if (shouldRejectAvailabilityCandidate(productModel, { title })) return 0;

  return scoreOfferConfidence(productModel, {
    title,
    brand: product.manufacturer,
    model: product.modelNumber,
    category: productModel.category,
    aliases: resultAliases(productModel),
  });
}

function toAvailabilityResult(
  productModel: AvailabilityProductModel,
  product: BestBuyProduct,
  confidence: number,
  checkedAt: Date,
): AvailabilityResult {
  const priceCents = Math.round(product.salePrice * 100);
  const available = product.onlineAvailability === true || product.inStoreAvailability === true;

  return {
    provider: PROVIDER_NAME,
    productModelId: productModel.id,
    title: product.name,
    brand: product.manufacturer ?? productModel.brand,
    model: product.modelNumber ?? productModel.model ?? productModel.displayName ?? productModel.id,
    retailer: "Best Buy",
    available,
    priceCents,
    shippingCents: 0,
    totalPriceCents: priceCents,
    condition: "new",
    url: product.url ?? `https://www.bestbuy.com/site/${product.sku}.p?skuId=${product.sku}`,
    imageUrl: product.image ?? product.thumbnailImage,
    confidence,
    checkedAt,
  };
}

async function fetchBestBuyProducts(
  term: string,
  options: { apiKey: string; baseUrl: string; fetchImpl: typeof fetch },
): Promise<BestBuyProduct[]> {
  const searchFilter = buildSearchFilter(term);
  if (!searchFilter) return [];

  const url = `${options.baseUrl}/products(${searchFilter})?apiKey=${options.apiKey}&format=json&show=sku,name,manufacturer,modelNumber,upc,salePrice,regularPrice,onlineAvailability,inStoreAvailability,url,image,thumbnailImage,condition&pageSize=${PAGE_SIZE}`;

  const response = await options.fetchImpl(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) return [];

  const payload = (await response.json()) as BestBuySearchResponse;
  return payload.products ?? [];
}

async function fetchBestBuyProductsBySku(
  sku: string,
  options: { apiKey: string; baseUrl: string; fetchImpl: typeof fetch },
): Promise<BestBuyProduct[]> {
  const url = `${options.baseUrl}/products(sku=${encodeURIComponent(sku)})?apiKey=${options.apiKey}&format=json&show=sku,name,manufacturer,modelNumber,upc,salePrice,regularPrice,onlineAvailability,inStoreAvailability,url,image,thumbnailImage,condition&pageSize=1`;

  const response = await options.fetchImpl(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) return [];

  const payload = (await response.json()) as BestBuySearchResponse;
  return payload.products ?? [];
}

export function isBestBuyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(definedText(env.BESTBUY_API_KEY));
}

export function createBestBuyProvider(options: BestBuyProviderOptions = {}): AvailabilityProvider | null {
  const apiKey = definedText(options.apiKey ?? process.env.BESTBUY_API_KEY);
  const baseUrl = definedText(options.baseUrl ?? process.env.BESTBUY_API_BASE_URL) ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const forceRefresh = options.forceRefresh ?? false;

  if (!apiKey) return null;

  return {
    name: PROVIDER_NAME,
    async search(productModel): Promise<AvailabilitySearchResponse> {
      const skuTerms = buildSkuTerms(productModel);
      const searchTerms = buildSearchTerms(productModel);
      const slug = cacheSlug(productModel);

      const cachedSnapshot = await findPriceSnapshot({
        slug,
        normalizedQueries: searchTerms.map(normalizePriceSnapshotQuery),
        provider: PROVIDER_NAME,
      });

      const hasFreshCache = cachedSnapshot ? cachedSnapshot.expiresAt.getTime() > Date.now() : false;
      if (cachedSnapshot && hasFreshCache && !forceRefresh) {
        return priceSnapshotToSearchResponse(productModel, cachedSnapshot, {
          refreshSource: "cached",
        });
      }

      for (const sku of skuTerms) {
        const checkedAt = new Date();

        let products: BestBuyProduct[];
        try {
          products = await fetchBestBuyProductsBySku(sku, { apiKey, baseUrl, fetchImpl });
        } catch {
          continue;
        }

        if (products.length === 0) continue;

        const listings = products
          .map((product) => toAvailabilityResult(productModel, product, 100, checkedAt))
          .sort(compareAvailabilityResults);

        await writePriceSnapshot({
          deviceCatalogId: productModel.deviceCatalogId,
          slug,
          query: `Best Buy SKU ${sku}`,
          normalizedQuery: normalizePriceSnapshotQuery(`Best Buy SKU ${sku}`),
          listings,
          fetchedAt: checkedAt,
          provider: PROVIDER_NAME,
        });

        return {
          listings,
          checkedAt,
          refreshSource: "live",
          isStale: false,
        };
      }

      for (const term of searchTerms) {
        const checkedAt = new Date();

        let products: BestBuyProduct[];
        try {
          products = await fetchBestBuyProducts(term, { apiKey, baseUrl, fetchImpl });
        } catch {
          continue;
        }

        if (products.length === 0) continue;

        const scored = products
          .map((product) => ({ product, confidence: scoreProduct(productModel, product) }))
          .filter((entry) => entry.confidence >= MIN_CONFIDENCE)
          .sort((a, b) => b.confidence - a.confidence);

        if (scored.length === 0) continue;

        const listings = scored
          .map(({ product, confidence }) => toAvailabilityResult(productModel, product, confidence, checkedAt))
          .sort(compareAvailabilityResults);

        const normalizedQuery = normalizePriceSnapshotQuery(term);
        await writePriceSnapshot({
          deviceCatalogId: productModel.deviceCatalogId,
          slug,
          query: term,
          normalizedQuery,
          listings,
          fetchedAt: checkedAt,
          provider: PROVIDER_NAME,
        });

        return {
          listings,
          checkedAt,
          refreshSource: "live",
          isStale: false,
        };
      }

      const checkedAt = new Date();
      if (searchTerms.length > 0) {
        await writePriceSnapshot({
          deviceCatalogId: productModel.deviceCatalogId,
          slug,
          query: searchTerms[0],
          normalizedQuery: normalizePriceSnapshotQuery(searchTerms[0]),
          listings: [],
          fetchedAt: checkedAt,
          error: "No matching Best Buy product found.",
          provider: PROVIDER_NAME,
        });
      }

      return cachedSnapshot
        ? priceSnapshotToSearchResponse(productModel, cachedSnapshot, {
            refreshSource: "cached",
            refreshSkippedReason: "cache_only",
          })
        : { listings: [], checkedAt, refreshSource: "live", isStale: false };
    },
  };
}

export function getBestBuyProvider(options: BestBuyProviderOptions = {}): AvailabilityProvider | null {
  return createBestBuyProvider(options);
}
