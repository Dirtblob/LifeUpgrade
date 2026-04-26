export type ProductSearchSource = "catalog" | "bestbuy" | "upcitemdb" | "pricesapi" | "ebay" | "custom";

export interface ProductSearchResult {
  id?: string;
  deviceCatalogId?: string;
  source: ProductSearchSource;
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
  seller?: string;
  hasCatalogRatings: boolean;
  precomputedTraits?: Record<string, unknown>;
  ergonomicSpecs?: Record<string, unknown>;
  rawSource?: Record<string, string | number | boolean | null | undefined>;
}

export interface ProductSearchOptions {
  category?: string;
  limit?: number;
  sources?: ProductSearchSource[];
}

export interface ProductSearchProvider {
  name: string;
  searchProducts(query: string, options?: ProductSearchOptions): Promise<ProductSearchResult[]>;
}

export function normalizeProductQuery(query: string): string {
  return normalizeSearchText(query);
}

export function normalizeTitle(title: string): string {
  return normalizeSearchText(title);
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[''"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function definedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resultDedupeKey(result: ProductSearchResult): string {
  const deviceCatalogId = definedText(result.deviceCatalogId);
  if (deviceCatalogId) return `catalog:${deviceCatalogId.toLowerCase()}`;

  const externalId = definedText(result.externalId ?? result.id);
  if (externalId) return `${result.source}:${externalId.toLowerCase()}`;

  return [
    result.source,
    normalizeTitle(result.title),
    normalizeSearchText(result.brand ?? ""),
    normalizeSearchText(result.model ?? ""),
    normalizeSearchText(result.category ?? ""),
    normalizeSearchText(result.seller ?? ""),
  ].join("|");
}

function resultRank(result: ProductSearchResult): number {
  return (
    (result.hasCatalogRatings ? 100 : 0) +
    (definedText(result.deviceCatalogId) ? 40 : 0) +
    (definedText(result.externalId ?? result.id) ? 20 : 0) +
    (typeof result.priceCents === "number" && Number.isFinite(result.priceCents) ? 10 : 0) +
    (definedText(result.imageUrl) ? 5 : 0) +
    (definedText(result.productUrl) ? 5 : 0)
  );
}

export function dedupeProductSearchResults(results: ProductSearchResult[]): ProductSearchResult[] {
  const deduped = new Map<string, ProductSearchResult>();

  for (const result of results) {
    const key = resultDedupeKey(result);
    const existing = deduped.get(key);

    if (!existing || resultRank(result) > resultRank(existing)) {
      deduped.set(key, result);
    }
  }

  return Array.from(deduped.values());
}
