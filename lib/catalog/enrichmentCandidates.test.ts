import { beforeEach, describe, expect, it, vi } from "vitest";
import { listPendingCatalogEnrichmentCandidates, upsertCatalogEnrichmentCandidate } from "./enrichmentCandidates";

const { collectionMock, getMongoDatabaseMock } = vi.hoisted(() => ({
  collectionMock: {
    find: vi.fn(),
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
  getMongoDatabaseMock: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoDatabase: getMongoDatabaseMock,
}));

beforeEach(() => {
  vi.useRealTimers();
  collectionMock.find.mockReset();
  collectionMock.findOne.mockReset().mockResolvedValue(null);
  collectionMock.updateOne.mockReset().mockResolvedValue(undefined);
  getMongoDatabaseMock.mockReset().mockResolvedValue({
    collection: vi.fn(() => collectionMock),
  });
});

describe("catalog enrichment candidates", () => {
  it("upserts a new pending candidate by normalized title", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T12:00:00Z"));

    await upsertCatalogEnrichmentCandidate({
      title: "  Logitech MX Master 3S Wireless Mouse  ",
      brand: "Logitech",
      model: "MX Master 3S",
      category: "mouse",
      source: "bestbuy",
      externalId: "12345",
      productUrl: "https://www.bestbuy.com/site/example/12345.p",
      imageUrl: "https://img.example.test/mouse.jpg",
    });

    expect(collectionMock.findOne).toHaveBeenCalledWith({
      $or: [
        { source: "bestbuy", externalId: "12345" },
        { normalizedTitle: "logitech mx master 3s wireless mouse" },
      ],
    });
    expect(collectionMock.updateOne).toHaveBeenCalledWith(
      { _id: expect.any(Object) },
      {
        $set: {
          normalizedTitle: "logitech mx master 3s wireless mouse",
          brand: "Logitech",
          model: "MX Master 3S",
          category: "mouse",
          source: "bestbuy",
          externalId: "12345",
          productUrl: "https://www.bestbuy.com/site/example/12345.p",
          imageUrl: "https://img.example.test/mouse.jpg",
          lastSeenAt: new Date("2026-04-25T12:00:00Z"),
        },
        $setOnInsert: {
          seenCount: 0,
          firstSeenAt: new Date("2026-04-25T12:00:00Z"),
          status: "pending",
        },
        $inc: {
          seenCount: 1,
        },
      },
      { upsert: true },
    );
  });

  it("increments an existing candidate matched by source and external id", async () => {
    const existing = {
      _id: "candidate-1",
      normalizedTitle: "old title",
      source: "bestbuy",
      externalId: "12345",
    };
    collectionMock.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce({ ...existing, seenCount: 4 });

    await upsertCatalogEnrichmentCandidate({
      title: "Logitech MX Master 3S",
      source: "bestbuy",
      externalId: "12345",
    });

    expect(collectionMock.updateOne).toHaveBeenCalledWith(
      { _id: "candidate-1" },
      expect.objectContaining({
        $inc: { seenCount: 1 },
      }),
    );
  });

  it("lists top pending candidates by seen count and recency", async () => {
    const toArrayMock = vi.fn().mockResolvedValue([]);
    const limitMock = vi.fn(() => ({ toArray: toArrayMock }));
    const sortMock = vi.fn(() => ({ limit: limitMock }));
    collectionMock.find.mockReturnValue({ sort: sortMock });

    await expect(listPendingCatalogEnrichmentCandidates(500)).resolves.toEqual([]);
    expect(collectionMock.find).toHaveBeenCalledWith({ status: "pending" });
    expect(sortMock).toHaveBeenCalledWith({ seenCount: -1, lastSeenAt: -1 });
    expect(limitMock).toHaveBeenCalledWith(200);
  });
});
