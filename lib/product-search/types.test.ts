import { describe, expect, it } from "vitest";
import { dedupeProductSearchResults, normalizeProductQuery, normalizeTitle, type ProductSearchResult } from "./types";

function result(overrides: Partial<ProductSearchResult>): ProductSearchResult {
  return {
    source: "custom",
    title: "Untitled product",
    hasCatalogRatings: false,
    ...overrides,
  };
}

describe("product search types helpers", () => {
  it("normalizes product queries and titles consistently", () => {
    expect(normalizeProductQuery("  Logitech MX Master 3S & Mac  ")).toBe("logitech mx master 3s and mac");
    expect(normalizeTitle("Dell UltraSharp 27\" 4K USB-C Monitor")).toBe("dell ultrasharp 27 4k usb c monitor");
  });

  it("dedupes by catalog ids before source-specific ids", () => {
    const lowSignal = result({
      source: "catalog",
      deviceCatalogId: "mouse-logitech-mx-master-3s",
      title: "MX Master 3S",
      hasCatalogRatings: true,
    });
    const richer = result({
      source: "catalog",
      deviceCatalogId: "mouse-logitech-mx-master-3s",
      title: "Logitech MX Master 3S",
      imageUrl: "https://example.test/mouse.jpg",
      productUrl: "https://example.test/mouse",
      priceCents: 9999,
      hasCatalogRatings: true,
    });

    expect(dedupeProductSearchResults([lowSignal, richer])).toEqual([richer]);
  });

  it("dedupes by provider external ids when no catalog id exists", () => {
    const first = result({
      source: "bestbuy",
      externalId: "123",
      title: "Logitech MX Master 3S",
      hasCatalogRatings: false,
    });
    const second = result({
      source: "bestbuy",
      externalId: "123",
      title: "Logitech MX Master 3S Wireless Mouse",
      productUrl: "https://www.bestbuy.com/site/example/123.p",
      hasCatalogRatings: false,
    });

    expect(dedupeProductSearchResults([first, second])).toEqual([second]);
  });
});
