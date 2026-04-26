import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUpcitemdbProductSearchProvider } from "./upcitemdbProvider";

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

describe("UPCitemdb product search provider", () => {
  it("searches the free trial endpoint without an API key and normalizes metadata", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              upc: "097855174703",
              ean: "0097855174703",
              title: "Logitech MX Master 3S Wireless Mouse",
              brand: "Logitech",
              model: "MX Master 3S",
              category: "Computer Mouse",
              images: ["https://img.example.test/mouse.jpg"],
              offers: [{ link: "https://example.test/product" }],
              lowest_recorded_price: 79.99,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = createUpcitemdbProductSearchProvider({
      baseUrl: "https://api.upcitemdb.example/prod/trial",
      fetchImpl: fetchMock as unknown as typeof fetch,
      env: { NODE_ENV: "test" },
    });

    const results = await provider.searchProducts("MX Master 3S");
    const firstCall = fetchMock.mock.calls[0] as unknown as Parameters<typeof fetch>;
    const requestedUrl = String(firstCall[0]);

    expect(requestedUrl).toContain("/prod/trial/search");
    expect(requestedUrl).toContain("s=mx+master+3s");
    expect(requestedUrl).not.toContain("apiKey");
    expect(results).toEqual([
      {
        source: "upcitemdb",
        externalId: "097855174703",
        title: "Logitech MX Master 3S Wireless Mouse",
        brand: "Logitech",
        model: "MX Master 3S",
        category: "Computer Mouse",
        imageUrl: "https://img.example.test/mouse.jpg",
        productUrl: "https://example.test/product",
        hasCatalogRatings: false,
      },
    ]);
    expect(JSON.stringify(results)).not.toContain("lowest_recorded_price");
    expect(saveProductSearchCacheMock).toHaveBeenCalledWith("upcitemdb", "mx master 3s", results, 24 * 60 * 60 * 1000);
  });

  it("limits results to five by default", async () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      upc: `upc-${index}`,
      title: `Product ${index}`,
    }));
    const provider = createUpcitemdbProductSearchProvider({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ items }), { status: 200 })) as unknown as typeof fetch,
    });

    await expect(provider.searchProducts("product")).resolves.toHaveLength(5);
  });

  it("returns cached metadata without calling UPCitemdb when cache is fresh", async () => {
    const cachedResult = {
      source: "upcitemdb" as const,
      externalId: "cached-upc",
      title: "Cached UPCitemdb Product",
      hasCatalogRatings: false,
    };
    getCachedProductSearchMock.mockResolvedValue({
      status: "fresh",
      results: [cachedResult],
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    });
    const fetchMock = vi.fn();
    const provider = createUpcitemdbProductSearchProvider({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(provider.searchProducts("cached product")).resolves.toEqual([cachedResult]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty result set safely when requests fail", async () => {
    const provider = createUpcitemdbProductSearchProvider({
      fetchImpl: vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    });

    await expect(provider.searchProducts("webcam")).resolves.toEqual([]);
    expect(saveProductSearchCacheMock).toHaveBeenCalledWith("upcitemdb", "webcam", [], 60 * 60 * 1000, "HTTP 500");
  });
});
