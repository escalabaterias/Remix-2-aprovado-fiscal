/**
 * TESTE DE ACEITAÇÃO DO FLUXO INTEGRADO — ETAPA 6.8
 *
 * Valida a esteira completa ponta a ponta:
 *   print completo → Gemini → extração → normalização → criação/reutilização de matéria
 *   → tópico → concurso → fonte → metadados → deduplicação → Supabase → retorno para UI → resolução da questão
 *
 * Cobertura de cenários reais:
 *   1. Fluxo completo: extração de print com metadados ricos → entidades criadas → questão no banco → UI → resposta correta → atualização de stats e knowledge
 *   2. Reutilização de entidades: segunda questão na mesma matéria/tópico/concurso reaproveita IDs existentes sem duplicar
 *   3. Deduplicação por content_hash: reingestão de questão idêntica reutiliza a questão existente sem novo insert
 *   4. Resolução com erro: resposta incorreta gera entrada na Central de Erros e atualiza histórico de conhecimento
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImageExtractionRequest } from "./adapters/image-adapter";

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY SUPABASE CLIENT MOCK
// ─────────────────────────────────────────────────────────────────────────────

const TEST_USER_ID = "user-acceptance-test-123";

let currentMockDb: ReturnType<typeof createInMemorySupabase>;

function createInMemorySupabase() {
  const store: Record<string, Array<Record<string, unknown>>> = {
    subjects: [],
    topics: [],
    contests: [],
    sources: [],
    questions: [],
    question_stats: [],
    question_attempts: [],
    error_entries: [],
    user_topic_knowledge: [],
    knowledge_history: [],
  };

  let idCounter = 1;
  const nextId = (prefix: string) => `${prefix}-${idCounter++}`;

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: TEST_USER_ID, email: "concurseiro@teste.com" } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      const tableRows = store[table] ?? (store[table] = []);

      return {
        select: vi.fn((_columns = "*", _options?: unknown) => {
          let currentRows = [...tableRows];

          const builder: Record<string, unknown> = {
            eq: vi.fn((col: string, val: unknown) => {
              currentRows = currentRows.filter((r) => r[col] === val);
              return builder;
            }),
            ilike: vi.fn((col: string, val: string) => {
              const cleanVal = val.replace(/%/g, "").toLowerCase();
              currentRows = currentRows.filter((r) => {
                const cell = String(r[col] ?? "").toLowerCase();
                return cell === cleanVal || cell.includes(cleanVal);
              });
              return builder;
            }),
            filter: vi.fn((col: string, _op: string, val: unknown) => {
              if (col === "metadata->>content_hash") {
                currentRows = currentRows.filter((r) => {
                  const meta = r.metadata as Record<string, unknown> | undefined;
                  return meta && meta.content_hash === val;
                });
              } else {
                currentRows = currentRows.filter((r) => r[col] === val);
              }
              return builder;
            }),
            order: vi.fn(() => builder),
            limit: vi.fn((n: number) => {
              currentRows = currentRows.slice(0, n);
              return builder;
            }),
            maybeSingle: vi.fn(async () => {
              return { data: currentRows[0] ?? null, error: null };
            }),
            single: vi.fn(async () => {
              if (currentRows.length === 0) {
                return { data: null, error: { message: "Row not found", code: "PGRST116" } };
              }
              return { data: currentRows[0], error: null };
            }),
            then: (resolve: (res: { data: unknown[]; error: null; count: number }) => void) => {
              return Promise.resolve({
                data: currentRows,
                error: null,
                count: currentRows.length,
              }).then(resolve);
            },
          };

          return builder;
        }),

        insert: vi.fn((payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
          const items = Array.isArray(payload) ? payload : [payload];
          const inserted: Array<Record<string, unknown>> = [];

          for (const item of items) {
            const row = {
              id: item.id ?? nextId(table.slice(0, 3)),
              created_at: new Date().toISOString(),
              ...item,
            };
            tableRows.push(row);
            inserted.push(row);
          }

          const builder = {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: inserted[0], error: null })),
              maybeSingle: vi.fn(async () => ({ data: inserted[0] ?? null, error: null })),
              then: (resolve: (res: { data: unknown[]; error: null }) => void) =>
                Promise.resolve({ data: inserted, error: null }).then(resolve),
            })),
            single: vi.fn(async () => ({ data: inserted[0], error: null })),
          };

          return builder;
        }),

        upsert: vi.fn((payload: Record<string, unknown>, options?: { onConflict?: string }) => {
          const conflictCols = (options?.onConflict ?? "")
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
          let row =
            conflictCols.length > 0
              ? tableRows.find((r) => conflictCols.every((col) => r[col] === payload[col]))
              : null;

          if (row) {
            Object.assign(row, payload);
          } else {
            row = {
              id: payload.id ?? nextId(table.slice(0, 3)),
              created_at: new Date().toISOString(),
              ...payload,
            };
            tableRows.push(row);
          }

          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: row, error: null })),
              maybeSingle: vi.fn(async () => ({ data: row, error: null })),
            })),
            single: vi.fn(async () => ({ data: row, error: null })),
          };
        }),
      };
    }),
  } as unknown as SupabaseClient;

  return { client, store };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () => currentMockDb?.client.auth.getUser(),
    },
    from: (...args: [string]) => currentMockDb?.client.from(...args),
  },
}));

import { extractAndCreateQuestions } from "./providers/gemini-service";
import { submitAnswer } from "./attempt-service";
import type { RawProviderResult } from "./extraction";

// ─────────────────────────────────────────────────────────────────────────────
// SUÍTE DE TESTES DE ACEITAÇÃO INTEGRADA
// ─────────────────────────────────────────────────────────────────────────────

describe("ETAPA 6.8 — Teste de Aceitação do Fluxo Integrado", () => {
  let mockDb: ReturnType<typeof createInMemorySupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createInMemorySupabase();
    currentMockDb = mockDb;
  });

  it("Executa fluxo real completo: print → Gemini → extração → normalização → matéria → tópico → concurso → fonte → metadados → Supabase → UI → resolução com acerto", async () => {
    const rawImageRequest: ImageExtractionRequest = {
      payloadId: "payload-print-trf5-001",
      contentType: "image_base64",
      imageData:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      contestMetadata: {
        examBoard: "CESPE / CEBRASPE",
        contestName: "Concurso Público TRF5",
        year: 2025,
        position: "Analista Judiciário - Área Judiciária",
        organization: "Tribunal Regional Federal da 5ª Região",
      },
      sourceMetadata: {
        fileName: "questoes_trf5_constitucional.png",
        fileSize: 450200,
        mimeType: "image/png",
      },
      receivedAt: new Date().toISOString(),
    };

    // Resposta bruta do provedor Gemini (após parse do JSON)
    const geminiRawResult: RawProviderResult = {
      success: true,
      questions: [
        {
          statement:
            "Acerca dos direitos e garantias fundamentais previstos na Constituição Federal de 1988, é correto afirmar que a casa é asilo inviolável do indivíduo, nela ninguém podendo penetrar sem consentimento do morador, salvo em caso de flagrante delito ou desastre, ou para prestar socorro, ou, durante o dia, por determinação judicial.",
          alternatives: [
            { letter: "A", text: "Apenas por ordem do delegado de polícia a qualquer hora." },
            {
              letter: "B",
              text: "Durante o dia, por determinação judicial, ou a qualquer hora em flagrante delito, desastre ou para prestar socorro.",
            },
            {
              letter: "C",
              text: "Mesmo à noite por determinação judicial com mandado de busca e apreensão.",
            },
            {
              letter: "D",
              text: "Somente com consentimento expresso do proprietário, sem qualquer exceção legal.",
            },
          ],
          correctAnswer: "B",
          isTrueFalse: false,
          subject: "Direito Constitucional",
          topic: "Direitos e Deveres Individuais e Coletivos",
          difficulty: 2,
          explanation:
            "Art. 5º, XI, CF/88: a casa é asilo inviolável do indivíduo, ninguém nela podendo penetrar sem consentimento do morador, salvo em caso de flagrante delito ou desastre, ou para prestar socorro, ou, durante o dia, por determinação judicial.",
          tags: ["art-5", "inviolabilidade-domiciliar", "garantias-fundamentais"],
          examBoard: "CESPE",
          contestName: "Concurso TRF5 2025",
          year: 2025,
          position: "Analista Judiciário",
          organization: "TRF 5ª Região",
          examName: "Prova Objetiva - Conhecimentos Específicos",
          questionNumber: 14,
          sourceTitle: "Caderno de Questões TRF5 - Caderno Branco",
          sourceUrl: "https://cebraspe.org.br/concursos/trf5_2025",
          externalId: "TRF5-2025-Q14",
        },
      ],
      overallConfidence: 0.95,
      processingTimeMs: 1200,
    };

    // 1. Extração e ingestão com Gemini
    const result = await extractAndCreateQuestions(
      rawImageRequest,
      {
        extractFn: async () => {
          const { convertProviderResult } = await import("./extraction");
          return convertProviderResult(geminiRawResult, rawImageRequest);
        },
      },
      mockDb.client,
    );

    // ── Validações da Ingestão ──
    expect(result.creationErrors).toHaveLength(0);
    expect(result.created).toHaveLength(1);

    const createdQuestion = result.created[0]!;
    expect(createdQuestion.questionId).toBeDefined();
    expect(createdQuestion.statement).toContain("asilo inviolável do indivíduo");
    expect(createdQuestion.alternatives).toHaveLength(4);
    expect(createdQuestion.correctAnswer).toBe("B");
    expect(createdQuestion.examBoard).toBe("CEBRASPE"); // normalizado de "CESPE"
    expect(createdQuestion.origin).toBe("ocr"); // mapSourceToOrigin("imagem_print") -> "ocr"

    // Metadados estruturados JSONB retornados e visíveis
    expect(createdQuestion.metadata).toBeDefined();
    expect(createdQuestion.metadata?.position).toBe("Analista Judiciário - Área Judiciária");
    expect(createdQuestion.metadata?.organization).toBe("Tribunal Regional Federal da 5ª Região");
    expect(createdQuestion.metadata?.question_number).toBe(14);
    expect(createdQuestion.metadata?.source_title).toBe(
      "Caderno de Questões TRF5 - Caderno Branco",
    );
    expect(createdQuestion.metadata?.content_hash).toBeDefined();

    // Verificação de persistência no banco Supabase em todas as entidades relacionadas
    expect(mockDb.store.subjects).toHaveLength(1);
    expect(mockDb.store.subjects[0]!.name).toBe("Direito Constitucional");
    expect(createdQuestion.subjectId).toBe(mockDb.store.subjects[0]!.id);

    expect(mockDb.store.topics).toHaveLength(1);
    expect(mockDb.store.topics[0]!.name).toBe("Direitos e Deveres Individuais e Coletivos");
    expect(createdQuestion.topicId).toBe(mockDb.store.topics[0]!.id);

    expect(mockDb.store.contests).toHaveLength(1);
    expect(mockDb.store.contests[0]!.name).toBe("Concurso Público TRF5");
    expect(createdQuestion.contestId).toBe(mockDb.store.contests[0]!.id);

    expect(mockDb.store.sources).toHaveLength(1);
    expect(mockDb.store.sources[0]!.title).toBe("Caderno de Questões TRF5 - Caderno Branco");

    expect(mockDb.store.questions).toHaveLength(1);
    expect(mockDb.store.questions[0]!.id).toBe(createdQuestion.questionId);

    // 2. Simulação de Resolução da Questão na UI (Aluno acerta a questão)
    const attemptResult = await submitAnswer({
      questionId: createdQuestion.questionId,
      chosenAnswer: "B",
      isCorrect: true,
      timeSpentSeconds: 45,
      mode: "pratica",
      declaredConfidence: 4,
      notes: "Lembrar da exceção: durante o dia por determinação judicial",
    });

    // ── Validações da Resolução e Atualização de Conhecimento ──
    expect(attemptResult.attemptId).toBeDefined();
    expect(attemptResult.attemptNumber).toBe(1);
    expect(attemptResult.feedback.isCorrect).toBe(true);
    expect(attemptResult.feedback.currentStreak).toBe(1);
    expect(attemptResult.updatedStats.accuracy).toBe(1.0);
    expect(attemptResult.updatedStats.streakCorrect).toBe(1);
    expect(attemptResult.errorCreated).toBe(false);
    expect(attemptResult.knowledgeUpdated).toBe(true);

    // Verifica que question_attempts e question_stats foram gravados
    expect(mockDb.store.question_attempts).toHaveLength(1);
    expect(mockDb.store.question_attempts[0]!.question_id).toBe(createdQuestion.questionId);
    expect(mockDb.store.question_attempts[0]!.chosen_answer).toBe("B");
    expect(mockDb.store.question_attempts[0]!.is_correct).toBe(true);

    expect(mockDb.store.question_stats).toHaveLength(1);
    expect(mockDb.store.question_stats[0]!.total_attempts).toBe(1);
    expect(mockDb.store.question_stats[0]!.correct_count).toBe(1);
    expect(mockDb.store.question_stats[0]!.streak_correct).toBe(1);

    // Verifica que o tópico teve seu domínio (mastery/confidence) atualizado
    expect(mockDb.store.user_topic_knowledge).toHaveLength(1);
    expect(mockDb.store.user_topic_knowledge[0]!.topic_id).toBe(createdQuestion.topicId);
    expect(Number(mockDb.store.user_topic_knowledge[0]!.mastery)).toBeGreaterThan(0);
    expect(Number(mockDb.store.user_topic_knowledge[0]!.confidence)).toBeGreaterThan(0);
  });

  it("Deduplica questão com mesmo content_hash e não duplica matérias/tópicos/concursos já existentes", async () => {
    // 1. Cria a primeira questão
    const request1: ImageExtractionRequest = {
      payloadId: "payload-1",
      contentType: "image_base64",
      imageData: "data:image/png;base64,abc1",
      contestMetadata: {
        examBoard: "FGV",
        contestName: "OAB XL",
        year: 2024,
        position: null,
        organization: null,
      },
      sourceMetadata: { fileName: "p1.png", fileSize: 1000, mimeType: "image/png" },
      receivedAt: new Date().toISOString(),
    };

    const statement =
      "No direito penal brasileiro, o princípio da legalidade estabelece que não há crime sem lei anterior que o defina.";
    const alternatives = [
      { letter: "A", text: "Permite criação de crimes por medida provisória." },
      { letter: "B", text: "Exige lei estrita, prévia e certa." },
    ];

    const geminiResult1: RawProviderResult = {
      success: true,
      questions: [
        {
          statement,
          alternatives,
          correctAnswer: "B",
          isTrueFalse: false,
          subject: "Direito Penal",
          topic: "Princípios Fundamentais",
          difficulty: 1,
          tags: ["legalidade"],
          examBoard: "FGV",
          contestName: "OAB XL",
          year: 2024,
        },
      ],
    };

    const res1 = await extractAndCreateQuestions(
      request1,
      {
        extractFn: async () => {
          const { convertProviderResult } = await import("./extraction");
          return convertProviderResult(geminiResult1, request1);
        },
      },
      mockDb.client,
    );

    expect(res1.created).toHaveLength(1);
    const q1Id = res1.created[0]!.questionId;
    expect(mockDb.store.questions).toHaveLength(1);
    expect(mockDb.store.subjects).toHaveLength(1);
    expect(mockDb.store.topics).toHaveLength(1);
    expect(mockDb.store.contests).toHaveLength(1);

    // 2. Cria uma segunda questão DIFERENTE na MESMA matéria, tópico e concurso
    const statement2 =
      "A ultratividade da lei penal mais benéfica opera mesmo após o trânsito em julgado da sentença condenatória.";
    const geminiResult2: RawProviderResult = {
      success: true,
      questions: [
        {
          statement: statement2,
          alternatives,
          correctAnswer: "B",
          isTrueFalse: false,
          subject: "Direito Penal", // mesma matéria
          topic: "Princípios Fundamentais", // mesmo tópico
          difficulty: 3,
          tags: ["ultratividade"],
          examBoard: "FGV",
          contestName: "OAB XL",
          year: 2024,
        },
      ],
    };

    const res2 = await extractAndCreateQuestions(
      request1,
      {
        extractFn: async () => {
          const { convertProviderResult } = await import("./extraction");
          return convertProviderResult(geminiResult2, request1);
        },
      },
      mockDb.client,
    );

    expect(res2.created).toHaveLength(1);
    expect(mockDb.store.questions).toHaveLength(2); // Nova questão criada
    expect(mockDb.store.subjects).toHaveLength(1); // Matéria reutilizada (0 duplicatas!)
    expect(mockDb.store.topics).toHaveLength(1); // Tópico reutilizado (0 duplicatas!)
    expect(mockDb.store.contests).toHaveLength(1); // Concurso reutilizado (0 duplicatas!)

    // 3. Tenta reinserir a PRIMEIRA questão (mesmo enunciado e alternativas = mesmo content_hash)
    const res3 = await extractAndCreateQuestions(
      request1,
      {
        extractFn: async () => {
          const { convertProviderResult } = await import("./extraction");
          return convertProviderResult(geminiResult1, request1);
        },
      },
      mockDb.client,
    );

    expect(res3.created).toHaveLength(1);
    // Deduplicação ativa: retorna o mesmo questionId da primeira ingestão sem novo registro na tabela questions
    expect(res3.created[0]!.questionId).toBe(q1Id);
    expect(mockDb.store.questions).toHaveLength(2); // Continua 2 questões, nenhuma duplicata!
  });

  it("Trata resolução com erro: alimenta Central de Erros e penaliza mastery conforme dificuldade", async () => {
    // 1. Ingestão de questão difícil
    const request: ImageExtractionRequest = {
      payloadId: "payload-erro-test",
      contentType: "image_base64",
      imageData: "data:image/png;base64,erro",
      contestMetadata: {
        examBoard: "VUNESP",
        contestName: "TJSP Escrevente",
        year: 2024,
        position: null,
        organization: null,
      },
      sourceMetadata: { fileName: "tjsp.png", fileSize: 2000, mimeType: "image/png" },
      receivedAt: new Date().toISOString(),
    };

    const geminiResult: RawProviderResult = {
      success: true,
      questions: [
        {
          statement:
            "Sobre a responsabilidade civil do Estado no ordenamento jurídico brasileiro...",
          alternatives: [
            { letter: "A", text: "É estritamente subjetiva em todos os casos." },
            {
              letter: "B",
              text: "É objetiva na modalidade risco administrativo para atos comissivos.",
            },
          ],
          correctAnswer: "B",
          isTrueFalse: false,
          subject: "Direito Administrativo",
          topic: "Responsabilidade Civil do Estado",
          difficulty: 4, // Difícil
          explanation: "Art. 37, §6º da CF/88 adota a teoria do risco administrativo.",
          examBoard: "VUNESP",
          contestName: "TJSP 2024",
          year: 2024,
        },
      ],
    };

    const ingestionResult = await extractAndCreateQuestions(
      request,
      {
        extractFn: async () => {
          const { convertProviderResult } = await import("./extraction");
          return convertProviderResult(geminiResult, request);
        },
      },
      mockDb.client,
    );

    const question = ingestionResult.created[0]!;

    // 2. Aluno erra a questão
    const attemptResult = await submitAnswer({
      questionId: question.questionId,
      chosenAnswer: "A", // Resposta incorreta
      isCorrect: false,
      timeSpentSeconds: 60,
      mode: "pratica",
    });

    expect(attemptResult.feedback.isCorrect).toBe(false);
    expect(attemptResult.feedback.currentStreak).toBe(-1);
    expect(attemptResult.updatedStats.streakWrong).toBe(1);
    expect(attemptResult.errorCreated).toBe(true);
    expect(attemptResult.errorEntryId).toBeDefined();

    // Central de Erros recebeu a ocorrência
    expect(mockDb.store.error_entries).toHaveLength(1);
    expect(mockDb.store.error_entries[0]!.question_id).toBe(question.questionId);
    expect(mockDb.store.error_entries[0]!.topic_id).toBe(question.topicId);

    // Knowledge Engine foi acionado registrando a evolução no histórico
    expect(mockDb.store.user_topic_knowledge).toHaveLength(1);
    expect(mockDb.store.knowledge_history).toHaveLength(1);
    expect(mockDb.store.knowledge_history[0]!.attempt_id).toBe(attemptResult.attemptId);
    expect(mockDb.store.knowledge_history[0]!.topic_id).toBe(question.topicId);
  });
});
