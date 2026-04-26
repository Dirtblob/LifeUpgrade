import "server-only";

import type { DeviceCategory } from "@/lib/devices/deviceTypes";

const DEFAULT_BASE_URL = "https://api.bestbuy.com/v1";
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 12;

const CATEGORY_SEARCH_HINTS: Partial<Record<DeviceCategory, string[]>> = {
  chair: ["chair"],
  desk_lamp: ["lamp"],
  docking_station: ["dock"],
  earbuds: ["earbuds"],
  headphones: ["headphones"],
  keyboard: ["keyboard"],
  laptop: ["laptop"],
  laptop_stand: ["laptop", "stand"],
  microphone: ["microphone"],
  monitor: ["monitor"],
  monitor_arm: ["monitor", "arm"],
  mouse: ["mouse"],
  router: ["router"],
  tablet: ["tablet"],
  webcam: ["webcam"],
};

interface BestBuyProductPayload {
  products?: BestBuyProductRecord[];
}

interface BestBuyProductRecord {
  sku?: string | number | null;
  name?: string | null;
  manufacturer?: string | null;
  modelNumber?: string | null;
  salePrice?: string | number | null;
  regularPrice?: string | number | null;
  url?: string | null;
  image?: string | null;
  onlineAvailability?: boolean | null;
  inStoreAvailability?: boolean | null;
}

interface BestBuyProductsProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface BestBuyProductsSearchInput {
  query: string;
  category?: string | null;
  limit?: number | null;
}

type BestBuyProductsEnv = {
  [key: string]: string | undefined;
  BESTBUY_API_KEY?: string;
};

export interface BestBuyDiscoveryProduct {
  id: string;
  source: "bestbuy";
  retailer: "Best Buy";
  sku: string;
  name: string;
  category: string;
  brand: string;
  model: string;
  priceCents: number | null;
  url: string | null;
  imageUrl: string | null;
  available: boolean;
}

export interface BestBuyProductsProvider {
  name: "bestbuy";
  search(input: BestBuyProductsSearchInput): Promise<BestBuyDiscoveryProduct[]>;
}

function definedText(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function clampLimit(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? Number.NaN)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value ?? DEFAULT_LIMIT)));
}

function moneyToCents(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value !== "string") return null;

  const parsed = Number(value.replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function buildUrl(baseUrl: string, path: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), normalizedBaseUrl);
}

function searchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function categoryHints(category: string | null | undefined): string[] {
  return category && category in CATEGORY_SEARCH_HINTS ? CATEGORY_SEARCH_HINTS[category as DeviceCategory] ?? [] : [];
}

function buildSearchTerms(query: string, category: string | null | undefined): string[] {
  const seen = new Set<string>();
  return [...searchTokens(query), ...categoryHints(category)]
    .filter((term) => {
      if (seen.has(term)) return false;
      seen.add(term);
      return true;
    })
    .slice(0, 8);
}

function bestBuyProductsPath(terms: string[]): string {
  if (terms.length === 0) return "/products";

  const searchClauses = terms.map((term) => `(search=${encodeURIComponent(term)})`).join("&");
  return `/products(${searchClauses})`;
}

function deriveModel(name: string, brand: string, modelNumber: string | null): string {
  if (modelNumber) return modelNumber;

  const withoutBrand = name.replace(new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), "").trim();
  return withoutBrand || name;
}

function normalizeProduct(product: BestBuyProductRecord, category: string | null | undefined): BestBuyDiscoveryProduct | null {
  const sku = textValue(product.sku);
  const name = textValue(product.name);
  const brand = textValue(product.manufacturer) ?? "Best Buy";

  if (!sku || !name) return null;

  const priceCents = moneyToCents(product.salePrice) ?? moneyToCents(product.regularPrice);
  return {
    id: `bestbuy:${sku}`,
    source: "bestbuy",
    retailer: "Best Buy",
    sku,
    name,
    category: category?.trim() || "other",
    brand,
    model: deriveModel(name, brand, textValue(product.modelNumber)),
    priceCents,
    url: textValue(product.url),
    imageUrl: textValue(product.image),
    available: product.onlineAvailability !== false || product.inStoreAvailability === true,
  };
}

export function isBestBuyProductsApiConfigured(env: BestBuyProductsEnv = process.env as BestBuyProductsEnv): boolean {
  return Boolean(definedText(env.BESTBUY_API_KEY));
}

export function createBestBuyProductsProvider(options: BestBuyProductsProviderOptions = {}): BestBuyProductsProvider | null {
  const apiKey = definedText(options.apiKey ?? process.env.BESTBUY_API_KEY);
  const baseUrl = definedText(options.baseUrl ?? process.env.BESTBUY_API_BASE_URL) ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!apiKey) return null;

  return {
    name: "bestbuy",
    async search(input) {
      const terms = buildSearchTerms(input.query, input.category);
      if (terms.length === 0) return [];

      const url = buildUrl(baseUrl, bestBuyProductsPath(terms));
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("format", "json");
      url.searchParams.set("pageSize", String(clampLimit(input.limit)));
      url.searchParams.set("show", "sku,name,manufacturer,modelNumber,salePrice,regularPrice,url,image,onlineAvailability,inStoreAvailability");

      try {
        const response = await fetchImpl(url, {
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) return [];

        const payload = (await response.json()) as BestBuyProductPayload;
        const seen = new Set<string>();
        return (payload.products ?? [])
          .map((product) => normalizeProduct(product, input.category))
          .filter((product): product is BestBuyDiscoveryProduct => {
            if (!product || seen.has(product.sku)) return false;
            seen.add(product.sku);
            return true;
          });
      } catch {
        return [];
      }
    },
  };
}

export async function searchBestBuyProducts(
  input: BestBuyProductsSearchInput,
  options: BestBuyProductsProviderOptions = {},
): Promise<BestBuyDiscoveryProduct[]> {
  const provider = createBestBuyProductsProvider(options);
  return provider ? provider.search(input) : [];
}
