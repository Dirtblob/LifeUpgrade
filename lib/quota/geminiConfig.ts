const DEFAULT_GEMINI_MODEL = "gemma-3-12b-it";
const DEFAULT_GEMINI_DAILY_SOFT_CAP = 200;

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function getGeminiModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export function getGeminiDailySoftCap(env: NodeJS.ProcessEnv = process.env): number {
  return parseNonNegativeInteger(env.GEMINI_DAILY_SOFT_CAP, DEFAULT_GEMINI_DAILY_SOFT_CAP);
}
