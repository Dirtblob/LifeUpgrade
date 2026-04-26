import { describe, expect, it } from "vitest";
import { availabilityDetailMessages, getAvailabilityStatusBadge } from "./display";
import type { AvailabilitySummary } from "./types";

function summary(overrides: Partial<AvailabilitySummary> = {}): AvailabilitySummary {
  return {
    provider: "pricesapi",
    productModelId: "monitor-dell-s2722qc",
    status: "available",
    label: "Available",
    listings: [],
    bestListing: null,
    checkedAt: new Date("2026-04-25T12:00:00Z"),
    refreshSource: "cached",
    ...overrides,
  };
}

describe("getAvailabilityStatusBadge", () => {
  it("labels live summaries as fresh prices", () => {
    expect(getAvailabilityStatusBadge(summary({ refreshSource: "live" })).label).toBe("Fresh price");
  });

  it("labels quota-blocked summaries distinctly", () => {
    expect(getAvailabilityStatusBadge(summary({ refreshSkippedReason: "free_tier_quota" })).label).toBe("PricesAPI quota-limited");
  });

  it("labels missing availability as unknown", () => {
    expect(
      getAvailabilityStatusBadge(
        summary({
          status: "checking_not_configured",
          label: "Availability unknown",
          provider: null,
          checkedAt: null,
          refreshSource: "not_configured",
        }),
      ).label,
    ).toBe("Unknown availability");
  });
});

describe("availabilityDetailMessages", () => {
  it("shows cached price timestamps with relative age", () => {
    const messages = availabilityDetailMessages(
      summary(),
      new Date("2026-04-25T14:00:00Z"),
    );

    expect(messages).toContain("Cached price from PricesAPI");
    expect(messages.some((message) => /Last checked .+ \(2 hours ago\)/.test(message))).toBe(true);
  });
});
