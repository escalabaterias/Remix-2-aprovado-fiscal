/**
 * TESTES DA INFRAESTRUTURA DE INGESTÃO DE QUESTÕES
 *
 * Cobertura completa das funções puras:
 *   - validateExtractedQuestion
 *   - processIngestionPayload
 *   - mapExtractedToQuestionBankInput
 */

import { describe, it, expect } from "vitest";
import {
  validateExtractedQuestion,
  processIngestionPayload,
  mapExtractedToQuestionBankInput,
  type ExtractedQuestion,
  type ExtractedAlternative,
  type ContestMetadata,
  type RawIngestionPayload,
  type IngestionSource,
} from "./ingestion";

// ─────────────────────────────────────────────────────────────────────────────
// FACTORIES
// ─────────────────────────────────────────────────────────────────────────────

function makeAlternative(overrides: Partial<ExtractedAlternative> = {}): ExtractedAlternative {
  return {
    letter: "A",
    text: "Brasília",
    isCorrect: null,
    ...overrides,
  };
}

function makeContestMetadata(overrides: Partial<ContestMetadata> = {}): ContestMetadata {
  return {
    examBoard: "CESPE",
    contestName: "TRF 1ª Região",
    year: 2024,
    position: "Analista Judiciário",
    organization: "TRF1",
    ...overrides,
  };
}

function makeExtractedQuestion(overrides: Partial<ExtractedQuestion> = {}): ExtractedQuestion {
  return {
    extractionId: "ext-1",
    payloadId: "payload-1",
    statement: "Qual é a capital do Brasil?",
    alternatives: [
      makeAlternative({ letter: "A", text: "Brasília", isCorrect: true }),
      makeAlternative({ letter: "B", text: "São Paulo", isCorrect: false }),
      makeAlternative({ letter: "C", text: "Rio de Janeiro", isCorrect: false }),
      makeAlternative({ letter: "D", text: "Salvador", isCorrect: false }),
    ],
    correctAnswer: "A",
    isTrueFalse: false,
    explanation: "Brasília é a capital federal desde 1960.",
    contestMetadata: makeContestMetadata(),
    subjectLabel: "Geografia",
    topicLabel: "Capitais",
    difficulty: 2,
    tags: ["geografia", "capitais"],
    extractionConfidence: 1.0,
    ...overrides,
  };
}

function makePayload(overrides: Partial<RawIngestionPayload> = {}): RawIngestionPayload {
  return {
    payloadId: "payload-1",
    source: "manual",
    contentType: "text_json",
    rawData: JSON.stringify([makeExtractedQuestion()]),
    sourceMetadata: null,
    receivedAt: "2026-08-30T04:00:00Z",
    ...overrides,
  };
}

const PROCESSED_AT = "2026-08-30T04:01:00Z";

// ─────────────────────────────────────────────────────────────────────────────
// validateExtractedQuestion
// ─────────────────────────────────────────────────────────────────────────────

