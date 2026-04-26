import { db } from "@/lib/db";
import type { ApiUsagePeriodType } from "./types";
import { buildPeriodKey } from "./pricesApiQuota";
import { getGeminiDailySoftCap, getGeminiModel } from "./geminiConfig";

export { getGeminiDailySoftCap, getGeminiModel } from "./geminiConfig";

const GEMINI_PROVIDER = "gemini";
const GEMINI_CACHE_HIT_PROVIDER = "gemini:cache_hit";
const GEMINI_FAILURE_PROVIDER = "gemini:failure";
const GEMINI_FALLBACK_PROVIDER = "gemini:fallback";

export type GeminiUsageMetric = "cache_hit" | "failure" | "fallback";

export interface GeminiUsageSnapshot {
  model: string;
  dailySoftCap: number;
  callsToday: number;
  cachedHitsToday: number;
  failuresToday: number;
  fallbackCountToday: number;
  dailyRemaining: number;
  periodKey: string;
}

interface GeminiUsageDbClient {
  apiUsage: {
    findUnique(args: {
      where: {
        provider_periodType_periodKey: {
          provider: string;
          periodType: ApiUsagePeriodType;
          periodKey: string;
        };
      };
    }): Promise<{ callCount: number } | null>;
    upsert(args: {
      where: {
        provider_periodType_periodKey: {
          provider: string;
          periodType: ApiUsagePeriodType;
          periodKey: string;
        };
      };
      update: {
        callCount: {
          increment: number;
        };
      };
      create: {
        provider: string;
        periodType: ApiUsagePeriodType;
        periodKey: string;
        callCount: number;
      };
    }): Promise<unknown>;
  };
}

function providerForMetric(metric: GeminiUsageMetric): string {
  if (metric === "cache_hit") return GEMINI_CACHE_HIT_PROVIDER;
  if (metric === "failure") return GEMINI_FAILURE_PROVIDER;
  return GEMINI_FALLBACK_PROVIDER;
}

async function readDailyCounter(
  provider: string,
  periodKey: string,
  usageDb: GeminiUsageDbClient,
): Promise<number> {
  const record = await usageDb.apiUsage.findUnique({
    where: {
      provider_periodType_periodKey: {
        provider,
        periodType: "day",
        periodKey,
      },
    },
  });

  return record?.callCount ?? 0;
}

async function incrementDailyCounter(
  provider: string,
  count: number,
  now: Date,
  usageDb: GeminiUsageDbClient,
): Promise<void> {
  if (count <= 0) return;

  await usageDb.apiUsage.upsert({
    where: {
      provider_periodType_periodKey: {
        provider,
        periodType: "day",
        periodKey: buildPeriodKey("day", now),
      },
    },
    update: {
      callCount: {
        increment: count,
      },
    },
    create: {
      provider,
      periodType: "day",
      periodKey: buildPeriodKey("day", now),
      callCount: count,
    },
  });
}

export async function getGeminiUsageSnapshot(
  now: Date = new Date(),
  usageDb: GeminiUsageDbClient = db as unknown as GeminiUsageDbClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GeminiUsageSnapshot> {
  const periodKey = buildPeriodKey("day", now);
  const [callsToday, cachedHitsToday, failuresToday, fallbackCountToday] = await Promise.all([
    readDailyCounter(GEMINI_PROVIDER, periodKey, usageDb),
    readDailyCounter(GEMINI_CACHE_HIT_PROVIDER, periodKey, usageDb),
    readDailyCounter(GEMINI_FAILURE_PROVIDER, periodKey, usageDb),
    readDailyCounter(GEMINI_FALLBACK_PROVIDER, periodKey, usageDb),
  ]);
  const dailySoftCap = getGeminiDailySoftCap(env);

  return {
    model: getGeminiModel(env),
    dailySoftCap,
    callsToday,
    cachedHitsToday,
    failuresToday,
    fallbackCountToday,
    dailyRemaining: Math.max(0, dailySoftCap - callsToday),
    periodKey,
  };
}

export async function recordGeminiMetric(
  metric: GeminiUsageMetric,
  count = 1,
  now: Date = new Date(),
  usageDb: GeminiUsageDbClient = db as unknown as GeminiUsageDbClient,
): Promise<void> {
  await incrementDailyCounter(providerForMetric(metric), count, now, usageDb);
}

let geminiReservationQueue: Promise<unknown> = Promise.resolve();

function enqueueGeminiReservation<T>(task: () => Promise<T>): Promise<T> {
  const nextTask = geminiReservationQueue.then(task, task);
  geminiReservationQueue = nextTask.catch(() => undefined);
  return nextTask;
}

export async function reserveGeminiCall(
  now: Date = new Date(),
  usageDb: GeminiUsageDbClient = db as unknown as GeminiUsageDbClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  return enqueueGeminiReservation(async () => {
    const snapshot = await getGeminiUsageSnapshot(now, usageDb, env);

    if (snapshot.dailyRemaining <= 0) {
      return false;
    }

    await incrementDailyCounter(GEMINI_PROVIDER, 1, now, usageDb);
    return true;
  });
}
