"use client";

import { useEffect, useState } from "react";
import { DeviceTraitBars } from "./DeviceTraitBars";

interface CategoryOption {
  value: string;
  label: string;
}

interface DeviceAutocompleteProps {
  categories: readonly CategoryOption[];
  defaultCategory: string;
  defaultBrand?: string | null;
  defaultModel?: string | null;
  defaultExactModel?: string | null;
  defaultCatalogProductId?: string | null;
  defaultSpecsJson?: string | null;
}

type ProductSearchSource = "catalog" | "bestbuy" | "custom";

type ApiProductSearchResult = {
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
  hasCatalogRatings: boolean;
  precomputedTraits?: Record<string, unknown>;
  ergonomicSpecs?: Record<string, unknown>;
};

interface ProductSearchApiResponse {
  query: string;
  results?: ApiProductSearchResult[];
  providersUsed?: string[];
  cacheStatus?: "fresh" | "stale" | "miss" | "mixed";
  error?: string;
}

const inputClassName =
  "w-full rounded-[1.2rem] border border-ink/10 bg-mist/75 px-4 py-3 outline-none ring-moss/20 transition focus:border-moss/30 focus:ring-4";

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Gb$/, " GB")
    .replace(/^./, (value) => value.toUpperCase());
}

function formatSpecValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value && typeof value === "object") return "Imported";
  return String(value);
}

function resultLabel(result: ApiProductSearchResult): string {
  if (result.source === "custom") return "Add custom device";
  if (result.hasCatalogRatings) return "Rated";
  if (result.source === "bestbuy") return "Best Buy — not rated";
  return "Not rated";
}

function sourceLabel(result: ApiProductSearchResult): string {
  if (result.source === "catalog") return "Rated catalog";
  if (result.source === "bestbuy") return "Best Buy";
  return "Custom entry";
}

function formatPrice(result: ApiProductSearchResult): string | null {
  if (typeof result.priceCents !== "number" || !Number.isFinite(result.priceCents)) return null;
  const currency = result.currency ?? "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(result.priceCents / 100);
}

function resultDetails(result: ApiProductSearchResult): string {
  return [
    sourceLabel(result),
    result.category?.replaceAll("_", " "),
    result.condition,
  ]
    .filter(Boolean)
    .join(" · ");
}

function traitRatings(result?: ApiProductSearchResult): Record<string, number> {
  const source = result?.precomputedTraits;
  const nested =
    source && typeof source.traitRatings === "object" && source.traitRatings && !Array.isArray(source.traitRatings)
      ? (source.traitRatings as Record<string, unknown>)
      : source;

  return Object.fromEntries(
    Object.entries(nested ?? {}).filter(([, value]) => typeof value === "number" && Number.isFinite(value)),
  ) as Record<string, number>;
}

function topTraitBadges(result: ApiProductSearchResult, limit = 4): string[] {
  return Object.entries(traitRatings(result))
    .sort((left, right) => Number(right[1]) - Number(left[1]) || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, value]) => `${humanizeKey(key)} ${Math.round(value)}`);
}

function specsJson(result?: ApiProductSearchResult): string {
  return result?.hasCatalogRatings
    ? JSON.stringify({
        catalogDeviceId: result.deviceCatalogId,
        category: result.category,
        brand: result.brand,
        model: result.model,
        precomputedTraits: result.precomputedTraits,
        ergonomicSpecs: result.ergonomicSpecs,
      })
    : "";
}

function groupResults(results: ApiProductSearchResult[]): Record<ProductSearchSource, ApiProductSearchResult[]> {
  return {
    catalog: results.filter((result) => result.source === "catalog"),
    bestbuy: results.filter((result) => result.source === "bestbuy"),
    custom: results.filter((result) => result.source === "custom"),
  };
}

function parseBrandModel(result: ApiProductSearchResult): { brand: string; model: string } {
  if (result.brand || result.model) {
    return {
      brand: result.brand ?? "",
      model: result.model ?? result.title,
    };
  }

  return {
    brand: "",
    model: result.title,
  };
}

