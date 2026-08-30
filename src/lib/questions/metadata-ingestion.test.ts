import { describe, it, expect, vi } from "vitest";
import { normalizeText, normalizeExamBoard, computeQuestionContentHash } from "./normalizer";
import { resolveSubject, resolveTopic, resolveContest, resolveSource } from "./entity-resolver";
import { mapExtractedToCreateInput, extractAndCreateQuestions } from "./providers/gemini-service";
import { convertProviderResult, type ExtractedQuestionData } from "./extraction";
import { extractContestMetadata, type ImageExtractionRequest } from "./adapters/image-adapter";
import type { ExtractedQuestion } from "./ingestion";

describe("ETAPA 6.7 — Ingestão Inteligente e Completa de Metadados", () => {
  // ── 1. Extração completa com print contendo metadados ──
  it("Cenário 1: Extrai e converte todos os metadados do cabeçalho da questão", () => {
    const rawData: ExtractedQuestionData = {
      statement: "Quanto ao ICMS, assinale a opção correta.",
      alternatives: [
        { letter: "A", text: "Não incide sobre exportação.", isCorrect: true },
        { letter: "B", text: "Incide sobre ouro ativo financeiro.", isCorrect: false },
      ],
      correctAnswer: "A",
      isTrueFalse: false,
      subjectLabel: "Direito Tributário",
      topicLabel: "ICMS",
      contestName: "SEFAZ-SP 2024",
      examBoard: "FGV",
      year: 2024,
      organization: "SEFAZ-SP",
      roleTitle: "Auditor Fiscal da Receita Estadual",
      examName: "Prova Tipo 1 - Conhecimentos Específicos",
      questionNumber: 42,
      sourceTitle: "Caderno de Prova SEFAZ-SP",
      sourceUrl: "https://conhecimento.fgv.br/concursos/sefazsp24",
      externalId: "Q-104958",
      difficulty: 4,
      tags: ["icms", "tributario"],
      confidence: 0.95,
    };

    const extraction = convertProviderResult(rawData);
    expect(extraction.success).toBe(true);
    expect(extraction.questions.length).toBe(1);

    const extracted = extraction.questions[0];
    expect(extracted.statement).toBe("Quanto ao ICMS, assinale a opção correta.");
    expect(extracted.subjectLabel).toBe("Direito Tributário");
    expect(extracted.topicLabel).toBe("ICMS");
    expect(extracted.contestMetadata?.contestName).toBe("SEFAZ-SP 2024");
    expect(extracted.contestMetadata?.examBoard).toBe("FGV");
    expect(extracted.contestMetadata?.year).toBe(2024);
    expect(extracted.contestMetadata?.organization).toBe("SEFAZ-SP");
    expect(extracted.contestMetadata?.position).toBe("Auditor Fiscal da Receita Estadual");
    expect(extracted.contestMetadata?.examName).toBe("Prova Tipo 1 - Conhecimentos Específicos");
    expect(extracted.contestMetadata?.questionNumber).toBe(42);
    expect(extracted.contestMetadata?.sourceTitle).toBe("Caderno de Prova SEFAZ-SP");
    expect(extracted.contestMetadata?.sourceUrl).toBe(
      "https://conhecimento.fgv.br/concursos/sefazsp24",
    );
    expect(extracted.contestMetadata?.externalId).toBe("Q-104958");
  });

  // ── 2. Precedência de metadados da UI / Request sobre o OCR da imagem ──
  it("Cenário 2: Metadados da UI prevalecem sobre os extraídos da imagem", () => {
    const request: ImageExtractionRequest = {
      image: "data:image/png;base64,mock",
      contestName: "SEFAZ-RJ (Informado pelo Usuário)",
      examBoard: "FGV",
      year: 2025,
      organization: "SEFAZ-RJ",
      position: "Auditor",
      examName: "Prova Objetiva 2025",
      questionNumber: 15,
      sourceTitle: "Upload Manual",
      sourceUrl: "https://usuario.org/prova.pdf",
      externalId: "USR-001",
    };

    const imageExtracted: ExtractedQuestionData = {
      statement: "Sobre o ISSQN...",
      alternatives: [],
      contestName: "Concurso Desconhecido OCR",
      examBoard: "CESPE",
      year: 2020,
      organization: "Prefeitura X",
      roleTitle: "Fiscal Junior",
    };

    const extraction = convertProviderResult(imageExtracted, request);
    expect(extraction.success).toBe(true);

    const extracted = extraction.questions[0];
    expect(extracted.contestMetadata?.contestName).toBe("SEFAZ-RJ (Informado pelo Usuário)");
    expect(extracted.contestMetadata?.examBoard).toBe("FGV");
    expect(extracted.contestMetadata?.year).toBe(2025);
    expect(extracted.contestMetadata?.organization).toBe("SEFAZ-RJ");
    expect(extracted.contestMetadata?.position).toBe("Auditor");
    expect(extracted.contestMetadata?.examName).toBe("Prova Objetiva 2025");
    expect(extracted.contestMetadata?.questionNumber).toBe(15);
    expect(extracted.contestMetadata?.sourceTitle).toBe("Upload Manual");
    expect(extracted.contestMetadata?.sourceUrl).toBe("https://usuario.org/prova.pdf");
    expect(extracted.contestMetadata?.externalId).toBe("USR-001");
  });

  // ── 3. Extração com imagem sem metadados ──
  it("Cenário 3: Imagem sem metadados processa normalmente com campos null/ausentes", () => {
    const rawData: ExtractedQuestionData = {
      statement: "A CF/88 consagra o princípio da legalidade estrita?",
      alternatives: [
        { letter: "C", text: "Certo", isCorrect: true },
        { letter: "E", text: "Errado", isCorrect: false },
      ],
      correctAnswer: "C",
      isTrueFalse: true,
    };

    const extraction = convertProviderResult(rawData);
    expect(extraction.success).toBe(true);

    const extracted = extraction.questions[0];
    expect(extracted.statement).toBe("A CF/88 consagra o princípio da legalidade estrita?");
    expect(extracted.isTrueFalse).toBe(true);
    expect(extracted.contestMetadata).toBeUndefined();

    const input = mapExtractedToCreateInput(extracted);
    expect(input.statement).toBe("A CF/88 consagra o princípio da legalidade estrita?");
    expect(input.examBoard).toBeNull();
    expect(input.contestName).toBeNull();
    expect(input.year).toBeNull();
    expect(input.metadata?.content_hash).toBeDefined();
  });

  // ── 4. Deduplicação com hash determinístico ──
  it("Cenário 4: Duas questões idênticas geram exatamente o mesmo hash SHA-256", () => {
    const statement1 = "Considere a competência tributária dos Municípios.";
    const alts1 = [
      { letter: "A", text: "Compete instituir IPTU." },
      { letter: "B", text: "Compete instituir IPVA." },
    ];

    const statement2 = "Considere a competência tributária dos Municípios.";
    const alts2 = [
      { letter: "A", text: "Compete instituir IPTU." },
      { letter: "B", text: "Compete instituir IPVA." },
    ];

    const hash1 = computeQuestionContentHash(statement1, alts1);
    const hash2 = computeQuestionContentHash(statement2, alts2);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  // ── 5. Deduplicação resistente a variações menores de formatação ──
  it("Cenário 5: Variações de espaços múltiplos e maiúsculas/minúsculas produzem o mesmo hash", () => {
    const statement1 = "  Considere a   competência TRIBUTÁRIA  dos Municípios!  ";
    const alts1 = [
      { letter: "a", text: "  Compete   instituir IPTU. " },
      { letter: "b", text: " Compete instituir  IPVA.  " },
    ];

    const statement2 = "considere a competência tributaria dos municípios!";
    const alts2 = [
      { letter: "A", text: "compete instituir iptu." },
      { letter: "B", text: "compete instituir ipva." },
    ];

    const hash1 = computeQuestionContentHash(statement1, alts1);
    const hash2 = computeQuestionContentHash(statement2, alts2);

    expect(hash1).toBe(hash2);
  });

  // ── 6. Normalização de bancas examinadoras ──
  it("Cenário 6: Normaliza variações de nomes de bancas para padrão canônico", () => {
    expect(normalizeExamBoard("FGV - Fundação Getulio Vargas")).toBe("FGV");
    expect(normalizeExamBoard("Fundação Getúlio Vargas")).toBe("FGV");
    expect(normalizeExamBoard("Cespe / Cebraspe")).toBe("CEBRASPE");
    expect(normalizeExamBoard("CESPE")).toBe("CEBRASPE");
    expect(normalizeExamBoard("Cebraspe")).toBe("CEBRASPE");
    expect(normalizeExamBoard("FCC - Fundação Carlos Chagas")).toBe("FCC");
    expect(normalizeExamBoard("Fundação Carlos Chagas")).toBe("FCC");
    expect(normalizeExamBoard("Vunesp")).toBe("VUNESP");
    expect(normalizeExamBoard("Fundação Vunesp")).toBe("VUNESP");
    expect(normalizeExamBoard("Instituto AOCP")).toBe("AOCP");
    expect(normalizeExamBoard("IBFC")).toBe("IBFC");
    expect(normalizeExamBoard("  ")).toBeNull();
    expect(normalizeExamBoard(null)).toBeNull();
    expect(normalizeExamBoard(undefined)).toBeNull();
  });

  // ── 7. Resolução de concurso com metadados estruturados ──
  it("Cenário 7: resolveContest cria concurso com dados enriquecidos ou reutiliza existente", async () => {
    const insertedRows: Record<string, unknown>[] = [];
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-test-123" } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "contests") {
          return {
            select: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "contest-sefaz-sp-id",
                  name: "SEFAZ-SP 2024",
                  organization: "Secretaria da Fazenda de SP",
                  role_title: null,
                  exam_board: "FGV",
                  exam_date: null,
                  description: null,
                },
              ],
              error: null,
            }),
            update: vi.fn((updates: Record<string, unknown>) => ({
              eq: vi.fn().mockResolvedValue({ data: updates, error: null }),
            })),
            insert: vi.fn((payload: Record<string, unknown>) => {
              insertedRows.push(payload);
              return {
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: "new-contest-id" },
                    error: null,
                  }),
                })),
              };
            }),
          };
        }
        return {};
      }),
    };

    // Caso A: Concurso existente é encontrado e enriquecido
    const resolvedExistingId = await resolveContest(
      {
        name: "sefaz-sp 2024",
        organization: "Secretaria da Fazenda de SP",
        roleTitle: "Auditor Fiscal",
        examBoard: "FGV",
        year: 2024,
      },
      mockClient as any,
    );

    expect(resolvedExistingId).toBe("contest-sefaz-sp-id");

    // Caso B: Concurso novo é criado com campos mapeados
    const resolvedNewId = await resolveContest(
      {
        name: "Receita Federal 2026",
        organization: "RFB",
        roleTitle: "Auditor Fiscal da RFB",
        examBoard: "FGV",
        year: 2026,
      },
      mockClient as any,
    );

    expect(resolvedNewId).toBe("new-contest-id");
    expect(insertedRows.length).toBe(1);
    expect(insertedRows[0].name).toBe("Receita Federal 2026");
    expect(insertedRows[0].organization).toBe("RFB");
    expect(insertedRows[0].role_title).toBe("Auditor Fiscal da RFB");
    expect(insertedRows[0].exam_board).toBe("FGV");
    expect(insertedRows[0].exam_date).toBe("2026-01-01");
  });

  // ── 8. Resolução de fonte (resolveSource) ──
  it("Cenário 8: resolveSource cria ou reutiliza fonte no banco", async () => {
    const insertedSources: Record<string, unknown>[] = [];
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-test-123" } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "sources") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "existing-source-id",
                    title: "Caderno Oficial SEFAZ",
                    url: "https://fgv.br/sefaz.pdf",
                  },
                ],
                error: null,
              }),
            })),
            insert: vi.fn((payload: Record<string, unknown>) => {
              insertedSources.push(payload);
              return {
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: "new-source-id" },
                    error: null,
                  }),
                })),
              };
            }),
          };
        }
        return {};
      }),
    };

    // Caso A: Reutiliza existente por título / URL
    const existingId = await resolveSource(
      {
        title: "caderno oficial sefaz",
        url: "https://fgv.br/sefaz.pdf",
      },
      mockClient as any,
    );
    expect(existingId).toBe("existing-source-id");

    // Caso B: Cria nova fonte
    const newId = await resolveSource(
      {
        title: "Prova Tribunal de Contas 2025",
        url: "https://tce.gov.br/prova.pdf",
        contestId: "contest-123",
        metadata: { external_id: "EXT-999" },
      },
      mockClient as any,
    );
    expect(newId).toBe("new-source-id");
    expect(insertedSources[0].title).toBe("Prova Tribunal de Contas 2025");
    expect(insertedSources[0].url).toBe("https://tce.gov.br/prova.pdf");
    expect(insertedSources[0].contest_id).toBe("contest-123");

    // Caso C: Retorna null se não houver dados de fonte
    const nullId = await resolveSource({}, mockClient as any);
    expect(nullId).toBeNull();
  });

  // ── 9. Mapeamento de ExtractedQuestion para CreateQuestionInput ──
  it("Cenário 9: mapExtractedToCreateInput estrutura todos os metadados para persistência", () => {
    const eq: ExtractedQuestion = {
      statement: "Acerca do Direito Tributário, julgue o item.",
      alternatives: [
        { letter: "C", text: "Certo", isCorrect: true },
        { letter: "E", text: "Errado", isCorrect: false },
      ],
      correctAnswer: "C",
      isTrueFalse: true,
      explanation: "A imunidade tributária é recíproca.",
      subjectLabel: "Direito Tributário",
      topicLabel: "Imunidades",
      difficulty: 3,
      tags: ["imunidades", "cf88"],
      contestMetadata: {
        contestName: "SEFAZ-MG",
        examBoard: "Fundação Getulio Vargas",
        year: 2024,
        organization: "SEFAZ-MG",
        position: "Auditor Fiscal",
        examName: "Prova Tipo 2",
        questionNumber: 88,
        sourceTitle: "Caderno Amarelo",
        sourceUrl: "https://fgv.br/prova.pdf",
        externalId: "Q-888",
      },
    };

    const input = mapExtractedToCreateInput(
      eq,
      "subject-uuid-1",
      "topic-uuid-2",
      "contest-uuid-3",
      "source-uuid-4",
    );

    expect(input.statement).toBe(eq.statement);
    expect(input.subjectId).toBe("subject-uuid-1");
    expect(input.topicId).toBe("topic-uuid-2");
    expect(input.contestId).toBe("contest-uuid-3");
    expect(input.sourceId).toBe("source-uuid-4");
    expect(input.examBoard).toBe("FGV"); // Normalizado
    expect(input.year).toBe(2024);
    expect(input.origin).toBe("ocr");
    expect(input.metadata?.position).toBe("Auditor Fiscal");
    expect(input.metadata?.organization).toBe("SEFAZ-MG");
    expect(input.metadata?.exam_name).toBe("Prova Tipo 2");
    expect(input.metadata?.question_number).toBe(88);
    expect(input.metadata?.source_title).toBe("Caderno Amarelo");
    expect(input.metadata?.source_url).toBe("https://fgv.br/prova.pdf");
    expect(input.metadata?.external_id).toBe("Q-888");
    expect(input.metadata?.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  // ── 10. Fluxo ponta a ponta com resolução de entidades e deduplicação ──
  it("Cenário 10: extractAndCreateQuestions executa pipeline completo e vincula entidades", async () => {
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-test-123" } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "subjects") {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ id: "sub-trib", name: "Direito Tributário" }],
              error: null,
            }),
          };
        }
        if (table === "topics") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: "top-icms", name: "ICMS" }],
                error: null,
              }),
            })),
          };
        }
        if (table === "contests") {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ id: "cont-sefaz", name: "SEFAZ-SP 2024" }],
              error: null,
            }),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: {}, error: null }),
            })),
          };
        }
        if (table === "sources") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: "source-new-id" },
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === "questions") {
          return {
            select: vi.fn(() => ({
              filter: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
            insert: vi.fn((payload: Record<string, unknown>) => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: "created-question-id",
                    ...payload,
                    subject: { id: "sub-trib", name: "Direito Tributário" },
                    topic: { id: "top-icms", name: "ICMS" },
                    contest: { id: "cont-sefaz", name: "SEFAZ-SP 2024" },
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              })),
            })),
          };
        }
        return {};
      }),
    };

    const extractionResult = {
      success: true,
      questions: [
        {
          statement: "O fato gerador do ICMS ocorre na saída da mercadoria.",
          alternatives: [
            { letter: "C", text: "Certo", isCorrect: true },
            { letter: "E", text: "Errado", isCorrect: false },
          ],
          correctAnswer: "C",
          isTrueFalse: true,
          subjectLabel: "Direito Tributário",
          topicLabel: "ICMS",
          difficulty: 3,
          tags: ["icms"],
          contestMetadata: {
            contestName: "SEFAZ-SP 2024",
            examBoard: "FGV",
            year: 2024,
            organization: "SEFAZ-SP",
            position: "Auditor Fiscal",
            sourceTitle: "Prova FGV 2024",
            sourceUrl: "https://fgv.br/prova.pdf",
          },
        },
      ],
      totalExtracted: 1,
      overallConfidence: 0.95,
      errors: [],
      rawText: "...",
    };

    // Mock extraction function
    const mockExtractFn = vi.fn().mockResolvedValue(extractionResult);

    const result = await extractAndCreateQuestions(
      { image: "data:image/png;base64,abc" },
      { extractFn: mockExtractFn },
      mockClient as any,
    );

    expect(result.created.length).toBe(1);
    expect(result.creationErrors.length).toBe(0);
    expect(result.created[0].questionId).toBe("created-question-id");
    expect(result.created[0].subjectId).toBe("sub-trib");
    expect(result.created[0].topicId).toBe("top-icms");
    expect(result.created[0].contestId).toBe("cont-sefaz");
  });
});
