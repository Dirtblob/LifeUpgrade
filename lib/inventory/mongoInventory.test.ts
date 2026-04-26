import { describe, expect, it } from "vitest";
import { validateInventoryCreateInput } from "./mongoInventory";

describe("Mongo inventory validation", () => {
  it("accepts rated catalog inventory with catalog metadata", () => {
    const result = validateInventoryCreateInput({
      category: "mouse",
      brand: "Logitech",
      model: "MX Master 3S",
      exactModel: "Logitech MX Master 3S",
      catalogProductId: "catalog-mouse-1",
      deviceCatalogId: "catalog-mouse-1",
      hasCatalogRatings: true,
      specs: {
        traitRatings: { ergonomics: 90 },
      },
      condition: "GOOD",
      ageYears: null,
      notes: null,
      source: "catalog",
    });

    expect(result.errors).toEqual({});
    expect(result.data).toMatchObject({
      catalogProductId: "catalog-mouse-1",
      deviceCatalogId: "catalog-mouse-1",
      brand: "Logitech",
      model: "MX Master 3S",
      category: "mouse",
      hasCatalogRatings: true,
      source: "catalog",
    });
  });

  it("accepts Best Buy inventory without catalog specs or ratings", () => {
    const result = validateInventoryCreateInput({
      category: "mouse",
      brand: "Logitech",
      model: "910-006556",
      exactModel: "Logitech MX Master 3S Wireless Mouse",
      catalogProductId: null,
      deviceCatalogId: null,
      rawProductTitle: "Logitech MX Master 3S Wireless Mouse",
      source: "bestbuy",
      externalId: "12345",
      productUrl: "https://www.bestbuy.com/site/example/12345.p",
      imageUrl: "https://img.example.test/mouse.jpg",
      priceCents: 9999,
      currency: "USD",
      productCondition: "new",
      hasCatalogRatings: false,
      specs: null,
      condition: "UNKNOWN",
      ageYears: null,
      notes: null,
    });

    expect(result.errors).toEqual({});
    expect(result.data).toMatchObject({
      catalogProductId: null,
      rawProductTitle: "Logitech MX Master 3S Wireless Mouse",
      source: "bestbuy",
      externalId: "12345",
      productUrl: "https://www.bestbuy.com/site/example/12345.p",
      imageUrl: "https://img.example.test/mouse.jpg",
      priceCents: 9999,
      currency: "USD",
      productCondition: "new",
      hasCatalogRatings: false,
      specs: null,
    });
  });

  it("accepts free-text custom inventory without specsJson", () => {
    const result = validateInventoryCreateInput({
      category: "other",
      brand: null,
      model: null,
      exactModel: null,
      catalogProductId: null,
      rawProductTitle: "My old desk gadget",
      source: "custom",
      hasCatalogRatings: false,
      condition: "UNKNOWN",
      ageYears: null,
      notes: null,
    });

    expect(result.errors).toEqual({});
    expect(result.data).toMatchObject({
      catalogProductId: null,
      rawProductTitle: "My old desk gadget",
      source: "custom",
      hasCatalogRatings: false,
      specs: null,
    });
  });
});