export function DeviceAutocomplete({
  categories,
  defaultCategory,
  defaultBrand,
  defaultModel,
  defaultExactModel,
  defaultCatalogProductId,
  defaultSpecsJson,
}: DeviceAutocompleteProps) {
  const [category, setCategory] = useState(defaultCategory);
  const [query, setQuery] = useState([defaultBrand, defaultModel].filter(Boolean).join(" "));
  const [brand, setBrand] = useState(defaultBrand ?? "");
  const [model, setModel] = useState(defaultModel ?? "");
  const [exactModel, setExactModel] = useState(defaultExactModel ?? "");
  const [selectedResult, setSelectedResult] = useState<ApiProductSearchResult | undefined>();
  const [catalogProductId, setCatalogProductId] = useState(defaultCatalogProductId ?? "");
  const [results, setResults] = useState<ApiProductSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [manualMode, setManualMode] = useState(!defaultCatalogProductId && Boolean(defaultBrand || defaultModel));

  const importedSpecsJson = selectedResult?.hasCatalogRatings ? specsJson(selectedResult) : (defaultSpecsJson ?? "");
  const submittedSpecsJson = catalogProductId ? importedSpecsJson : "";
  const importedSpecEntries: Array<[string, unknown]> = [];
  if (selectedResult?.hasCatalogRatings) {
    const rawEntries: Array<[string, unknown]> = [
      ["Category", selectedResult.category?.replaceAll("_", " ") ?? null],
      ["Brand", selectedResult.brand],
      ["Model", selectedResult.model],
      ["Price", formatPrice(selectedResult)],
    ];

    importedSpecEntries.push(
      ...rawEntries.filter((entry) => entry[1] !== undefined && entry[1] !== null && entry[1] !== ""),
    );
  }

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      setResults([]);
      setIsLoading(false);
      setErrorMessage(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({
        q: trimmedQuery,
      });

      setIsLoading(true);
      setErrorMessage(null);

      fetch(`/api/product-search?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = (await response.json()) as ProductSearchApiResponse;
          if (!response.ok) throw new Error(payload.error ?? "Could not search products.");
          return payload;
        })
        .then((payload) => {
          setResults(payload.results ?? []);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setResults([]);
          setErrorMessage(error instanceof Error ? error.message : "Could not search products.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  function selectResult(result: ApiProductSearchResult): void {
    const parsed = parseBrandModel(result);
    const isRated = result.hasCatalogRatings && Boolean(result.deviceCatalogId);

    setSelectedResult(result);
    setCatalogProductId(isRated ? (result.deviceCatalogId ?? "") : "");
    setManualMode(!isRated);
    setQuery(result.title);
    setBrand(parsed.brand);
    setModel(parsed.model);
    setExactModel(result.title);
    if (isRated && result.category) setCategory(result.category);
    setIsOpen(false);
  }

  function clearImportedDevice(): void {
    setSelectedResult(undefined);
    setCatalogProductId("");
  }

  function switchToManualEntry(): void {
    clearImportedDevice();
    setManualMode(true);
    setIsOpen(false);
    if (!model && query.trim()) setModel(query.trim());
    if (query.trim()) setExactModel(query.trim());
  }

  const groupedResults = groupResults(results);
  const hasOnlyCustomResults =
    groupedResults.catalog.length === 0 && groupedResults.bestbuy.length === 0 && groupedResults.custom.length > 0;
  const selectedSource = selectedResult?.source ?? (catalogProductId ? "catalog" : "custom");
  const selectedHasCatalogRatings = Boolean(selectedResult?.hasCatalogRatings || catalogProductId);
  const selectedRawProductTitle = selectedResult?.title ?? (exactModel || query);
  const selectedCondition = selectedResult?.condition ?? "";

  function renderResult(result: ApiProductSearchResult) {
    const badges = topTraitBadges(result, 3);
    const price = formatPrice(result);

    return (
      <button
        key={`${result.source}:${result.deviceCatalogId ?? result.externalId ?? result.title}`}
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectResult(result)}
        className="flex w-full gap-3 border-b border-ink/8 px-4 py-3 text-left transition last:border-b-0 hover:bg-mist"
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-mist text-[11px] font-semibold text-ink/45">
          {result.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={result.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            sourceLabel(result).slice(0, 2)
          )}
        </div>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{result.title}</span>
            <span className="rounded-full bg-mist px-2 py-0.5 text-[11px] font-semibold text-ink/55">
              {resultLabel(result)}
            </span>
          </span>
          <span className="mt-1 block text-xs text-ink/55">{resultDetails(result) || sourceLabel(result)}</span>
          {price ? <span className="mt-1 block text-xs font-semibold text-moss">{price}</span> : null}
          {badges.length > 0 ? (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {badges.map((badge) => (
                <span key={badge} className="rounded-full bg-mist px-2 py-1 text-[11px] font-semibold text-ink/58">
                  {badge}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
    );
  }

  function renderGroup(title: string, groupResults: ApiProductSearchResult[]) {
    if (groupResults.length === 0) return null;

    return (
      <>
        <div className="border-b border-ink/8 bg-mist/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/48">
          {title}
        </div>
        {groupResults.map(renderResult)}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2">
          <span className="text-sm font-medium text-ink/72">Category</span>
          <select
            name="category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setQuery("");
              clearImportedDevice();
            }}
            className={inputClassName}
            required
          >
            {categories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="relative space-y-2 md:col-span-2">
          <span className="text-sm font-medium text-ink/72">Device lookup</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setManualMode(false);
              clearImportedDevice();
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            className={inputClassName}
            placeholder="Try MBA M1, Dell 27 4K USB-C, MX Master 3S"
            autoComplete="off"
          />

          {isOpen && query.trim().length >= 2 ? (
            <div className="absolute z-20 mt-2 max-h-96 w-full overflow-y-auto rounded-[1.2rem] border border-ink/10 bg-white shadow-panel">
              {isLoading ? (
                <div className="px-4 py-3 text-sm font-medium text-ink/58">Searching devices...</div>
              ) : errorMessage ? (
                <div className="px-4 py-3 text-sm font-medium text-clay">{errorMessage}</div>
              ) : results.length === 0 ? (
                <div className="px-4 py-3 text-sm font-medium text-ink/58">
                  No matching devices found. You can still add this as a custom device.
                </div>
              ) : (
                <>
                  {hasOnlyCustomResults ? (
                    <div className="px-4 py-3 text-sm font-medium text-ink/58">
                      No rated catalog or Best Buy matches. You can add this as a custom device.
                    </div>
                  ) : null}
                  {renderGroup("Rated catalog", groupedResults.catalog)}
                  {renderGroup("Best Buy products", groupedResults.bestbuy)}
                  {renderGroup("Custom entry", groupedResults.custom)}
                </>
              )}
            </div>
          ) : null}
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-ink/72">Brand</span>
          <input
            name="brand"
            value={brand}
            onChange={(event) => {
              setBrand(event.target.value);
              clearImportedDevice();
              setManualMode(true);
            }}
            className={inputClassName}
            placeholder="Apple, Logitech, Herman Miller"
            required
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-ink/72">Model</span>
          <input
            name="model"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              clearImportedDevice();
              setManualMode(true);
            }}
            className={inputClassName}
            placeholder="MacBook Air M1, MX Master 3S"
            required
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-ink/72">Exact model/config</span>
          <input
            name="exactModel"
            value={exactModel}
            onChange={(event) => setExactModel(event.target.value)}
            className={inputClassName}
            placeholder="8GB RAM, 16GB/512GB, 27-inch 4K"
          />
        </label>
      </div>

      <input type="hidden" name="catalogProductId" value={catalogProductId} />
      <input type="hidden" name="specsJson" value={submittedSpecsJson} />
      <input type="hidden" name="productSearchSource" value={selectedSource} />
      <input type="hidden" name="rawProductTitle" value={selectedRawProductTitle} />
      <input type="hidden" name="hasCatalogRatings" value={String(selectedHasCatalogRatings)} />
      <input type="hidden" name="externalId" value={selectedResult?.externalId ?? ""} />
      <input type="hidden" name="productUrl" value={selectedResult?.productUrl ?? ""} />
      <input type="hidden" name="imageUrl" value={selectedResult?.imageUrl ?? ""} />
      <input type="hidden" name="priceCents" value={selectedResult?.priceCents ?? ""} />
      <input type="hidden" name="currency" value={selectedResult?.currency ?? ""} />
      <input type="hidden" name="productCondition" value={selectedCondition} />

      {!selectedResult ? (
        <button
          type="button"
          onClick={switchToManualEntry}
          className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink/70 transition hover:bg-mist"
        >
          I don&apos;t see my device
        </button>
      ) : null}

      {selectedResult && !selectedResult.hasCatalogRatings ? (
        <div className="rounded-[1.4rem] border border-dashed border-gold/30 bg-gold/8 p-4 text-sm leading-6 text-ink/62">
          {resultLabel(selectedResult)} filled the manual fields. This will save as a custom, unrated inventory item.
        </div>
      ) : manualMode && !selectedResult ? (
        <div className="rounded-[1.4rem] border border-dashed border-ink/14 bg-white p-4 text-sm leading-6 text-ink/62">
          Manual entry will still be scored, but exact device selection unlocks normalized specs, trait deltas, and better
          explanations.
        </div>
      ) : null}

      {selectedResult?.hasCatalogRatings ? (
        <div className="rounded-[1.4rem] border border-moss/18 bg-[#f3f8f4] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-moss">Device intelligence imported</p>
              <p className="mt-1 text-xs text-ink/52">
                {resultDetails(selectedResult) || "Catalog match selected"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {topTraitBadges(selectedResult, 4).map((badge) => (
                <span key={badge} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink/62">
                  {badge}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="flex flex-wrap gap-2">
              {importedSpecEntries.map(([key, value]) => (
                <span key={String(key)} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-ink/68">
                  {humanizeKey(key)}: {formatSpecValue(value)}
                </span>
              ))}
            </div>
            <DeviceTraitBars ratings={traitRatings(selectedResult)} compact />
          </div>
        </div>
      ) : null}
    </div>
  );
}
