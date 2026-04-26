import { describe, expect, it, vi } from "vitest";
import { createBestBuyProductsProvider, isBestBuyProductsApiConfigured } from "./bestBuyProducts";

describe("Best Buy product discovery", () => {
  it("only configures when the server-side API key is present", () => {
    expect(isBestBuyProductsApiConfigured({})).toBe(false);
    expect(isBestBuyProductsApiConfigured({ BESTBUY_API_KEY: "secret" })).toBe(true);
  });

  it("searches Best Buy products without exposing credentials in results", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          products: [
            {
              sku: 12345,
              name: "Logitech MX Master 3S Wireless Mouse",
              manufacturer: "Logitech",
              modelNumber: "910-006556",
              salePrice: 99.99,
              regularPrice: 109.99,
              url: "https://www.bestbuy.com/site/example/12345.p",
              image: "https://img.example.test/mouse.jpg",
              onlineAvailability: true,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const provider = createBestBuyProductsProvider({
      apiKey: "server-secret",
      baseUrl: "https://api.bestbuy.example/v1",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const results = await provider?.search({ query: "MX Master", category: "mouse", limit: 4 });
    const fetchCalls = fetchMock.mock.calls as unknown as Array<Parameters<typeof fetch>>;
    const requestedUrl = String(fetchCalls[0]?.[0]);

    expect(requestedUrl).toContain("/v1/products(");
    expect(requestedUrl).toContain("apiKey=server-secret");
    expect(results).toEqual([
      {
        id: "bestbuy:12345",
        source: "bestbuy",
        retailer: "Best Buy",
        sku: "12345",
        name: "Logitech MX Master 3S Wireless Mouse",
        category: "mouse",
        brand: "Logitech",
        model: "910-006556",
        priceCents: 9999,
        url: "https://www.bestbuy.com/site/example/12345.p",
        imageUrl: "https://img.example.test/mouse.jpg",
        available: true,
      },
    ]);
    expect(JSON.stringify(results)).not.toContain("server-secret");
  });
});
