/**
 * TESTES DO ADAPTADOR GOOGLE GEMINI PARA EXTRAÇÃO DE QUESTÕES
 *
 * Cobertura:
 *   - Resposta válida com 1 questão
 *   - Resposta válida com múltiplas questões
 *   - Resposta inválida (JSON malformado, formato inesperado)
 *   - Erro do provedor (HTTP 4xx/5xx, erro de rede)
 *   - Resposta vazia (nenhuma questão extraída)
 *   - Timeout
 *   - Construção do prompt com/sem metadados de concurso
 *   - Parse de resposta Gemini
 *   - Construção do body para base64 e URL
 */

import { describe, it, expect, vi } from "vitest";
import {
  extractWithGemini,
  buildExtractionPrompt,
  buildRequestBody,
  parseGeminiResponse,
  type GeminiProviderConfig,
} from "./google-gemini";
import type { ImageExtractionRequest } from "../adapters/image-adapter";
import type { RawProviderResult } from "../extraction";

// ─────────────────────────────────────────────────────────────────────────────
// FACTORIES
// ─────────────────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<ImageExtractionRequest> = {}): ImageExtractionRequest {
  return {
    payloadId: "img-001",
    contentType: "image_base64",
    imageData: "iVBORw0KGgoAAAANSUhEUg...",
    contestMetadata: {
      examBoard: "CESPE",
      contestName: "TRF 1ª Região",
      year: 2024,
      position: "Analista Judiciário",
      organization: "TRF1",
    },
    sourceMetadata: null,
    receivedAt: "2026-08-30T04:00:00Z",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<GeminiProviderConfig> = {}): GeminiProviderConfig {
  return {
    apiKey: "test-api-key-123",
    model: "gemini-3.6-flash",
    timeoutMs: 5000,
    ...overrides,
  };
}

function makeGeminiSuccessBody(
  questions: unknown[] = [
    {
      statement: "Qual é a capital do Brasil?",
      alternatives: [
        { letter: "A", text: "Brasília", isCorrect: true },
        { letter: "B", text: "São Paulo", isCorrect: false },
        { letter: "C", text: "Rio de Janeiro", isCorrect: false },
        { letter: "D", text: "Salvador", isCorrect: false },
      ],
      correctAnswer: "A",
      isTrueFalse: false,
      explanation: "Brasília é a capital desde 1960.",
      subjectLabel: "Geografia",
      topicLabel: "Capitais",
      difficulty: 2,
      tags: ["geografia", "capitais"],
      confidence: 0.92,
    },
  ],
  overallConfidence: number | null = 0.92,
): Record<string, unknown> {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                questions,
                overallConfidence,
              }),
            },
          ],
        },
      },
    ],
  };
}

function makeMockFetch(responseBody: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(responseBody),
  }) as unknown as typeof fetch;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildExtractionPrompt
// ─────────────────────────────────────────────────────────────────────────────

