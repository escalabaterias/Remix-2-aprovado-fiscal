import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeName, resolveSubject, resolveTopic, resolveContest } from "./entity-resolver";
import { extractAndCreateQuestions, mapExtractedToCreateInput } from "./providers/gemini-service";
import type { ExtractedQuestion } from "./ingestion";
import type { ImageExtractionRequest } from "./adapters/image-adapter";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS & MOCKS
// ─────────────────────────────────────────────────────────────────────────────

const FAKE_USER_ID = "user-123-uuid";

function createMockSupabaseClient(overrides?: {
  getUserError?: Error | null;
  subjects?: { id: string; name: string }[];
  topics?: { id: string; name: string; subject_id?: string }[];
  contests?: { id: string; name: string }[];
  insertSubjectResult?: { id: string };
  insertSubjectError?: Error | null;
  insertTopicResult?: { id: string };
  insertTopicError?: Error | null;
  insertContestResult?: { id: string };
  insertContestError?: Error | null;
  insertQuestionResult?: Record<string, unknown>;
  insertQuestionError?: Error | null;
}) {
  const subjectsData = overrides?.subjects ?? [];
  const topicsData = overrides?.topics ?? [];
  const contestsData = overrides?.contests ?? [];
  const insertSubjectResult = overrides?.insertSubjectResult ?? { id: "new-subject-uuid" };
  const insertTopicResult = overrides?.insertTopicResult ?? { id: "new-topic-uuid" };
  const insertContestResult = overrides?.insertContestResult ?? { id: "new-contest-uuid" };
  const insertQuestionResult = overrides?.insertQuestionResult ?? {
    id: "new-question-uuid",
    user_id: FAKE_USER_ID,
    statement: "Questão teste",
    alternatives: [],
    correct_answer: "A",
    is_true_false: false,
    exam_board: "CESPE",
    contest_name: "SEFAZ",
    contest_id: null,
    year: 2025,
    subject_id: "sub-123",
    topic_id: "top-456",
    difficulty: 3,
    origin: "ocr",
    novelty: null,
    tags: [],
    explanation: null,
    is_public: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    subject: { id: "sub-123", name: "Direito Tributário" },
    topic: { id: "top-456", name: "Impostos Municipais" },
    contest: null,
  };

  const insertedSubjects: Record<string, unknown>[] = [];
  const insertedTopics: Record<string, unknown>[] = [];
  const insertedContests: Record<string, unknown>[] = [];
  const insertedQuestions: Record<string, unknown>[] = [];

  const client = {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue(
          overrides?.getUserError
            ? { data: { user: null }, error: overrides.getUserError }
            : { data: { user: { id: FAKE_USER_ID } }, error: null },
        ),
    },
    from: vi.fn((table: string) => {
      if (table === "subjects") {
        return {
          select: vi.fn(() => ({
            then: (resolve: (val: unknown) => void) => resolve({ data: subjectsData, error: null }),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => {
            insertedSubjects.push(payload);
            return {
              select: vi.fn(() => ({
                single: vi
                  .fn()
                  .mockResolvedValue(
                    overrides?.insertSubjectError
                      ? { data: null, error: overrides.insertSubjectError }
                      : { data: insertSubjectResult, error: null },
                  ),
              })),
            };
          }),
        };
      }

      if (table === "contests") {
        return {
          select: vi.fn(() => ({
            then: (resolve: (val: unknown) => void) => resolve({ data: contestsData, error: null }),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: {}, error: null }),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => {
            insertedContests.push(payload);
            return {
              select: vi.fn(() => ({
                single: vi
                  .fn()
                  .mockResolvedValue(
                    overrides?.insertContestError
                      ? { data: null, error: overrides.insertContestError }
                      : { data: insertContestResult, error: null },
                  ),
              })),
            };
          }),
        };
      }

      if (table === "sources") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: { id: "new-source-uuid" }, error: null }),
            })),
          })),
        };
      }

      if (table === "topics") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((field: string, val: string) => ({
              then: (resolve: (res: unknown) => void) => {
                const filtered = topicsData.filter((t) => !t.subject_id || t.subject_id === val);
                resolve({ data: filtered, error: null });
              },
            })),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => {
            insertedTopics.push(payload);
            return {
              select: vi.fn(() => ({
                single: vi
                  .fn()
                  .mockResolvedValue(
                    overrides?.insertTopicError
                      ? { data: null, error: overrides.insertTopicError }
                      : { data: insertTopicResult, error: null },
                  ),
              })),
            };
          }),
        };
      }

      if (table === "questions") {
        return {
          select: vi.fn(() => ({
            filter: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => {
            insertedQuestions.push(payload);
            return {
              select: vi.fn(() => ({
                single: vi
                  .fn()
                  .mockResolvedValue(
                    overrides?.insertQuestionError
                      ? { data: null, error: overrides.insertQuestionError }
                      : { data: insertQuestionResult, error: null },
                  ),
              })),
            };
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    insertedSubjects,
    insertedTopics,
    insertedContests,
    insertedQuestions,
  } as unknown as SupabaseClient & {
    insertedSubjects: Record<string, unknown>[];
    insertedTopics: Record<string, unknown>[];
    insertedContests: Record<string, unknown>[];
    insertedQuestions: Record<string, unknown>[];
  };

  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE: normalizeName
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeName", () => {
  it("remove espaços extras e converte para minúsculas", () => {
    expect(normalizeName("  Direito   Constitucional  ")).toBe("direito constitucional");
  });

  it("remove acentos e caracteres diacríticos", () => {
    expect(normalizeName("Legislação Tributária")).toBe("legislacao tributaria");
    expect(normalizeName("Português e Redação")).toBe("portugues e redacao");
    expect(normalizeName("Contabilidade Pública")).toBe("contabilidade publica");
  });

  it("trata combinações com múltiplos espaços e acentuação mista", () => {
    expect(normalizeName("  Auditoria   Fiscal   Avançada  ")).toBe("auditoria fiscal avancada");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE: resolveSubject
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveSubject", () => {
  it("Caso 1: retorna UUID da matéria existente sem criar duplicata", async () => {
    const client = createMockSupabaseClient({
      subjects: [
        { id: "sub-existing-1", name: "Direito Constitucional" },
        { id: "sub-existing-2", name: "Direito Administrativo" },
      ],
    });

    const subjectId = await resolveSubject("direito constitucional", client);

    expect(subjectId).toBe("sub-existing-1");
    expect(client.from).toHaveBeenCalledWith("subjects");
    expect(client.insertedSubjects).toHaveLength(0);
  });

  it("Caso 1b: encontra matéria existente mesmo com acentuação e caixa diferente", async () => {
    const client = createMockSupabaseClient({
      subjects: [{ id: "sub-existing-trib", name: "Legislação Tributária" }],
    });

    const subjectId = await resolveSubject("LEGISLACAO TRIBUTARIA", client);

    expect(subjectId).toBe("sub-existing-trib");
    expect(client.insertedSubjects).toHaveLength(0);
  });

  it("Caso 2: cria nova matéria quando não encontrada e retorna o novo UUID", async () => {
    const client = createMockSupabaseClient({
      subjects: [{ id: "sub-existing-1", name: "Direito Constitucional" }],
      insertSubjectResult: { id: "new-subject-uuid" },
    });

    const subjectId = await resolveSubject("Direito Previdenciário", client);

    expect(subjectId).toBe("new-subject-uuid");
    expect(client.insertedSubjects).toHaveLength(1);
    expect(client.insertedSubjects[0]).toEqual({
      created_by: FAKE_USER_ID,
      name: "Direito Previdenciário",
    });
  });

  it("lança erro se o nome da matéria for vazio", async () => {
    const client = createMockSupabaseClient();
    await expect(resolveSubject("   ", client)).rejects.toThrow(
      "Nome da matéria não pode ser vazio.",
    );
  });

  it("lança erro se usuário não autenticado", async () => {
    const client = createMockSupabaseClient({
      getUserError: new Error("Auth session missing!"),
    });
    await expect(resolveSubject("Direito Constitucional", client)).rejects.toThrow(
      "Usuário não autenticado.",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE: resolveTopic
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveTopic", () => {
  it("Caso 3: retorna UUID do tópico existente dentro da matéria sem duplicar", async () => {
    const client = createMockSupabaseClient({
      topics: [
        { id: "top-1", name: "Direitos e Garantias Fundamentais", subject_id: "sub-1" },
        { id: "top-2", name: "Poder Executivo", subject_id: "sub-1" },
      ],
    });

    const topicId = await resolveTopic("direitos e garantias fundamentais", "sub-1", client);

    expect(topicId).toBe("top-1");
    expect(client.insertedTopics).toHaveLength(0);
  });

  it("Caso 4: cria novo tópico vinculado à matéria quando não encontrado", async () => {
    const client = createMockSupabaseClient({
      topics: [{ id: "top-1", name: "Poder Executivo", subject_id: "sub-1" }],
      insertTopicResult: { id: "new-topic-uuid" },
    });

    const topicId = await resolveTopic("Controle de Constitucionalidade", "sub-1", client);

    expect(topicId).toBe("new-topic-uuid");
    expect(client.insertedTopics).toHaveLength(1);
    expect(client.insertedTopics[0]).toEqual({
      created_by: FAKE_USER_ID,
      subject_id: "sub-1",
      name: "Controle de Constitucionalidade",
      kind: "topico",
    });
  });

  it("lança erro se o nome do tópico ou subjectId forem vazios", async () => {
    const client = createMockSupabaseClient();
    await expect(resolveTopic("  ", "sub-1", client)).rejects.toThrow(
      "Nome do tópico não pode ser vazio.",
    );
    await expect(resolveTopic("Tópico Válido", "", client)).rejects.toThrow(
      "ID da matéria é obrigatório",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE: resolveContest
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveContest", () => {
  it("retorna UUID do concurso existente sem criar duplicata", async () => {
    const client = createMockSupabaseClient({
      contests: [{ id: "contest-existing-1", name: "SEFAZ-SP" }],
    });

    const contestId = await resolveContest("Sefaz-sp", client);

    expect(contestId).toBe("contest-existing-1");
    expect(client.from).toHaveBeenCalledWith("contests");
    expect(client.insertedContests).toHaveLength(0);
  });

  it("cria novo concurso quando não encontrado e retorna o novo UUID", async () => {
    const client = createMockSupabaseClient({
      contests: [{ id: "contest-existing-1", name: "SEFAZ-SP" }],
      insertContestResult: { id: "new-contest-uuid" },
    });

    const contestId = await resolveContest("Receita Federal", client);

    expect(contestId).toBe("new-contest-uuid");
    expect(client.insertedContests).toHaveLength(1);
    expect(client.insertedContests[0]).toMatchObject({
      user_id: FAKE_USER_ID,
      name: "Receita Federal",
    });
  });

  it("lança erro se o nome do concurso for vazio", async () => {
    const client = createMockSupabaseClient();
    await expect(resolveContest("  ", client)).rejects.toThrow(
      "Nome do concurso não pode ser vazio.",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE: mapExtractedToCreateInput & metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("mapExtractedToCreateInput", () => {
  it("persiste cargo (position) e órgão (organization) em metadata", () => {
    const eq: ExtractedQuestion = {
      statement: "Enunciado da questão sobre ICMS",
      alternatives: [
        { letter: "A", text: "Opção A" },
        { letter: "B", text: "Opção B" },
      ],
      correctAnswer: "A",
      isTrueFalse: false,
      subjectLabel: "Direito Tributário",
      topicLabel: "ICMS",
      contestMetadata: {
        examBoard: "FGV",
        contestName: "SEFAZ-SP",
        year: 2024,
        position: "Auditor Fiscal da Receita Estadual",
        organization: "Secretaria da Fazenda de São Paulo",
      },
      difficulty: 4,
      explanation: "Explicação sobre a hipótese de incidência do ICMS.",
    };

    const input = mapExtractedToCreateInput(eq, "sub-trib-uuid", "top-icms-uuid", "contest-uuid");

    expect(input.subjectId).toBe("sub-trib-uuid");
    expect(input.topicId).toBe("top-icms-uuid");
    expect(input.contestId).toBe("contest-uuid");
    expect(input.examBoard).toBe("FGV");
    expect(input.contestName).toBe("SEFAZ-SP");
    expect(input.year).toBe(2024);
    expect(input.origin).toBe("ocr");
    expect(input.metadata?.position).toBe("Auditor Fiscal da Receita Estadual");
    expect(input.metadata?.organization).toBe("Secretaria da Fazenda de São Paulo");
    expect(input.metadata?.content_hash).toBeDefined();
  });

  it("normaliza examBoard removendo espaços e convertendo para uppercase canônico", () => {
    const eq: ExtractedQuestion = {
      statement: "Enunciado",
      alternatives: [],
      contestMetadata: {
        examBoard: "   cespe   ",
      },
    };
    const input = mapExtractedToCreateInput(eq);
    expect(input.examBoard).toBe("CEBRASPE");
  });

  it("gera metadata com content_hash mesmo se position e organization estiverem ausentes", () => {
    const eq: ExtractedQuestion = {
      statement: "Enunciado simples",
      alternatives: [],
      correctAnswer: "C",
      isTrueFalse: true,
    };

    const input = mapExtractedToCreateInput(eq, null, null);

    expect(input.subjectId).toBeNull();
    expect(input.topicId).toBeNull();
    expect(input.metadata?.content_hash).toBeDefined();
    expect(input.metadata?.position).toBeUndefined();
    expect(input.metadata?.organization).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE: extractAndCreateQuestions fluxo integrado
// ─────────────────────────────────────────────────────────────────────────────

describe("extractAndCreateQuestions com Entity Resolver", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-api-key";
  });

  it("Caso 5: fluxo completo com resolução de matéria, tópico e persistência", async () => {
    const client = createMockSupabaseClient({
      subjects: [{ id: "sub-const-id", name: "Direito Constitucional" }],
      insertTopicResult: { id: "top-created-id" },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    questions: [
                      {
                        statement: "São direitos sociais a educação, a saúde...",
                        alternatives: [
                          { letter: "A", text: "Correta" },
                          { letter: "B", text: "Incorreta" },
                        ],
                        correctAnswer: "A",
                        isTrueFalse: false,
                        subject: "Direito Constitucional",
                        topic: "Direitos Sociais",
                        examBoard: "CEBRASPE",
                        contest: "Auditor Fiscal",
                        year: 2023,
                        position: "Auditor Fiscal",
                        organization: "Receita Federal",
                        difficulty: 3,
                        explanation: "Art. 6º da CF/88.",
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const request: ImageExtractionRequest = {
      payloadId: "req-1",
      image: {
        data: "base64data",
        mimeType: "image/png",
        byteSize: 1024,
        width: 800,
        height: 600,
      },
      contestMetadata: {
        examBoard: "CEBRASPE",
        contestName: "Auditor Fiscal",
        year: 2023,
        position: "Auditor Fiscal",
        organization: "Receita Federal",
      },
      source: "imagem_print",
      options: {},
    };

    const result = await extractAndCreateQuestions(
      request,
      { fetchFn: mockFetch as unknown as typeof fetch },
      client,
    );

    expect(result.extraction.success).toBe(true);
    expect(result.created).toHaveLength(1);
    expect(result.creationErrors).toHaveLength(0);

    // Verifica que a questão inserida recebeu subject_id e topic_id resolvidos
    expect(client.insertedQuestions).toHaveLength(1);
    const createdPayload = client.insertedQuestions[0];
    expect(createdPayload.subject_id).toBe("sub-const-id"); // Encontrado existente
    expect(createdPayload.topic_id).toBe("top-created-id"); // Criado novo tópico
    expect(createdPayload.origin).toBe("ocr");
    expect((createdPayload.metadata as any)?.position).toBe("Auditor Fiscal");
    expect((createdPayload.metadata as any)?.organization).toBe("Receita Federal");
    expect((createdPayload.metadata as any)?.content_hash).toBeDefined();
  });

  it("Caso 6: sem subjectLabel, mantém subjectId = null e topicId = null sem criar entidades", async () => {
    const client = createMockSupabaseClient();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    questions: [
                      {
                        statement: "Questão sem identificação de matéria.",
                        alternatives: [{ letter: "A", text: "Opção A" }],
                        correctAnswer: "A",
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const request: ImageExtractionRequest = {
      payloadId: "req-2",
      image: {
        data: "base64data",
        mimeType: "image/png",
        byteSize: 1024,
        width: 800,
        height: 600,
      },
      source: "imagem_print",
      options: {},
    };

    const result = await extractAndCreateQuestions(
      request,
      { fetchFn: mockFetch as unknown as typeof fetch },
      client,
    );

    expect(result.created).toHaveLength(1);
    expect(client.insertedSubjects).toHaveLength(0);
    expect(client.insertedTopics).toHaveLength(0);
    expect(client.insertedQuestions[0].subject_id).toBeNull();
    expect(client.insertedQuestions[0].topic_id).toBeNull();
  });
});