describe("validateExtractedQuestion", () => {
  it("valida questão completa como válida", () => {
    const result = validateExtractedQuestion(makeExtractedQuestion());
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("questão completa gera apenas warnings esperados (nenhum neste caso)", () => {
    const result = validateExtractedQuestion(makeExtractedQuestion());
    // Uma questão completa não deve ter warnings
    expect(result.warnings).toHaveLength(0);
  });

  it("rejeita enunciado vazio", () => {
    const q = makeExtractedQuestion({ statement: "" });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.field === "statement")).toBe(true);
  });

  it("rejeita enunciado só com espaços", () => {
    const q = makeExtractedQuestion({ statement: "   " });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.field === "statement")).toBe(true);
  });

  it("rejeita menos de 2 alternativas para múltipla escolha", () => {
    const q = makeExtractedQuestion({
      alternatives: [makeAlternative({ letter: "A", text: "Única" })],
    });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.field === "alternatives")).toBe(true);
  });

  it("aceita questão V/F com 0 alternativas", () => {
    const q = makeExtractedQuestion({
      isTrueFalse: true,
      alternatives: [],
      correctAnswer: null,
    });
    const result = validateExtractedQuestion(q);
    // V/F sem alternativas é válido (não gera erro de alternativas)
    expect(result.errors.filter((e) => e.field === "alternatives")).toHaveLength(0);
  });

  it("rejeita alternativa sem letra", () => {
    const q = makeExtractedQuestion({
      alternatives: [
        makeAlternative({ letter: "", text: "Sem letra" }),
        makeAlternative({ letter: "B", text: "Com letra" }),
      ],
    });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("letter"))).toBe(true);
  });

  it("rejeita alternativa sem texto", () => {
    const q = makeExtractedQuestion({
      alternatives: [
        makeAlternative({ letter: "A", text: "" }),
        makeAlternative({ letter: "B", text: "Com texto" }),
      ],
    });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("text"))).toBe(true);
  });

  it("rejeita letras duplicadas nas alternativas", () => {
    const q = makeExtractedQuestion({
      alternatives: [
        makeAlternative({ letter: "A", text: "Primeira" }),
        makeAlternative({ letter: "A", text: "Duplicada" }),
      ],
      correctAnswer: "A",
    });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("duplicada"))).toBe(true);
  });

  it("rejeita gabarito que não corresponde a alternativa existente", () => {
    const q = makeExtractedQuestion({ correctAnswer: "Z" });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.field === "correctAnswer")).toBe(true);
  });

  it("aceita gabarito null (mas gera warning)", () => {
    const q = makeExtractedQuestion({ correctAnswer: null });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((e) => e.field === "correctAnswer")).toBe(true);
  });

  it("rejeita dificuldade fora do range 1-5", () => {
    const q0 = makeExtractedQuestion({ difficulty: 0 });
    expect(validateExtractedQuestion(q0).isValid).toBe(false);

    const q6 = makeExtractedQuestion({ difficulty: 6 });
    expect(validateExtractedQuestion(q6).isValid).toBe(false);

    const qNaN = makeExtractedQuestion({ difficulty: NaN });
    expect(validateExtractedQuestion(qNaN).isValid).toBe(false);
  });

  it("aceita dificuldade null", () => {
    const q = makeExtractedQuestion({ difficulty: null });
    const result = validateExtractedQuestion(q);
    expect(result.errors.filter((e) => e.field === "difficulty")).toHaveLength(0);
  });

  it("aceita dificuldade válida (1 a 5)", () => {
    for (let d = 1; d <= 5; d++) {
      const q = makeExtractedQuestion({ difficulty: d });
      expect(
        validateExtractedQuestion(q).errors.filter((e) => e.field === "difficulty"),
      ).toHaveLength(0);
    }
  });

  it("rejeita extractionConfidence fora do range 0-1", () => {
    const qNeg = makeExtractedQuestion({ extractionConfidence: -0.1 });
    expect(validateExtractedQuestion(qNeg).isValid).toBe(false);

    const qOver = makeExtractedQuestion({ extractionConfidence: 1.1 });
    expect(validateExtractedQuestion(qOver).isValid).toBe(false);

    const qNaN = makeExtractedQuestion({ extractionConfidence: NaN });
    expect(validateExtractedQuestion(qNaN).isValid).toBe(false);
  });

  it("gera warning para confiança baixa (< 0.5)", () => {
    const q = makeExtractedQuestion({ extractionConfidence: 0.3 });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(true); // É válida, mas com warning
    expect(result.warnings.some((e) => e.field === "extractionConfidence")).toBe(true);
  });

  it("gera warnings para dados incompletos (sem matéria, tópico, banca, ano)", () => {
    const q = makeExtractedQuestion({
      subjectLabel: null,
      topicLabel: null,
      contestMetadata: makeContestMetadata({ examBoard: null, year: null }),
    });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(true); // Dados incompletos não invalidam
    expect(result.warnings.some((e) => e.field === "subjectLabel")).toBe(true);
    expect(result.warnings.some((e) => e.field === "topicLabel")).toBe(true);
    expect(result.warnings.some((e) => e.field === "contestMetadata.examBoard")).toBe(true);
    expect(result.warnings.some((e) => e.field === "contestMetadata.year")).toBe(true);
  });

  it("é determinístico: mesmo input → mesmo output", () => {
    const q = makeExtractedQuestion();
    const r1 = validateExtractedQuestion(q);
    const r2 = validateExtractedQuestion(q);
    expect(r1).toEqual(r2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// processIngestionPayload
// ─────────────────────────────────────────────────────────────────────────────

describe("processIngestionPayload", () => {
  it("processa payload válido com 1 questão válida", () => {
    const payload = makePayload();
    const result = processIngestionPayload(payload, PROCESSED_AT);

    expect(result.payloadId).toBe("payload-1");
    expect(result.source).toBe("manual");
    expect(result.status).toBe("valida");
    expect(result.totalExtracted).toBe(1);
    expect(result.validQuestions).toHaveLength(1);
    expect(result.invalidQuestions).toHaveLength(0);
    expect(result.globalErrors).toHaveLength(0);
    expect(result.processedAt).toBe(PROCESSED_AT);
  });

  it("rejeita tipo de conteúdo não suportado", () => {
    const payload = makePayload({ contentType: "pdf_base64" });
    const result = processIngestionPayload(payload, PROCESSED_AT);

    expect(result.status).toBe("invalida");
    expect(result.totalExtracted).toBe(0);
    expect(result.globalErrors).toHaveLength(1);
    expect(result.globalErrors[0]).toContain("pdf_base64");
  });

  it("rejeita JSON inválido", () => {
    const payload = makePayload({ rawData: "não é json {[" });
    const result = processIngestionPayload(payload, PROCESSED_AT);

    expect(result.status).toBe("invalida");
    expect(result.globalErrors).toHaveLength(1);
    expect(result.globalErrors[0]).toContain("parse");
  });

  it("rejeita JSON que não é array", () => {
    const payload = makePayload({ rawData: JSON.stringify({ not: "an array" }) });
    const result = processIngestionPayload(payload, PROCESSED_AT);

    expect(result.status).toBe("invalida");
    expect(result.globalErrors).toHaveLength(1);
    expect(result.globalErrors[0]).toContain("array");
  });

  it("rejeita array vazio", () => {
    const payload = makePayload({ rawData: JSON.stringify([]) });
    const result = processIngestionPayload(payload, PROCESSED_AT);

    expect(result.status).toBe("invalida");
    expect(result.globalErrors).toHaveLength(1);
    expect(result.globalErrors[0]).toContain("vazio");
  });

  it("processa múltiplas questões válidas", () => {
    const questions = [
      makeExtractedQuestion({ extractionId: "ext-1" }),
      makeExtractedQuestion({ extractionId: "ext-2", statement: "Outra questão" }),
    ];
    const payload = makePayload({ rawData: JSON.stringify(questions) });
    const result = processIngestionPayload(payload, PROCESSED_AT);

    expect(result.status).toBe("valida");
    expect(result.totalExtracted).toBe(2);
    expect(result.validQuestions).toHaveLength(2);
    expect(result.invalidQuestions).toHaveLength(0);
  });

  it("separa questões válidas e inválidas", () => {
    const questions = [
      makeExtractedQuestion({ extractionId: "ext-1" }), // válida
      makeExtractedQuestion({ extractionId: "ext-2", statement: "" }), // inválida
      makeExtractedQuestion({ extractionId: "ext-3" }), // válida
    ];
    const payload = makePayload({ rawData: JSON.stringify(questions) });
    const result = processIngestionPayload(payload, PROCESSED_AT);

    expect(result.status).toBe("validando"); // mix → requer revisão
    expect(result.totalExtracted).toBe(3);
    expect(result.validQuestions).toHaveLength(2);
    expect(result.invalidQuestions).toHaveLength(1);
    expect(result.invalidQuestions[0]!.question.extractionId).toBe("ext-2");
  });

  it("retorna status invalida quando todas as questões são inválidas", () => {
    const questions = [
      makeExtractedQuestion({ extractionId: "ext-1", statement: "" }),
      makeExtractedQuestion({ extractionId: "ext-2", statement: "  " }),
    ];
    const payload = makePayload({ rawData: JSON.stringify(questions) });
    const result = processIngestionPayload(payload, PROCESSED_AT);

    expect(result.status).toBe("invalida");
    expect(result.validQuestions).toHaveLength(0);
    expect(result.invalidQuestions).toHaveLength(2);
  });

  it("preserva payloadId e source no resultado", () => {
    const payload = makePayload({ payloadId: "custom-id", source: "banco_externo" });
    const result = processIngestionPayload(payload, PROCESSED_AT);

    expect(result.payloadId).toBe("custom-id");
    expect(result.source).toBe("banco_externo");
  });

  it("é determinístico: mesmo input → mesmo output", () => {
    const payload = makePayload();
    const r1 = processIngestionPayload(payload, PROCESSED_AT);
    const r2 = processIngestionPayload(payload, PROCESSED_AT);
    expect(r1).toEqual(r2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapExtractedToQuestionBankInput
// ─────────────────────────────────────────────────────────────────────────────

describe("mapExtractedToQuestionBankInput", () => {
  it("converte questão extraída para formato do banco", () => {
    const q = makeExtractedQuestion();
    const input = mapExtractedToQuestionBankInput(q, "manual");

    expect(input.statement).toBe("Qual é a capital do Brasil?");
    expect(input.alternatives).toHaveLength(4);
    expect(input.correctAnswer).toBe("A");
    expect(input.isTrueFalse).toBe(false);
    expect(input.examBoard).toBe("CESPE");
    expect(input.contestName).toBe("TRF 1ª Região");
    expect(input.year).toBe(2024);
    expect(input.difficulty).toBe(2);
    expect(input.origin).toBe("manual");
    expect(input.novelty).toBe("nova");
    expect(input.tags).toEqual(["geografia", "capitais"]);
    expect(input.explanation).toBe("Brasília é a capital federal desde 1960.");
    expect(input.isPublic).toBe(false);
  });

  it("converte alternativas para formato simples {letter, text}", () => {
    const q = makeExtractedQuestion();
    const input = mapExtractedToQuestionBankInput(q, "manual");

    const alt = input.alternatives[0] as { letter: string; text: string };
    expect(alt.letter).toBe("A");
    expect(alt.text).toBe("Brasília");
    // isCorrect não é incluído (o banco usa correctAnswer separado)
    expect(alt).not.toHaveProperty("isCorrect");
  });

  it("mapeia source manual → origin manual", () => {
    const q = makeExtractedQuestion();
    const input = mapExtractedToQuestionBankInput(q, "manual");
    expect(input.origin).toBe("manual");
  });

  it("mapeia source imagem_print → origin ocr", () => {
    const q = makeExtractedQuestion();
    const input = mapExtractedToQuestionBankInput(q, "imagem_print");
    expect(input.origin).toBe("ocr");
  });

  it("mapeia source pdf_prova → origin ocr", () => {
    const q = makeExtractedQuestion();
    const input = mapExtractedToQuestionBankInput(q, "pdf_prova");
    expect(input.origin).toBe("ocr");
  });

  it("mapeia source banco_externo → origin banco_externo", () => {
    const q = makeExtractedQuestion();
    const input = mapExtractedToQuestionBankInput(q, "banco_externo");
    expect(input.origin).toBe("banco_externo");
  });

  it("mapeia source api_externa → origin banco_externo", () => {
    const q = makeExtractedQuestion();
    const input = mapExtractedToQuestionBankInput(q, "api_externa");
    expect(input.origin).toBe("banco_externo");
  });

  it("mapeia source importacao_csv → origin banco_externo", () => {
    const q = makeExtractedQuestion();
    const input = mapExtractedToQuestionBankInput(q, "importacao_csv");
    expect(input.origin).toBe("banco_externo");
  });

  it("preserva campos null", () => {
    const q = makeExtractedQuestion({
      correctAnswer: null,
      explanation: null,
      difficulty: null,
      contestMetadata: makeContestMetadata({ examBoard: null, contestName: null, year: null }),
    });
    const input = mapExtractedToQuestionBankInput(q, "manual");

    expect(input.correctAnswer).toBeNull();
    expect(input.explanation).toBeNull();
    expect(input.difficulty).toBeNull();
    expect(input.examBoard).toBeNull();
    expect(input.contestName).toBeNull();
    expect(input.year).toBeNull();
  });

  it("cria cópia das tags (não compartilha referência)", () => {
    const q = makeExtractedQuestion({ tags: ["original"] });
    const input = mapExtractedToQuestionBankInput(q, "manual");
    input.tags.push("adicionada");
    expect(q.tags).toEqual(["original"]); // original não mudou
  });

  it("é determinístico: mesmo input → mesmo output", () => {
    const q = makeExtractedQuestion();
    const r1 = mapExtractedToQuestionBankInput(q, "manual");
    const r2 = mapExtractedToQuestionBankInput(q, "manual");
    expect(r1).toEqual(r2);
  });
});
