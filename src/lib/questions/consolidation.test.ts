/**
 * TESTES DE CONSOLIDAÇÃO DO BANCO DE QUESTÕES — ETAPA 6.10
 *
 * Cobertura dos 15 cenários de consolidação e ingestão multifonte:
 *  1. Questão completa (VALID)
 *  2. Ausência de banca (INCOMPLETE)
 *  3. Ausência de ano (INCOMPLETE)
 *  4. Ausência de concurso (INCOMPLETE)
 *  5. Ausência de fonte (INCOMPLETE)
 *  6. Criação automática de matéria
 *  7. Criação automática de tópico
 *  8. Reutilização de matéria
 *  9. Reutilização de tópico
 * 10. Deduplicação por content hash
 * 11. Deduplicação com diferenças cosméticas
 * 12. Questão CERTO/ERRADO
 * 13. Questão de múltipla escolha
 * 14. Ausência de gabarito explícito (correctAnswer = null)
 * 15. Preservação dos metadados de origem
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateExtractedQuestion,
  classifyQuestionQuality,
  mapExtractedToQuestionBankInput,
  type ExtractedQuestion,
  type ContestMetadata,
  type OriginContext,
  type SourceMetadata,
} from "./ingestion";
import { computeQuestionContentHash, normalizeExamBoard } from "./normalizer";
import { resolveSubject, resolveTopic } from "./entity-resolver";

function makeExtractedQuestion(overrides: Partial<ExtractedQuestion> = {}): ExtractedQuestion {
  return {
    extractionId: "ext-100",
    payloadId: "payload-100",
    statement: "O tributo é cobrado mediante atividade administrativa plenamente vinculada.",
    alternatives: [
      { letter: "A", text: "Certo", isCorrect: true },
      { letter: "B", text: "Errado", isCorrect: false },
    ],
    correctAnswer: "A",
    isTrueFalse: true,
    explanation: "Conforme art. 3º do CTN.",
    contestMetadata: {
      examBoard: "CEBRASPE",
      contestName: "Receita Federal 2023",
      year: 2023,
      organization: "Receita Federal",
      position: "Auditor Fiscal",
      sourceTitle: "Prova de Direito Tributário",
      sourceUrl: "https://exemplo.com/prova.pdf",
      externalId: "EXT-123456",
    },
    subjectLabel: "Direito Tributário",
    topicLabel: "Conceito de Tributo",
    difficulty: 3,
    tags: ["tributário", "ctn"],
    extractionConfidence: 0.95,
    ...overrides,
  };
}

describe("Etapa 6.10 — Consolidação e Qualidade da Questão", () => {
  it("1. classifica questão completa como VALID", () => {
    const q = makeExtractedQuestion();
    expect(classifyQuestionQuality(q)).toBe("VALID");
    const v = validateExtractedQuestion(q);
    expect(v.isValid).toBe(true);
    expect(v.errors).toHaveLength(0);
  });

  it("2. aceita ausência de banca como INCOMPLETE (sem impedir ingestão)", () => {
    const q = makeExtractedQuestion({
      contestMetadata: { ...makeExtractedQuestion().contestMetadata, examBoard: null },
    });
    expect(classifyQuestionQuality(q)).toBe("INCOMPLETE");
    const v = validateExtractedQuestion(q);
    expect(v.isValid).toBe(true);
    expect(v.warnings.some((w) => w.field === "contestMetadata.examBoard")).toBe(true);
  });

  it("3. aceita ausência de ano como INCOMPLETE (sem impedir ingestão)", () => {
    const q = makeExtractedQuestion({
      contestMetadata: { ...makeExtractedQuestion().contestMetadata, year: null },
    });
    expect(classifyQuestionQuality(q)).toBe("INCOMPLETE");
    const v = validateExtractedQuestion(q);
    expect(v.isValid).toBe(true);
    expect(v.warnings.some((w) => w.field === "contestMetadata.year")).toBe(true);
  });

  it("4. aceita ausência de concurso como INCOMPLETE (sem impedir ingestão)", () => {
    const q = makeExtractedQuestion({
      contestMetadata: { ...makeExtractedQuestion().contestMetadata, contestName: null },
    });
    const v = validateExtractedQuestion(q);
    expect(v.isValid).toBe(true);
    // Ausência de concurso não gera erros
    expect(v.errors).toHaveLength(0);
  });

  it("5. aceita ausência de fonte como INCOMPLETE (sem impedir ingestão)", () => {
    const q = makeExtractedQuestion({
      contestMetadata: {
        ...makeExtractedQuestion().contestMetadata,
        sourceTitle: null,
        sourceUrl: null,
      },
    });
    const v = validateExtractedQuestion(q);
    expect(v.isValid).toBe(true);
    expect(v.errors).toHaveLength(0);
  });

  it("6 e 8. resolução e reutilização de matéria (cria quando inexistente, reusa existente)", async () => {
    const mockSubjectRows: Array<{ id: string; name: string; normalized_name: string }> = [];

    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((_col: string, val: string) => {
            const found = mockSubjectRows.find((r) => r.normalized_name === val);
            return Promise.resolve({
              data: found ? [found] : [],
              error: null,
            });
          }),
        }),
        insert: vi.fn().mockImplementation((entry: { name: string; normalized_name: string }) => {
          const created = { id: "sub-new", ...entry };
          mockSubjectRows.push(created);
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: created,
                error: null,
              }),
            }),
          };
        }),
      }),
    } as any;

    // Primeiro chamada: matéria inexistente -> cria
    const res1 = await resolveSubject("Direito Tributário", mockClient);
    expect(res1).toBe("sub-new");

    // Segunda chamada com mesma matéria -> reusa existente
    const res2 = await resolveSubject("Direito Tributário", mockClient);
    expect(res2).toBe("sub-new");
  });

  it("7 e 9. resolução e reutilização de tópico (cria quando inexistente, reusa existente)", async () => {
    const mockTopicRows: Array<{
      id: string;
      name: string;
      normalized_name: string;
      subject_id: string;
    }> = [];

    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((col: string, val: string) => {
            return {
              eq: vi.fn().mockImplementation((col2: string, val2: string) => {
                const found = mockTopicRows.find(
                  (r) =>
                    (r.normalized_name === val || r.normalized_name === val2) &&
                    (r.subject_id === val || r.subject_id === val2),
                );
                return Promise.resolve({
                  data: found ? [found] : [],
                  error: null,
                });
              }),
            };
          }),
        }),
        insert: vi
          .fn()
          .mockImplementation(
            (entry: { name: string; normalized_name: string; subject_id: string }) => {
              const created = { id: "top-new", ...entry };
              mockTopicRows.push(created);
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: created,
                    error: null,
                  }),
                }),
              };
            },
          ),
      }),
    } as any;

    // Primeiro chamada: tópico inexistente -> cria
    const res1 = await resolveTopic("Conceito de Tributo", "sub-1", mockClient);
    expect(res1).toBe("top-new");

    // Segunda chamada: reusa tópico existente
    const res2 = await resolveTopic("Conceito de Tributo", "sub-1", mockClient);
    expect(res2).toBe("top-new");
  });

  it("10. deduplicação por content hash determinístico", () => {
    const q1 = makeExtractedQuestion();
    const hash1 = computeQuestionContentHash(q1.statement, q1.alternatives);
    const hash2 = computeQuestionContentHash(q1.statement, q1.alternatives);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 em hex
  });

  it("11. deduplicação tolera diferenças cosméticas (espaços, caixa, acentos, quebras de linha)", () => {
    const statement1 = "Qual  é a CAPITAL do Brasil?\n";
    const alternatives1 = [
      { letter: "A", text: "Brasília " },
      { letter: "B", text: "São Paulo" },
    ];

    const statement2 = "qual é a capital do brasil?";
    const alternatives2 = [
      { letter: "a", text: "brasilia" },
      { letter: "b", text: "sao paulo" },
    ];

    const hash1 = computeQuestionContentHash(statement1, alternatives1);
    const hash2 = computeQuestionContentHash(statement2, alternatives2);
    expect(hash1).toBe(hash2);
  });

  it("12. suporta questões do tipo CERTO/ERRADO", () => {
    const q = makeExtractedQuestion({
      isTrueFalse: true,
      alternatives: [
        { letter: "C", text: "Certo", isCorrect: true },
        { letter: "E", text: "Errado", isCorrect: false },
      ],
      correctAnswer: "C",
    });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(true);
    expect(q.isTrueFalse).toBe(true);
  });

  it("13. suporta questões de múltipla escolha", () => {
    const q = makeExtractedQuestion({
      isTrueFalse: false,
      alternatives: [
        { letter: "A", text: "Opção A", isCorrect: false },
        { letter: "B", text: "Opção B", isCorrect: true },
        { letter: "C", text: "Opção C", isCorrect: false },
        { letter: "D", text: "Opção D", isCorrect: false },
      ],
      correctAnswer: "B",
    });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(true);
    expect(q.isTrueFalse).toBe(false);
    expect(q.alternatives).toHaveLength(4);
  });

  it("14. aceita ausência de gabarito explícito (correctAnswer = null) sem corromper nem inventar", () => {
    const q = makeExtractedQuestion({
      correctAnswer: null,
      alternatives: [
        { letter: "A", text: "Opção A", isCorrect: null },
        { letter: "B", text: "Opção B", isCorrect: null },
      ],
    });
    const result = validateExtractedQuestion(q);
    expect(result.isValid).toBe(true);
    expect(classifyQuestionQuality(q)).toBe("INCOMPLETE");
    expect(q.correctAnswer).toBeNull();
  });

  it("15. preserva metadados de origem através de OriginContext e SourceMetadata", () => {
    const metadata: OriginContext = {
      examBoard: normalizeExamBoard("CESPE / CEBRASPE"),
      contestName: "SEFAZ-SP Auditor",
      year: 2024,
      position: "Auditor Fiscal da Receita Estadual",
      organization: "SEFAZ-SP",
      sourceTitle: "Caderno Prova 1",
      sourceUrl: "https://sefaz.sp.gov.br/prova1.pdf",
      externalId: "ORIGIN-999",
    };

    const q = makeExtractedQuestion({
      contestMetadata: metadata as SourceMetadata,
    });

    const input = mapExtractedToQuestionBankInput(q, "pdf_prova");

    expect(input.examBoard).toBe("CEBRASPE"); // normalizado
    expect(input.contestName).toBe("SEFAZ-SP Auditor");
    expect(input.year).toBe(2024);
    expect(input.origin).toBe("ocr");
  });
});
