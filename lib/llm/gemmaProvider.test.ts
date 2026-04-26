import { describe, expect, it, vi } from "vitest";
import { createGemmaProvider } from "./gemmaProvider";

describe("gemma provider", () => {
  it("calls the Gemini generateContent endpoint for hosted Gemma", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      ({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"headline":"h","explanation":"e","tradeoffs":"t","whyThisHelps":"w","whyNotCheaper":"c","whyNotMoreExpensive":"m","confidenceNote":"n","followUpQuestion":"q"}',
                  },
                ],
              },
            },
          ],
        }),
      }) as unknown as Response,
    );
    const logger = { error: vi.fn() };
    const provider = createGemmaProvider({
      apiBaseUrl: "http://localhost:8000/v1",
      apiKey: "secret",
      model: "gemma-4",
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger,
    });

    await provider.completeJson({
      system: "system",
      prompt: '{"facts":{}}',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8000/v1/models/gemma-4:generateContent");
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({
      "content-type": "application/json",
      "x-goog-api-key": "secret",
    });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      system_instruction: {
        parts: [{ text: "system" }],
      },
      contents: [{ role: "user", parts: [{ text: '{"facts":{}}' }] }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    });
  });

  it("normalizes Gemini OpenAI-compatible base URLs to the native endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      ({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '{"ok":true}' }],
              },
            },
          ],
        }),
      }) as unknown as Response,
    );
    const provider = createGemmaProvider({
      apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: "secret",
      model: "gemma-4-26b-a4b-it",
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: { error: vi.fn() },
    });

    await provider.completeJson({
      system: "system",
      prompt: '{"facts":{}}',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent",
    );
  });

  it("passes an explicit response schema when provided", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      ({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '{"headline":"h"}' }],
              },
            },
          ],
        }),
      }) as unknown as Response,
    );
    const provider = createGemmaProvider({
      apiBaseUrl: "http://localhost:8000/v1",
      apiKey: "secret",
      model: "gemma-4-26b-a4b-it",
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: { error: vi.fn() },
    });

    await provider.completeJson({
      system: "system",
      prompt: '{"facts":{}}',
      responseSchema: {
        type: "OBJECT",
        properties: { headline: { type: "STRING" } },
        required: ["headline"],
      },
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      generationConfig: {
        responseSchema: {
          type: "OBJECT",
          properties: { headline: { type: "STRING" } },
          required: ["headline"],
        },
      },
    });
  });

  it("folds system instructions into the prompt for Gemma 3 models", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      ({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '{"headline":"h"}' }],
              },
            },
          ],
        }),
      }) as unknown as Response,
    );
    const provider = createGemmaProvider({
      apiBaseUrl: "http://localhost:8000/v1",
      apiKey: "secret",
      model: "gemma-3-12b-it",
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: { error: vi.fn() },
    });

    await provider.completeJson({
      system: "system",
      prompt: '{"facts":{}}',
      responseSchema: {
        type: "OBJECT",
        properties: { headline: { type: "STRING" } },
        required: ["headline"],
      },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.system_instruction).toBeUndefined();
    expect(body.generationConfig.responseMimeType).toBeUndefined();
    expect(body.generationConfig.responseSchema).toBeUndefined();
    expect(body.contents[0].parts[0].text).toContain("System instructions:\nsystem");
    expect(body.contents[0].parts[0].text).toContain('User prompt:\n{"facts":{}}');
  });

  it("does not retry rate-limited Gemini responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          message: "Quota exceeded",
        },
      }),
    } as unknown as Response);
    const logger = { error: vi.fn() };
    const provider = createGemmaProvider({
      apiBaseUrl: "http://localhost:8000/v1",
      apiKey: "secret",
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger,
    });

    await expect(
      provider.completeJson({
        system: "system",
        prompt: '{"facts":{}}',
      }),
    ).rejects.toThrow("429");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
