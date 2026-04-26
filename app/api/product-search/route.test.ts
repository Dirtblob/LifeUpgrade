import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ProductSearchResponse } from "@/lib/product-search/bestBuyProvider";

const { searchMongoDevicesMock, getCachedProductSearchMock, searchProductsWithStatusMock } = vi.hoisted(() => ({
  searchMongoDevicesMock: vi.fn(),
  getCachedProductSearchMock: vi.fn(),
  searchProductsWithStatusMock: vi.fn(),
}));

vi.mock("@/lib/devices/mongoDeviceCatalog", () => ({
  searchMongoDevices: searchMongoDevicesMock,
}));

vi.mock("@/lib/product-search/cache", () => ({
  getCachedProductSearch: getCachedProductSearchMock,
}));

vi.mock("@/lib/product-search/bestBuyProvider", () => ({
  bestBuyProductSearchProvider: {
    searchProductsWithStatus: searchProductsWithStatusMock,
  },
}));

function catalogDevice(overrides: Record<string, unknown> = {}) {
  return {
    _id: "catalog-mouse-1",
    id: "mouse-logitech-mx-master-3s",
    brand: "Logitech",
    model: "MX Master 3S",
    variant: null,
    displayName: "Logitech MX Master 3S",
    category: "mouse",
    estimatedPriceCents: 9999,
    traitRatings: { ergonomics: 90 },
    traitConfidence: 86,
    strengths: ["Comfortable for long sessions"],
    weaknesses: [],
    normalizedSpecs: { wireless: true },
    ergonomicSpecs: { category: "mouse", weightGrams: 141 },
    ...overrides,
  };
}

describe("/api/product-search", () => {
  beforeEach(() => {
    searchMongoDevicesMock.mockReset().mockResolvedValue([]);
    getCachedProductSearchMock.mockReset().mockResolvedValue(null);
    searchProductsWithStatusMock.mockReset().mockResolvedValue({
      status: "live",
      results: [],
    } satisfies ProductSearchResponse);
  });

  it("returns empty results for missing or too-short queries", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/product-search?q=x"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      query: "x",
      results: [],
      providersUsed: [],
      cacheStatus: "miss",
    });
    expect(searchMongoDevicesMock).not.toHaveBeenCalled();
    expect(getCachedProductSearchMock).not.toHaveBeenCalled();
    expect(searchProductsWithStatusMock).not.toHaveBeenCalled();
  });

  it("returns catalog results before fresh cached Best Buy results and a custom fallback", async () => {
    searchMongoDevicesMock.mockResolvedValue([catalogDevice()]);
    getCachedProductSearchMock.mockResolvedValue({
      status: "fresh",
      results: [
        {
          source: "bestbuy",
          externalId: "sku-123",
          title: "Logitech MX Master 3S Wireless Mouse",
          brand: "Logitech",
          model: "910-006556",
          category: "Computer Mice",
          imageUrl: "https://img.example.test/mouse.jpg",
          priceCents: 9999,
          currency: "USD",
          condition: "new",
          productUrl: "https://www.bestbuy.com/site/example/sku-123.p",
          seller: "Best Buy",
          hasCatalogRatings: false,
        },
      ],
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    });

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/product-search?q=mx%20master"));
    const payload = await response.json();

    expect(payload.cacheStatus).toBe("fresh");
    expect(payload.providersUsed).toEqual(["catalog", "bestbuy", "custom"]);
    expect(payload.results.map((result: { source: string }) => result.source)).toEqual(["catalog", "bestbuy", "custom"]);
    expect(payload.results[0]).toMatchObject({
      source: "catalog",
      deviceCatalogId: "catalog-mouse-1",
      hasCatalogRatings: true,
      precomputedTraits: {
        traitRatings: { ergonomics: 90 },
      },
      ergonomicSpecs: { category: "mouse", weightGrams: 141 },
    });
    expect(payload.results[1]).toMatchObject({
      source: "bestbuy",
      externalId: "sku-123",
      hasCatalogRatings: false,
    });
    expect(payload.results[1]).not.toHaveProperty("seller");
    expect(searchProductsWithStatusMock).not.toHaveBeenCalled();
  });

  it("calls Best Buy provider when no fresh cache exists and query has at least three characters", async () => {
    searchProductsWithStatusMock.mockResolvedValue({
      status: "live",
      results: [
        {
          source: "bestbuy",
          externalId: "sku-456",
          title: "Best Buy Webcam",
          brand: "Logitech",
          hasCatalogRatings: false,
        },
      ],
    } satisfies ProductSearchResponse);

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/product-search?q=webcam"));
    const payload = await response.json();

    expect(getCachedProductSearchMock).toHaveBeenCalledWith("bestbuy", "webcam");
    expect(searchProductsWithStatusMock).toHaveBeenCalledWith("webcam", { limit: 10 });
    expect(payload.cacheStatus).toBe("miss");
    expect(payload.results.map((result: { source: string }) => result.source)).toEqual(["bestbuy", "custom"]);
  });

  it("returns stale cached Best Buy results when the provider fails after cache expiry", async () => {
    getCachedProductSearchMock.mockResolvedValue({
      status: "stale",
      results: [
        {
          source: "bestbuy",
          externalId: "stale-sku",
          title: "Stale Best Buy Product",
          hasCatalogRatings: false,
        },
      ],
      fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    searchProductsWithStatusMock.mockRejectedValue(new Error("network failed"));

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/product-search?q=monitor"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.cacheStatus).toBe("stale");
    expect(payload.results.map((result: { source: string }) => result.source)).toEqual(["bestbuy", "custom"]);
  });

  it("returns partial catalog and custom results when Best Buy fails with no cache", async () => {
    searchMongoDevicesMock.mockResolvedValue([catalogDevice()]);
    searchProductsWithStatusMock.mockRejectedValue(new Error("network failed"));

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/product-search?q=keyboard"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.cacheStatus).toBe("miss");
    expect(payload.results.map((result: { source: string }) => result.source)).toEqual(["catalog", "custom"]);
  });
});
