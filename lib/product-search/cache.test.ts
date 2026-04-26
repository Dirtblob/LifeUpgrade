import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCachedProductSearch, saveProductSearchCache } from "./cache";
import type { ProductSearchResult } from "./types";

const { collectionMock, getMongoDatabaseMock } = vi.hoisted(() => ({
  collectionMock: {
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
  getMongoDatabaseMock: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoDatabase: getMongoDatabaseMock,
}));

const sampleResult: ProductSearchResult = {
  source: "bestbuy",
  externalId: "123",
  title: "Sample Product",
  hasCatalogRatings: false,
};

beforeEach(() => {
  vi.useRealTimers();
  collectionMock.findOne.mockReset();
  collectionMock.updateOne.mockReset().mockResolvedValue(undefined);
  getMongoDatabaseMock.mockReset().mockResolvedValue({
    collection: vi.fn(() => collectionMock),
  });
});

describe("product search cache", () => {
  it("returns fresh cache hits by normalized query and provider", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T12:00:00Z"));
    collectionMock.findOne.mockResolvedValue({
      provider: "bestbuy",
      query: "Sample Product",
      normalizedQuery: "sample product",
      results: [sampleResult],
      fetchedAt: new Date("2026-04-25T11:00:00Z"),
      expiresAt: new Date("2026-04-26T11:00:00Z"),
      createdAt: new Date("2026-04-25T11:00:00Z"),
      updatedAt: new Date("2026-04-25T11:00:00Z"),
    });

    await expect(getCachedProductSearch("BestBuy", "  Sample   Product  ")).resolves.toMatchObject({
      status: "fresh",
      results: [sampleResult],
    });
    expect(collectionMock.findOne).toHaveBeenCalledWith(
      {
        provider: "bestbuy",
        normalizedQuery: "sample product",
      },
      {
        sort: { expiresAt: -1, fetchedAt: -1 },
      },
    );
  });

  it("returns stale cache hits when expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T12:00:00Z"));
    collectionMock.findOne.mockResolvedValue({
      provider: "bestbuy",
      query: "Sample Product",
      normalizedQuery: "sample product",
      results: [sampleResult],
      fetchedAt: new Date("2026-04-24T11:00:00Z"),
      expiresAt: new Date("2026-04-24T12:00:00Z"),
      createdAt: new Date("2026-04-24T11:00:00Z"),
      updatedAt: new Date("2026-04-24T11:00:00Z"),
    });

    await expect(getCachedProductSearch("bestbuy", "Sample Product")).resolves.toMatchObject({
      status: "stale",
      results: [sampleResult],
    });
  });

  it("upserts normalized cached results without raw external payloads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T12:00:00Z"));

    await saveProductSearchCache("BestBuy", " Sample Product ", [sampleResult], 60 * 60 * 1000);

    expect(collectionMock.updateOne).toHaveBeenCalledWith(
      {
        provider: "bestbuy",
        normalizedQuery: "sample product",
      },
      {
        $set: {
          query: " Sample Product ",
          normalizedQuery: "sample product",
          provider: "bestbuy",
          results: [sampleResult],
          fetchedAt: new Date("2026-04-25T12:00:00Z"),
          expiresAt: new Date("2026-04-25T13:00:00Z"),
          updatedAt: new Date("2026-04-25T12:00:00Z"),
          error: undefined,
        },
        $setOnInsert: {
          createdAt: new Date("2026-04-25T12:00:00Z"),
        },
      },
      { upsert: true },
    );
  });
});
