/**
 * TESTES DA CAMADA DE EXTRAÇÃO DE QUESTÃO A PARTIR DE IMAGEM
 *
 * Cobertura:
 *   - Resultado válido com 1 questão
 *   - Resultado válido com múltiplas questões
 *   - Resultado incompleto (sem gabarito, sem alternativas)
 *   - Erros de extração (resposta vazia, parse failure, erro do provedor)
 *   - Warnings gerados automaticamente
 *   - Classificação de confiança
 *   - Confiança geral calculada
 *   - Determinismo
 *   - Questão V/F
 */

import { describe, it, expect } from "vitest";
import {
  convertProviderResult,
  classifyConfidence,
  computeOverallConfidence,
  type ExtractionRequest,
  type RawProviderResult,
  type ExtractedQuestionData,
  type ExtractionResult,
  type ExtractionError,
  type ExtractionWarning,
  type ExtractionConfidenceLevel,
} from "./extraction";
import type { ContestMetadata } from "./ingestion";

// ─────────────────────────────────────────────────────────────────────────────
// FACTORIES
// ─────────────────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<ExtractionRequest> = {}): ExtractionRequest {
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

function makeQuestionData(overrides: Partial<ExtractedQuestionData> = {}): ExtractedQuestionData {
  return {
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
    ...overrides,
  };
}

