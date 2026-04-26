import type { RecommendationNarratorProvider, RecommendationNarratorProviderRequest } from "./types";
import { getGeminiModel } from "@/lib/quota/geminiConfig";

const DEFAULT_GEMMA_TIMEOUT_MS = 45_000;
const DEFAULT_GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    message?: string;
    status?: string;
  };
}

export interface GemmaProviderOptions {
  apiBaseUrl?: string;
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "error">;
  timeoutMs?: number;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = trimTrailingSlash(value.trim());
  // The Gemini OpenAI-compatible base ends in /openai, but this provider uses
  // the native generateContent endpoint.
  return trimmed.endsWith("/openai") ? trimmed.slice(0, -"/openai".length) : trimmed;
}

function normalizeModelPath(model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith("models/") ? trimmed : `models/${trimmed}`;
}

function normalizeModelId(model: string): string {
  return model.trim().replace(/^models\//, "");
}

function usesLegacyGemmaApi(model: string): boolean {
  return /^gemma-3n?-/.test(normalizeModelId(model));
}

function buildGenerateContentUrl(apiBaseUrl: string, model: string): string {
  const normalized = normalizeApiBaseUrl(apiBaseUrl);
  return `${normalized}/${normalizeModelPath(model)}:generateContent`;
}

function buildUserPrompt(request: RecommendationNarratorProviderRequest, includeSystem: boolean): string {
  if (!includeSystem) return request.prompt;

  return [
    "System instructions:",
    request.system,
    "",
    "User prompt:",
    request.prompt,
  ].join("\n");
}

function extractContent(body: GeminiGenerateContentResponse): string {
  if (body.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt: ${body.promptFeedback.blockReason}`);
  }

  const firstCandidate = body.candidates?.[0];
  const content = firstCandidate?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (content) return content;

  if (firstCandidate?.finishReason) {
    throw new Error(`Gemini response ended without content: ${firstCandidate.finishReason}`);
  }

  return "";
}

function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Gemma request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeoutId),
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function logGemmaError(logger: Pick<Console, "error">, error: unknown): void {
  logger.error("[llm][gemma] request failed", {
    error: error instanceof Error ? error.message : String(error),
  });
}

export function createGemmaProvider({
  apiBaseUrl = DEFAULT_GEMINI_API_BASE_URL,
  apiKey,
  model = getGeminiModel(),
  fetchImpl = fetch,
  logger = console,
  timeoutMs = DEFAULT_GEMMA_TIMEOUT_MS,
}: GemmaProviderOptions): RecommendationNarratorProvider {
  const endpoint = buildGenerateContentUrl(apiBaseUrl, model);
  const legacyGemmaApi = usesLegacyGemmaApi(model);

  return {
    name: "gemma",
    async completeJson(request: RecommendationNarratorProviderRequest): Promise<string> {
      const { signal, cancel } = createTimeoutSignal(timeoutMs);

      try {
        const generationConfig = {
          temperature: request.temperature ?? 0.2,
          maxOutputTokens: request.maxTokens ?? 500,
          ...(!legacyGemmaApi
            ? {
                responseMimeType: "application/json",
                ...(request.responseSchema ? { responseSchema: request.responseSchema } : {}),
              }
            : {}),
        };
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          signal,
          body: JSON.stringify({
            ...(!legacyGemmaApi
              ? {
                  system_instruction: {
                    parts: [{ text: request.system }],
                  },
                }
              : {}),
            contents: [
              {
                role: "user",
                parts: [{ text: buildUserPrompt(request, legacyGemmaApi) }],
              },
            ],
            generationConfig,
          }),
        });

        const body = (await response.json().catch(() => ({}))) as GeminiGenerateContentResponse;
        if (!response.ok) {
          const detail = body.error?.message ? `: ${body.error.message}` : "";
          throw new Error(`Gemini request failed with status ${response.status}${detail}`);
        }

        const content = extractContent(body);

        if (!content.trim()) {
          throw new Error("Gemini response did not include any content");
        }

        return content;
      } catch (error) {
        logGemmaError(logger, error);
        throw error instanceof Error ? error : new Error("Gemini request failed");
      } finally {
        cancel();
      }
    },
  };
}

export function getGemmaProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): RecommendationNarratorProvider | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return createGemmaProvider({
    apiBaseUrl: env.GEMINI_API_BASE_URL?.trim() || undefined,
    apiKey,
    model: getGeminiModel(env),
    fetchImpl,
    timeoutMs: parsePositiveInteger(env.GEMINI_TIMEOUT_MS, DEFAULT_GEMMA_TIMEOUT_MS),
  });
}