describe("buildExtractionPrompt", () => {
  it("inclui metadados de concurso quando disponíveis", () => {
    const prompt = buildExtractionPrompt(makeRequest());

    expect(prompt).toContain("Banca: CESPE");
    expect(prompt).toContain("Concurso: TRF 1ª Região");
    expect(prompt).toContain("Ano: 2024");
    expect(prompt).toContain("Cargo: Analista Judiciário");
    expect(prompt).toContain("Órgão: TRF1");
  });

  it("omite metadados null", () => {
    const prompt = buildExtractionPrompt(
      makeRequest({
        contestMetadata: {
          examBoard: null,
          contestName: null,
          year: null,
          position: null,
          organization: null,
        },
      }),
    );

    expect(prompt).not.toContain("Banca:");
    expect(prompt).not.toContain("Concurso:");
    expect(prompt).not.toContain("Ano:");
    expect(prompt).not.toContain("Cargo:");
    expect(prompt).not.toContain("Órgão:");
    expect(prompt).not.toContain("Contexto do concurso:");
  });

  it("inclui instruções de extração", () => {
    const prompt = buildExtractionPrompt(makeRequest());

    expect(prompt).toContain("questions");
    expect(prompt).toContain("statement");
    expect(prompt).toContain("alternatives");
    expect(prompt).toContain("correctAnswer");
    expect(prompt).toContain("confidence");
  });

  it("inclui metadados parciais", () => {
    const prompt = buildExtractionPrompt(
      makeRequest({
        contestMetadata: {
          examBoard: "FCC",
          contestName: null,
          year: 2023,
          position: null,
          organization: null,
        },
      }),
    );

    expect(prompt).toContain("Banca: FCC");
    expect(prompt).toContain("Ano: 2023");
    expect(prompt).not.toContain("Concurso:");
    expect(prompt).not.toContain("Cargo:");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildRequestBody
// ─────────────────────────────────────────────────────────────────────────────

describe("buildRequestBody", () => {
  it("monta body para image_base64", () => {
    const request = makeRequest({ contentType: "image_base64" });
    const body = buildRequestBody(request, "prompt-text");

    const contents = body.contents as Array<Record<string, unknown>>;
    const parts = contents[0]!.parts as Array<Record<string, unknown>>;

    expect(parts[0]).toEqual({ text: "prompt-text" });
    expect(parts[1]).toEqual({
      inlineData: {
        mimeType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUg...",
      },
    });
  });

  it("monta body para image_url", () => {
    const request = makeRequest({
      contentType: "image_url",
      imageData: "https://example.com/prova.png",
    });
    const body = buildRequestBody(request, "prompt-text");

    const contents = body.contents as Array<Record<string, unknown>>;
    const parts = contents[0]!.parts as Array<Record<string, unknown>>;

    expect(parts[1]).toEqual({
      fileData: {
        mimeType: "image/png",
        fileUri: "https://example.com/prova.png",
      },
    });
  });

  it("configura generationConfig com temperature baixa e JSON", () => {
    const body = buildRequestBody(makeRequest(), "prompt");
    const config = body.generationConfig as Record<string, unknown>;

    expect(config.temperature).toBe(0.1);
    expect(config.responseMimeType).toBe("application/json");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseGeminiResponse
// ─────────────────────────────────────────────────────────────────────────────

describe("parseGeminiResponse", () => {
  it("parseia resposta válida com 1 questão", () => {
    const body = makeGeminiSuccessBody();
    const result = parseGeminiResponse(body);

    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(1);
    expect(result!.questions[0]!.statement).toBe("Qual é a capital do Brasil?");
    expect(result!.questions[0]!.correctAnswer).toBe("A");
    expect(result!.questions[0]!.confidence).toBe(0.92);
    expect(result!.overallConfidence).toBe(0.92);
  });

  it("parseia múltiplas questões", () => {
    const body = makeGeminiSuccessBody(
      [
        {
          statement: "Q1",
          alternatives: [],
          correctAnswer: "A",
          confidence: 0.9,
        },
        {
          statement: "Q2",
          alternatives: [],
          correctAnswer: "B",
          confidence: 0.8,
        },
      ],
      0.85,
    );
    const result = parseGeminiResponse(body);

    expect(result!.questions).toHaveLength(2);
    expect(result!.questions[0]!.statement).toBe("Q1");
    expect(result!.questions[1]!.statement).toBe("Q2");
    expect(result!.overallConfidence).toBe(0.85);
  });

  it("parseia resposta com JSON embutido em markdown", () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: '```json\n{"questions":[{"statement":"Q1","alternatives":[],"correctAnswer":"A","confidence":0.9}],"overallConfidence":0.9}\n```',
              },
            ],
          },
        },
      ],
    };
    const result = parseGeminiResponse(body);

    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(1);
    expect(result!.questions[0]!.statement).toBe("Q1");
  });

  it("retorna null para resposta sem candidates", () => {
    expect(parseGeminiResponse({ candidates: [] })).toBeNull();
    expect(parseGeminiResponse({})).toBeNull();
    expect(parseGeminiResponse(null)).toBeNull();
  });

  it("retorna null para texto não-JSON", () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [{ text: "isso não é json nenhum" }],
          },
        },
      ],
    };
    expect(parseGeminiResponse(body)).toBeNull();
  });

  it("retorna null para JSON sem array questions", () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [{ text: '{"data":"algo"}' }],
          },
        },
      ],
    };
    expect(parseGeminiResponse(body)).toBeNull();
  });

  it("retorna null para texto vazio", () => {
    const body = {
      candidates: [
        {
          content: {
            parts: [{ text: "" }],
          },
        },
      ],
    };
    expect(parseGeminiResponse(body)).toBeNull();
  });

  it("trata campos ausentes da questão com defaults seguros", () => {
    const body = makeGeminiSuccessBody([
      {
        statement: "Questão mínima",
        // Sem outros campos
      },
    ]);
    const result = parseGeminiResponse(body);

    const q = result!.questions[0]!;
    expect(q.statement).toBe("Questão mínima");
    expect(q.alternatives).toEqual([]);
    expect(q.correctAnswer).toBeNull();
    expect(q.isTrueFalse).toBe(false);
    expect(q.explanation).toBeNull();
    expect(q.subjectLabel).toBeNull();
    expect(q.topicLabel).toBeNull();
    expect(q.difficulty).toBeNull();
    expect(q.tags).toEqual([]);
    expect(q.confidence).toBeNull();
  });

  it("retorna overallConfidence null quando não informado", () => {
    const body = makeGeminiSuccessBody([{ statement: "Q1", alternatives: [] }], null);
    // Remover overallConfidence do JSON
    const candidates = body.candidates as Array<Record<string, unknown>>;
    const content = (candidates[0] as Record<string, unknown>).content as Record<string, unknown>;
    const parts = content.parts as Array<Record<string, unknown>>;
    const parsed = JSON.parse(parts[0]!.text as string) as Record<string, unknown>;
    delete parsed.overallConfidence;
    parts[0]!.text = JSON.stringify(parsed);

    const result = parseGeminiResponse(body);
    expect(result!.overallConfidence).toBeNull();
  });

  it("filtra itens null do array questions", () => {
    const body = makeGeminiSuccessBody(
      [
        { statement: "Q1", alternatives: [] },
        null as unknown,
        { statement: "Q2", alternatives: [] },
      ],
      0.8,
    );
    const result = parseGeminiResponse(body);

    expect(result!.questions).toHaveLength(2);
    expect(result!.questions[0]!.statement).toBe("Q1");
    expect(result!.questions[1]!.statement).toBe("Q2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractWithGemini — Resposta válida
// ─────────────────────────────────────────────────────────────────────────────

describe("extractWithGemini", () => {
  describe("resposta válida com 1 questão", () => {
    it("retorna RawProviderResult com success=true e questão extraída", async () => {
      const geminiBody = makeGeminiSuccessBody();
      const mockFetch = makeMockFetch(geminiBody);

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.success).toBe(true);
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0]!.statement).toBe("Qual é a capital do Brasil?");
      expect(result.questions[0]!.correctAnswer).toBe("A");
      expect(result.overallConfidence).toBe(0.92);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("chama fetch com URL correta contendo model e apiKey", async () => {
      const mockFetch = makeMockFetch(makeGeminiSuccessBody());

      await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(callArgs[0]).toContain("gemini-3.6-flash");
      expect(callArgs[0]).toContain("key=test-api-key-123");
    });

    it("envia body com Content-Type application/json", async () => {
      const mockFetch = makeMockFetch(makeGeminiSuccessBody());

      await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      const init = callArgs[1];
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    });
  });

  describe("múltiplas questões", () => {
    it("retorna todas as questões extraídas", async () => {
      const body = makeGeminiSuccessBody(
        [
          {
            statement: "Q1",
            alternatives: [{ letter: "A", text: "Alt A", isCorrect: true }],
            correctAnswer: "A",
            confidence: 0.9,
          },
          {
            statement: "Q2",
            alternatives: [{ letter: "B", text: "Alt B", isCorrect: true }],
            correctAnswer: "B",
            confidence: 0.85,
          },
          {
            statement: "Q3",
            alternatives: [],
            isTrueFalse: true,
            correctAnswer: "C",
            confidence: 0.7,
          },
        ],
        0.82,
      );
      const mockFetch = makeMockFetch(body);

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.success).toBe(true);
      expect(result.questions).toHaveLength(3);
      expect(result.questions[0]!.statement).toBe("Q1");
      expect(result.questions[1]!.statement).toBe("Q2");
      expect(result.questions[2]!.statement).toBe("Q3");
      expect(result.questions[2]!.isTrueFalse).toBe(true);
      expect(result.overallConfidence).toBe(0.82);
    });
  });

  describe("resposta inválida", () => {
    it("retorna PARSE_FAILURE quando body não é JSON", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
      }) as unknown as typeof fetch;

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("PARSE_FAILURE");
      expect(result.questions).toHaveLength(0);
    });

    it("retorna PARSE_FAILURE quando resposta não tem candidates", async () => {
      const mockFetch = makeMockFetch({ data: "sem candidates" });

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("PARSE_FAILURE");
      expect(result.errorMessage).toContain("formato esperado");
    });

    it("retorna PARSE_FAILURE quando text do candidate não é JSON", async () => {
      const body = {
        candidates: [
          {
            content: {
              parts: [{ text: "texto livre sem json" }],
            },
          },
        ],
      };
      const mockFetch = makeMockFetch(body);

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("PARSE_FAILURE");
    });
  });

  describe("erro do provedor (HTTP)", () => {
    it("retorna PROVIDER_ERROR para status 400", async () => {
      const errorBody = {
        error: { message: "Invalid request" },
      };
      const mockFetch = makeMockFetch(errorBody, 400);

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("PROVIDER_ERROR");
      expect(result.errorMessage).toContain("Invalid request");
      expect(result.questions).toHaveLength(0);
    });

    it("retorna PROVIDER_ERROR para status 500", async () => {
      const mockFetch = makeMockFetch({}, 500);

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("PROVIDER_ERROR");
      expect(result.errorMessage).toContain("500");
    });

    it("retorna PROVIDER_ERROR para status 429 (rate limit)", async () => {
      const errorBody = {
        error: { message: "Resource exhausted" },
      };
      const mockFetch = makeMockFetch(errorBody, 429);

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("PROVIDER_ERROR");
      expect(result.errorMessage).toContain("Resource exhausted");
    });

    it("trata erro de rede (fetch rejeita)", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("PROVIDER_ERROR");
      expect(result.errorMessage).toContain("Network error");
    });

    it("mensagem padrão quando error body não parseia", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockRejectedValue(new Error("not json")),
      }) as unknown as typeof fetch;

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("PROVIDER_ERROR");
      expect(result.errorMessage).toContain("503");
    });
  });

  describe("resposta vazia", () => {
    it("retorna success=true com questions vazio quando Gemini não extrai questões", async () => {
      const body = makeGeminiSuccessBody([], 0);
      const mockFetch = makeMockFetch(body);

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.success).toBe(true);
      expect(result.questions).toHaveLength(0);
      expect(result.overallConfidence).toBe(0);
    });
  });

  describe("timeout", () => {
    it("retorna TIMEOUT quando requisição é abortada", async () => {
      const mockFetch = vi.fn().mockImplementation(() => {
        const error = new DOMException("The operation was aborted", "AbortError");
        return Promise.reject(error);
      }) as unknown as typeof fetch;

      const result = await extractWithGemini(
        makeRequest(),
        makeConfig({ timeoutMs: 100 }),
        mockFetch,
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("TIMEOUT");
      expect(result.errorMessage).toContain("timeout");
      expect(result.questions).toHaveLength(0);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("retorna TIMEOUT com nome AbortError genérico", async () => {
      const mockFetch = vi.fn().mockImplementation(() => {
        const error = new Error("aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      }) as unknown as typeof fetch;

      const result = await extractWithGemini(
        makeRequest(),
        makeConfig({ timeoutMs: 100 }),
        mockFetch,
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("TIMEOUT");
    });
  });

  describe("configuração", () => {
    it("usa modelo padrão quando não especificado", async () => {
      const mockFetch = makeMockFetch(makeGeminiSuccessBody());

      await extractWithGemini(makeRequest(), { apiKey: "key-123" }, mockFetch);

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(callArgs[0]).toContain("gemini-3.6-flash");
    });

    it("usa modelo customizado", async () => {
      const mockFetch = makeMockFetch(makeGeminiSuccessBody());

      await extractWithGemini(makeRequest(), makeConfig({ model: "gemini-1.5-pro" }), mockFetch);

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(callArgs[0]).toContain("gemini-1.5-pro");
    });

    it("usa baseUrl customizado", async () => {
      const mockFetch = makeMockFetch(makeGeminiSuccessBody());

      await extractWithGemini(
        makeRequest(),
        makeConfig({ baseUrl: "https://custom.api.com/v1" }),
        mockFetch,
      );

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(callArgs[0].startsWith("https://custom.api.com/v1/")).toBe(true);
    });
  });

  describe("processingTimeMs", () => {
    it("reporta processingTimeMs em resultado de sucesso", async () => {
      const mockFetch = makeMockFetch(makeGeminiSuccessBody());

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.processingTimeMs).toBe("number");
    });

    it("reporta processingTimeMs em resultado de erro", async () => {
      const mockFetch = makeMockFetch({}, 500);

      const result = await extractWithGemini(makeRequest(), makeConfig(), mockFetch);

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});