function makeProviderResult(overrides: Partial<RawProviderResult> = {}): RawProviderResult {
  return {
    success: true,
    questions: [makeQuestionData()],
    overallConfidence: 0.92,
    processingTimeMs: 1500,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// convertProviderResult — Resultado válido
// ─────────────────────────────────────────────────────────────────────────────

describe("convertProviderResult", () => {
  describe("resultado válido com 1 questão", () => {
    it("converte corretamente todos os campos", () => {
      const result = convertProviderResult(makeProviderResult(), makeRequest());

      expect(result.success).toBe(true);
      expect(result.payloadId).toBe("img-001");
      expect(result.totalExtracted).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.processingTimeMs).toBe(1500);

      const q = result.questions[0]!;
      expect(q.extractionId).toBe("img-001-q0");
      expect(q.payloadId).toBe("img-001");
      expect(q.statement).toBe("Qual é a capital do Brasil?");
      expect(q.alternatives).toHaveLength(4);
      expect(q.correctAnswer).toBe("A");
      expect(q.isTrueFalse).toBe(false);
      expect(q.explanation).toBe("Brasília é a capital desde 1960.");
      expect(q.subjectLabel).toBe("Geografia");
      expect(q.topicLabel).toBe("Capitais");
      expect(q.difficulty).toBe(2);
      expect(q.tags).toEqual(["geografia", "capitais"]);
      expect(q.extractionConfidence).toBe(0.92);
    });

    it("usa contestMetadata do request, não do provedor", () => {
      const result = convertProviderResult(makeProviderResult(), makeRequest());
      const q = result.questions[0]!;

      expect(q.contestMetadata.examBoard).toBe("CESPE");
      expect(q.contestMetadata.contestName).toBe("TRF 1ª Região");
      expect(q.contestMetadata.year).toBe(2024);
      expect(q.contestMetadata.position).toBe("Analista Judiciário");
      expect(q.contestMetadata.organization).toBe("TRF1");
    });

    it("converte alternativas com isCorrect preservado", () => {
      const result = convertProviderResult(makeProviderResult(), makeRequest());
      const alts = result.questions[0]!.alternatives;

      expect(alts[0]!.letter).toBe("A");
      expect(alts[0]!.text).toBe("Brasília");
      expect(alts[0]!.isCorrect).toBe(true);
      expect(alts[1]!.isCorrect).toBe(false);
    });
  });

  describe("múltiplas questões", () => {
    it("converte todas as questões com extractionId sequencial", () => {
      const provider = makeProviderResult({
        questions: [
          makeQuestionData({ statement: "Questão 1", confidence: 0.9 }),
          makeQuestionData({ statement: "Questão 2", confidence: 0.8 }),
          makeQuestionData({ statement: "Questão 3", confidence: 0.7 }),
        ],
        overallConfidence: 0.8,
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.success).toBe(true);
      expect(result.totalExtracted).toBe(3);
      expect(result.questions[0]!.extractionId).toBe("img-001-q0");
      expect(result.questions[1]!.extractionId).toBe("img-001-q1");
      expect(result.questions[2]!.extractionId).toBe("img-001-q2");
      expect(result.questions[0]!.statement).toBe("Questão 1");
      expect(result.questions[1]!.statement).toBe("Questão 2");
      expect(result.questions[2]!.statement).toBe("Questão 3");
    });

    it("calcula confiança geral com overallConfidence do provedor", () => {
      const provider = makeProviderResult({
        questions: [makeQuestionData({ confidence: 0.9 }), makeQuestionData({ confidence: 0.6 })],
        overallConfidence: 0.75,
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.overallConfidence).toBe(0.75);
    });
  });

  describe("resultado incompleto", () => {
    it("gera warnings para questão sem gabarito", () => {
      const provider = makeProviderResult({
        questions: [
          makeQuestionData({
            correctAnswer: null,
            alternatives: [
              { letter: "A", text: "Opção A" },
              { letter: "B", text: "Opção B" },
            ],
          }),
        ],
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.success).toBe(true);
      expect(result.questions[0]!.correctAnswer).toBeNull();
      expect(result.warnings.some((w) => w.field.includes("correctAnswer"))).toBe(true);
    });

    it("gera warnings para questão sem alternativas", () => {
      const provider = makeProviderResult({
        questions: [
          makeQuestionData({
            alternatives: [],
            isTrueFalse: false,
          }),
        ],
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.success).toBe(true);
      expect(result.warnings.some((w) => w.field.includes("alternatives"))).toBe(true);
    });

    it("NÃO gera warning de alternativas para questão V/F sem alternativas", () => {
      const provider = makeProviderResult({
        questions: [
          makeQuestionData({
            alternatives: [],
            isTrueFalse: true,
            correctAnswer: "C",
          }),
        ],
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.success).toBe(true);
      expect(
        result.warnings.some(
          (w) => w.field.includes("alternatives") && w.message.includes("sem alternativas"),
        ),
      ).toBe(false);
    });

    it("gera warnings para questão sem matéria e tópico", () => {
      const provider = makeProviderResult({
        questions: [makeQuestionData({ subjectLabel: null, topicLabel: null })],
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.warnings.some((w) => w.field.includes("subjectLabel"))).toBe(true);
      expect(result.warnings.some((w) => w.field.includes("topicLabel"))).toBe(true);
    });

    it("gera warning para confiança baixa individual", () => {
      const provider = makeProviderResult({
        questions: [makeQuestionData({ confidence: 0.3 })],
        overallConfidence: 0.3,
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.warnings.some((w) => w.field.includes("confidence"))).toBe(true);
    });

    it("infere correctAnswer das alternativas quando não informado explicitamente", () => {
      const provider = makeProviderResult({
        questions: [
          makeQuestionData({
            correctAnswer: null,
            alternatives: [
              { letter: "A", text: "Errada", isCorrect: false },
              { letter: "B", text: "Certa", isCorrect: true },
            ],
          }),
        ],
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.questions[0]!.correctAnswer).toBe("B");
    });

    it("usa correctAnswer explícito quando ambos estão disponíveis", () => {
      const provider = makeProviderResult({
        questions: [
          makeQuestionData({
            correctAnswer: "C",
            alternatives: [
              { letter: "A", text: "Opção A", isCorrect: true },
              { letter: "B", text: "Opção B", isCorrect: false },
              { letter: "C", text: "Opção C", isCorrect: false },
            ],
          }),
        ],
      });
      const result = convertProviderResult(provider, makeRequest());

      // O campo explícito tem prioridade
      expect(result.questions[0]!.correctAnswer).toBe("C");
    });
  });

  describe("erros de extração", () => {
    it("retorna erro para provedor com success=false", () => {
      const provider = makeProviderResult({
        success: false,
        questions: [],
        errorCode: "RATE_LIMITED",
        errorMessage: "Too many requests",
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.success).toBe(false);
      expect(result.totalExtracted).toBe(0);
      expect(result.questions).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe("PROVIDER_ERROR");
      expect(result.errors[0]!.message).toBe("Too many requests");
      expect(result.overallConfidence).toBe(0);
      expect(result.confidenceLevel).toBe("very_low");
    });

    it("mapeia código de erro TIMEOUT do provedor", () => {
      const provider = makeProviderResult({
        success: false,
        questions: [],
        errorCode: "REQUEST_TIMEOUT",
        errorMessage: "Timed out",
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.errors[0]!.code).toBe("TIMEOUT");
    });

    it("mapeia código de erro PARSE do provedor", () => {
      const provider = makeProviderResult({
        success: false,
        questions: [],
        errorCode: "JSON_PARSE_ERROR",
        errorMessage: "Invalid JSON",
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.errors[0]!.code).toBe("PARSE_FAILURE");
    });

    it("retorna EMPTY_RESPONSE para sucesso sem questões", () => {
      const provider = makeProviderResult({
        success: true,
        questions: [],
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe("EMPTY_RESPONSE");
    });

    it("retorna INCOMPLETE_QUESTION para questão sem enunciado", () => {
      const provider = makeProviderResult({
        questions: [
          makeQuestionData({ statement: "" }),
          makeQuestionData({ statement: "Questão válida" }),
        ],
      });
      const result = convertProviderResult(provider, makeRequest());

      // A questão sem enunciado é descartada, a válida é preservada
      expect(result.success).toBe(true);
      expect(result.totalExtracted).toBe(1);
      expect(result.questions[0]!.statement).toBe("Questão válida");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe("INCOMPLETE_QUESTION");
    });

    it("retorna mensagem padrão quando provedor não informa mensagem", () => {
      const provider = makeProviderResult({
        success: false,
        questions: [],
        errorCode: null,
        errorMessage: null,
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.errors[0]!.code).toBe("PROVIDER_ERROR");
      expect(result.errors[0]!.message).toContain("retornou erro");
    });
  });

  describe("confiança", () => {
    it("usa overallConfidence do provedor quando disponível", () => {
      const result = convertProviderResult(
        makeProviderResult({ overallConfidence: 0.88 }),
        makeRequest(),
      );

      expect(result.overallConfidence).toBe(0.88);
      expect(result.confidenceLevel).toBe("high");
    });

    it("calcula média das confianças individuais quando provedor não reporta", () => {
      const provider = makeProviderResult({
        questions: [makeQuestionData({ confidence: 0.8 }), makeQuestionData({ confidence: 0.6 })],
        overallConfidence: null,
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.overallConfidence).toBe(0.7);
      expect(result.confidenceLevel).toBe("medium");
    });

    it("retorna confiança 0 quando nenhuma informação de confiança", () => {
      const provider = makeProviderResult({
        questions: [makeQuestionData({ confidence: null })],
        overallConfidence: null,
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.overallConfidence).toBe(0);
      expect(result.confidenceLevel).toBe("very_low");
    });

    it("clampa confiança entre 0 e 1", () => {
      const provider = makeProviderResult({
        questions: [makeQuestionData({ confidence: 1.5 })],
        overallConfidence: 1.5,
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.overallConfidence).toBe(1);
      expect(result.questions[0]!.extractionConfidence).toBe(1);
    });
  });

  describe("campos opcionais e edge cases", () => {
    it("trata difficulty fora do range como null", () => {
      const provider = makeProviderResult({
        questions: [makeQuestionData({ difficulty: 0 })],
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.questions[0]!.difficulty).toBeNull();
    });

    it("trata difficulty > 5 como null", () => {
      const provider = makeProviderResult({
        questions: [makeQuestionData({ difficulty: 10 })],
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.questions[0]!.difficulty).toBeNull();
    });

    it("trata tags undefined como array vazio", () => {
      const provider = makeProviderResult({
        questions: [makeQuestionData({ tags: undefined })],
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.questions[0]!.tags).toEqual([]);
    });

    it("trata processingTimeMs negativo como null", () => {
      const result = convertProviderResult(
        makeProviderResult({ processingTimeMs: -100 }),
        makeRequest(),
      );

      expect(result.processingTimeMs).toBeNull();
    });

    it("trata processingTimeMs null como null", () => {
      const result = convertProviderResult(
        makeProviderResult({ processingTimeMs: null }),
        makeRequest(),
      );

      expect(result.processingTimeMs).toBeNull();
    });

    it("preserva processingTimeMs válido", () => {
      const result = convertProviderResult(
        makeProviderResult({ processingTimeMs: 2500 }),
        makeRequest(),
      );

      expect(result.processingTimeMs).toBe(2500);
    });

    it("converte questão V/F corretamente", () => {
      const provider = makeProviderResult({
        questions: [
          makeQuestionData({
            statement: "O Brasil é um país da América do Sul.",
            alternatives: [],
            isTrueFalse: true,
            correctAnswer: "C",
            confidence: 0.95,
          }),
        ],
      });
      const result = convertProviderResult(provider, makeRequest());

      expect(result.success).toBe(true);
      const q = result.questions[0]!;
      expect(q.isTrueFalse).toBe(true);
      expect(q.alternatives).toHaveLength(0);
      expect(q.correctAnswer).toBe("C");
    });

    it("cria cópia das tags (não compartilha referência)", () => {
      const originalTags = ["tag1", "tag2"];
      const provider = makeProviderResult({
        questions: [makeQuestionData({ tags: originalTags })],
      });
      const result = convertProviderResult(provider, makeRequest());

      result.questions[0]!.tags.push("tag3");
      expect(originalTags).toEqual(["tag1", "tag2"]);
    });
  });

  describe("determinismo", () => {
    it("mesmo input → mesmo output (resultado válido)", () => {
      const provider = makeProviderResult();
      const request = makeRequest();

      const r1 = convertProviderResult(provider, request);
      const r2 = convertProviderResult(provider, request);

      expect(r1).toEqual(r2);
    });

    it("mesmo input → mesmo output (resultado com erro)", () => {
      const provider = makeProviderResult({
        success: false,
        questions: [],
        errorMessage: "Erro",
      });
      const request = makeRequest();

      const r1 = convertProviderResult(provider, request);
      const r2 = convertProviderResult(provider, request);

      expect(r1).toEqual(r2);
    });

    it("mesmo input → mesmo output (múltiplas questões)", () => {
      const provider = makeProviderResult({
        questions: [
          makeQuestionData({ statement: "Q1", confidence: 0.9 }),
          makeQuestionData({ statement: "Q2", confidence: 0.7 }),
          makeQuestionData({ statement: "Q3", confidence: 0.5 }),
        ],
        overallConfidence: null,
      });
      const request = makeRequest();

      const r1 = convertProviderResult(provider, request);
      const r2 = convertProviderResult(provider, request);

      expect(r1).toEqual(r2);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyConfidence
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyConfidence", () => {
  it("classifica >= 0.85 como high", () => {
    expect(classifyConfidence(0.85)).toBe("high");
    expect(classifyConfidence(1.0)).toBe("high");
    expect(classifyConfidence(0.99)).toBe("high");
  });

  it("classifica 0.60..0.84 como medium", () => {
    expect(classifyConfidence(0.6)).toBe("medium");
    expect(classifyConfidence(0.7)).toBe("medium");
    expect(classifyConfidence(0.84)).toBe("medium");
  });

  it("classifica 0.35..0.59 como low", () => {
    expect(classifyConfidence(0.35)).toBe("low");
    expect(classifyConfidence(0.5)).toBe("low");
    expect(classifyConfidence(0.59)).toBe("low");
  });

  it("classifica < 0.35 como very_low", () => {
    expect(classifyConfidence(0.0)).toBe("very_low");
    expect(classifyConfidence(0.34)).toBe("very_low");
    expect(classifyConfidence(0.1)).toBe("very_low");
  });

  it("trata NaN como very_low", () => {
    expect(classifyConfidence(NaN)).toBe("very_low");
  });

  it("trata negativo como very_low", () => {
    expect(classifyConfidence(-0.5)).toBe("very_low");
  });

  it("é determinístico", () => {
    expect(classifyConfidence(0.72)).toBe(classifyConfidence(0.72));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeOverallConfidence
// ─────────────────────────────────────────────────────────────────────────────

describe("computeOverallConfidence", () => {
  it("retorna overallConfidence do provedor quando disponível", () => {
    const questions = [makeQuestionData({ confidence: 0.5 })];
    expect(computeOverallConfidence(questions, 0.88)).toBe(0.88);
  });

  it("calcula média das individuais quando provedor não reporta", () => {
    const questions = [
      makeQuestionData({ confidence: 0.8 }),
      makeQuestionData({ confidence: 0.6 }),
    ];
    expect(computeOverallConfidence(questions, null)).toBe(0.7);
  });

  it("retorna 0 quando nenhuma confiança disponível", () => {
    const questions = [
      makeQuestionData({ confidence: null }),
      makeQuestionData({ confidence: undefined }),
    ];
    expect(computeOverallConfidence(questions, null)).toBe(0);
  });

  it("retorna 0 para array vazio", () => {
    expect(computeOverallConfidence([], null)).toBe(0);
  });

  it("clampa overallConfidence do provedor entre 0 e 1", () => {
    expect(computeOverallConfidence([], 1.5)).toBe(1);
    expect(computeOverallConfidence([], -0.5)).toBe(0);
  });

  it("clampa confianças individuais entre 0 e 1", () => {
    const questions = [
      makeQuestionData({ confidence: 1.5 }),
      makeQuestionData({ confidence: -0.5 }),
    ];
    // 1.0 + 0.0 = 1.0 / 2 = 0.5
    expect(computeOverallConfidence(questions, null)).toBe(0.5);
  });

  it("ignora confianças null na média", () => {
    const questions = [
      makeQuestionData({ confidence: 0.8 }),
      makeQuestionData({ confidence: null }),
    ];
    // Só conta a primeira: 0.8 / 1 = 0.8
    expect(computeOverallConfidence(questions, null)).toBe(0.8);
  });

  it("é determinístico", () => {
    const questions = [
      makeQuestionData({ confidence: 0.7 }),
      makeQuestionData({ confidence: 0.9 }),
    ];
    expect(computeOverallConfidence(questions, null)).toBe(
      computeOverallConfidence(questions, null),
    );
  });
});
