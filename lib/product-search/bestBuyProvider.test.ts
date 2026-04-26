import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBestBuyProductSearchProvider } from "./bestBuyProvider";

const { getCachedProductSearchMock, saveProductSearchCacheMock } = vi.hoisted(() => ({
  getCachedProductSearchMock: vi.fn(),
  saveProductSearchCacheMock: vi.fn(),
}));

vi.mock("./cache", () => ({
  getCachedProductSearch: getCachedProductSearchMock,
  saveProductSearchCache: saveProductSearchCacheMock,
}));

beforeEach(() => {
  getCachedProductSearchMock.mockReset().mockResolvedValue(null);
  saveProductSearchCacheMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Best Buy product search provider", () => {
  it("returns an empty result set when BESTBUY_API_KEY is missing", async () => {
    const fetchMock = vi.fn();
    const provider = createBestBuyProductSearchProvider({
      env: { NODE_ENV: "test" },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(provider.searchProducts("logitech mouse")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCachedProductSearchMock).not.toHaveBeenCalled();
  });

  it("normalizes Best Buy products into shared product search results", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          products: [
            {
              sku: 12345,
              name: "Logitech MX Master 3S Wireless Mouse",
              manufacturer: "Logitech",
              brand: "Logitech",
              modelNumber: "910-006556",
              categoryPath: [{ name: "Computers & Tablets" }, { name: "Computer Mice" }],
              salePrice: 99.99,
              regularPrice: 109.99,
              image: "https://img.example.test/mouse.jpg",
              url: "https://www.bestbuy.com/site/example/12345.p",
              ignoredLargeField: { shouldNotLeak: true },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = createBestBuyProductSearchProvider({
      env: { BESTBUY_API_KEY: "server-secret", NODE_ENV: "test" },
      fetchImpl: fetchMock as unknown as typeof fetch,
      baseUrl: "https://api.bestbuy.example/v1",
    });

    const results = await provider.searchProducts("  MX Master 3S  ", { limit: 50 });
    const firstCall = fetchMock.mock.calls[0] as unknown as Parameters<typeof fetch>;
    const requestedUrl = String(firstCall[0]);

    // Best Buy path syntax: products(search=word1&search=word2)
    expect(requestedUrl).toMatch(/products\(search=mx&search=master&search=3s\)\?/);
    expect(requestedUrl).toContain("apiKey=server-secret");
    expect(requestedUrl).toContain("format=json");
    expect(requestedUrl).toContain("pageSize=20");
    expect(results).toEqual([
      {
        source: "bestbuy",
        externalId: "12345",
        title: "Logitech MX Master 3S Wireless Mouse",
        brand: "Logitech",
        model: "910-006556",
        category: "Computer Mice",
        imageUrl: "https://img.example.test/mouse.jpg",
        priceCents: 9999,
        currency: "USD",
        productUrl: "https://www.bestbuy.com/site/example/12345.p",
        condition: "new",
        seller: "Best Buy",
        hasCatalogRatings: false,
      },
    ]);
    expect(JSON.stringify(results)).not.toContain("ignoredLargeField");
    expect(JSON.stringify(results)).not.toContain("server-secret");
    expect(saveProductSearchCacheMock).toHaveBeenCalledWith("bestbuy", "mx master 3s", results, 24 * 60 * 60 * 1000);
  });

  it("returns fresh cache without calling Best Buy", async () => {
    const cachedResult = {
      source: "bestbuy" as const,
      externalId: "cached-sku",
      title: "Cached Best Buy Product",
      hasCatalogRatings: false,
    };
    getCachedProductSearchMock.mockResolvedValue({
      status: "fresh",
      results: [cachedResult],
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    });
    const fetchMock = vi.fn();
    const provider = createBestBuyProductSearchProvider({
      env: { BESTBUY_API_KEY: "server-secret", NODE_ENV: "test" },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(provider.searchProducts("cached product")).resolves.toEqual([cachedResult]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can bypass cache for live script lookups", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ products: [] }), { status: 200 }));
    const provider = createBestBuyProductSearchProvider({
      env: { BESTBUY_API_KEY: "server-secret", NODE_ENV: "test" },
      fetchImpl: fetchMock as unknown as typeof fetch,
      useCache: false,
    });

    await expect(provider.searchProducts("uncached product")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getCachedProductSearchMock).not.toHaveBeenCalled();
    expect(saveProductSearchCacheMock).not.toHaveBeenCalled();
  });

  it("returns an empty result set and logs safely when requests fail", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = createBestBuyProductSearchProvider({
      env: { BESTBUY_API_KEY: "server-secret", NODE_ENV: "test" },
      fetchImpl: vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    });

    await expect(provider.searchProducts("webcam")).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "[BestBuy] HTTP error.",
      expect.objectContaining({ status: 500 }),
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("server-secret");
    expect(saveProductSearchCacheMock).toHaveBeenCalledWith("bestbuy", "webcam", [], 60 * 60 * 1000, "HTTP 500");
  });

  it("returns stale cache status when Best Buy fails after cache expiry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cachedResult = {
      source: "bestbuy" as const,
      externalId: "stale-sku",
      title: "Stale Best Buy Product",
      hasCatalogRatings: false,
    };
    getCachedProductSearchMock.mockResolvedValue({
      status: "stale",
      results: [cachedResult],
      fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const provider = createBestBuyProductSearchProvider({
      env: { BESTBUY_API_KEY: "server-secret", NODE_ENV: "test" },
      fetchImpl: vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    });

    await expect(provider.searchProductsWithStatus("stale product")).resolves.toEqual({
      status: "stale",
      results: [cachedResult],
    });
  });
});
