import { describe, expect, it, vi } from "vitest";
import type { AvailabilityProductModel } from "./types";
import { createBestBuyProvider, type BestBuyProduct } from "./bestBuyProvider";

vi.mock("@/lib/mongodb", () => ({
  getMongoDatabase: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        }),
      }),
      updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    }),
  }),
}));

function product(overrides: Partial<AvailabilityProductModel> = {}): AvailabilityProductModel {
  return {
    id: "test-monitor",
    brand: "Dell",
    model: "U2723QE",
    displayName: "Dell U2723QE",
    category: "monitor",
    estimatedPriceCents: 45000,
    searchQueries: ["Dell U2723QE monitor"],
    deviceCatalogId: "dell-u2723qe",
    slug: "dell-u2723qe",
    ...overrides,
  };
}

function bestBuyProduct(overrides: Partial<BestBuyProduct> = {}): BestBuyProduct {
  return {
    sku: 6520415,
    name: "Dell - U2723QE 27\" USB-C Hub Monitor - Platinum Silver",
    manufacturer: "Dell",
    modelNumber: "U2723QE",
    salePrice: 419.99,
    regularPrice: 619.99,
    onlineAvailability: true,
    inStoreAvailability: false,
    url: "https://www.bestbuy.com/site/dell-u2723qe/6520415.p?skuId=6520415",
    image: "https://pisces.bbystatic.com/image2/BestBuy_US/images/products/dell-u2723qe.jpg",
    ...overrides,
  };
}

function mockFetch(products: BestBuyProduct[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({
      from: 1,
      to: products.length,
      total: products.length,
      currentPage: 1,
      totalPages: 1,
      products,
    }),
  });
}

describe("bestBuyProvider", () => {
  it("is disabled when BESTBUY_API_KEY is missing", () => {
    const provider = createBestBuyProvider({ apiKey: undefined });
    expect(provider).toBeNull();
  });

  it("searches Best Buy and returns normalized availability results", async () => {
    const fetchImpl = mockFetch([bestBuyProduct()]);
    const provider = createBestBuyProvider({
      apiKey: "test-key",
      fetchImpl,
    });
    expect(provider).not.toBeNull();

    const result = await provider!.search(product());

    expect(result.refreshSource).toBe("live");
    expect(result.listings.length).toBeGreaterThanOrEqual(1);

    const listing = result.listings[0];
    expect(listing.retailer).toBe("Best Buy");
    expect(listing.priceCents).toBe(41999);
    expect(listing.totalPriceCents).toBe(41999);
    expect(listing.available).toBe(true);
    expect(listing.condition).toBe("new");
    expect(listing.url).toContain("bestbuy.com");
    expect(listing.provider).toBe("bestbuy");
  });

  it("uses Best Buy SKUs before fuzzy search when a catalog SKU is present", async () => {
    const fetchImpl = mockFetch([bestBuyProduct()]);
    const provider = createBestBuyProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await provider!.search(product({ searchQueries: ["Best Buy SKU 6520415"] }));
    const requestedUrl = String(fetchImpl.mock.calls[0]?.[0]);

    expect(requestedUrl).toContain("/products(sku=6520415)");
    expect(result.listings[0]?.confidence).toBe(100);
  });

  it("filters out low-confidence results", async () => {
    const wrongProduct = bestBuyProduct({
      sku: 9999999,
      name: "HP Pavilion 24 All-in-One Desktop",
      manufacturer: "HP",
      modelNumber: "TP01-3035t",
    });
    const fetchImpl = mockFetch([wrongProduct]);
    const provider = createBestBuyProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await provider!.search(product());
    expect(result.listings.length).toBe(0);
  });

  it("returns empty results when API returns no products", async () => {
    const fetchImpl = mockFetch([]);
    const provider = createBestBuyProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await provider!.search(product());
    expect(result.listings.length).toBe(0);
  });

  it("handles API errors gracefully", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const provider = createBestBuyProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await provider!.search(product());
    expect(result.listings.length).toBe(0);
  });

  it("marks unavailable products correctly", async () => {
    const unavailable = bestBuyProduct({
      onlineAvailability: false,
      inStoreAvailability: false,
    });
    const fetchImpl = mockFetch([unavailable]);
    const provider = createBestBuyProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await provider!.search(product());
    expect(result.listings.length).toBeGreaterThanOrEqual(1);
    expect(result.listings[0].available).toBe(false);
  });
});
