/**
 * SERVIÇO DE INTEGRAÇÃO DO GOOGLE GEMINI NO FLUXO DE EXTRAÇÃO
 *
 * Orquestra o pipeline completo de extração de questões a partir de imagem
 * usando o Google Gemini como provedor de IA.
 *
 * PIPELINE:
 *   ImageExtractionRequest
 *     → getGeminiConfig()       (gemini-config.ts)
 *     → extractWithGemini()     (google-gemini.ts)
 *     → convertProviderResult() (extraction.ts)
 *     → ExtractionResult
 *
 * RESPONSABILIDADES:
 *   - Orquestrar os módulos existentes na ordem correta
 *   - Tratar erros de configuração (GeminiConfigError)
 *   - Retornar ExtractionResult em todos os cenários (sucesso ou erro)
 *   - Extrair questões e persisti-las via createQuestion (extractAndCreateQuestions)
 *
 * NÃO FAZ:
 *   - Validação do payload de imagem (isso é do image-adapter)
 *   - Cache de resultados
 *   - Duplicar regras de extração ou conversão
 *
 * REUTILIZA:
 *   - ImageExtractionRequest       (adapters/image-adapter.ts)
 *   - getGeminiConfig               (gemini-config.ts)
 *   - extractWithGemini             (google-gemini.ts)
 *   - convertProviderResult         (extraction.ts)
 *   - ExtractionResult              (extraction.ts)
 *   - GeminiConfigError             (gemini-config.ts)
 *   - createQuestion                (service.ts)
 *   - mapSourceToOrigin             (ingestion.ts)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultBrowserClient } from "@/integrations/supabase/client";
import type { ImageExtractionRequest } from "../adapters/image-adapter";
import type { ExtractionResult } from "../extraction";
import type { ExtractedQuestion } from "../ingestion";
import { mapSourceToOrigin } from "../ingestion";
import type { QuestionBankItem } from "../types";
import { convertProviderResult } from "../extraction";
import { getGeminiConfig, GeminiConfigError, type GeminiConfigOverrides } from "./gemini-config";
import { extractWithGemini } from "./google-gemini";
import { createQuestion, createQuestionWithClient, type CreateQuestionInput } from "../service";
import { resolveSubject, resolveTopic, resolveContest, resolveSource } from "../entity-resolver";
import { normalizeExamBoard, computeQuestionContentHash } from "../normalizer";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opções opcionais para o serviço de extração Gemini.
 */
export type GeminiServiceOptions = {
  /** Overrides de configuração (model, timeoutMs, baseUrl) */
  configOverrides?: GeminiConfigOverrides;
  /** Função fetch injetável (para testes). Padrão: fetch global. */
  fetchFn?: typeof fetch;
  /** Função de extração injetável (para testes / mocks) */
  extractFn?: (
    request: ImageExtractionRequest,
    options?: GeminiServiceOptions,
  ) => Promise<ExtractionResult>;
};

/**
 * Erro de criação de uma questão individual.
 */
export type QuestionCreationError = {
  /** A questão extraída que falhou ao ser criada */
  extractedQuestion: ExtractedQuestion;
  /** A mensagem de erro */
  message: string;
  /** Código de erro do Supabase (ex: "23505", "42501"), quando disponível */
  code?: string;
  /** Detalhes adicionais do erro do Supabase, quando disponível */
  details?: string;
  /** Hint do Supabase para corrigir o erro, quando disponível */
  hint?: string;
};

/**
 * Resultado de extractAndCreateQuestions.
 */
export type ExtractAndCreateResult = {
  /** Resultado da extração (questões extraídas, erros, warnings) */
  extraction: ExtractionResult;
  /** Questões criadas com sucesso no banco */
  created: QuestionBankItem[];
  /** Questões que falharam ao ser criadas */
  creationErrors: QuestionCreationError[];
};

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL — extractQuestionsWithGemini
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa o pipeline completo de extração de questões por imagem
 * usando o Google Gemini.
 *
 * 1. Obtém a configuração via getGeminiConfig()
 * 2. Chama extractWithGemini() para enviar a imagem ao Gemini
 * 3. Passa o RawProviderResult para convertProviderResult()
 * 4. Retorna o ExtractionResult final
 *
 * Se a configuração falhar (ex: GEMINI_API_KEY ausente), retorna
 * um ExtractionResult com erro estruturado em vez de lançar exceção.
 *
 * @param request - ImageExtractionRequest produzido pelo image-adapter.
 * @param options - Opções opcionais (overrides de config, fetchFn).
 * @returns ExtractionResult com questões extraídas ou erros.
 */
export async function extractQuestionsWithGemini(
  request: ImageExtractionRequest,
  options?: GeminiServiceOptions,
): Promise<ExtractionResult> {
  // ── 1. Obter configuração ──
  let config;
  try {
    config = getGeminiConfig(options?.configOverrides);
  } catch (error: unknown) {
    if (error instanceof GeminiConfigError) {
      return {
        payloadId: request.payloadId,
        success: false,
        questions: [],
        totalExtracted: 0,
        overallConfidence: 0,
        confidenceLevel: "very_low",
        errors: [
          {
            code: "PROVIDER_ERROR",
            message: error.message,
          },
        ],
        warnings: [],
        processingTimeMs: null,
      };
    }
    // Erro inesperado — ainda retorna ExtractionResult
    return {
      payloadId: request.payloadId,
      success: false,
      questions: [],
      totalExtracted: 0,
      overallConfidence: 0,
      confidenceLevel: "very_low",
      errors: [
        {
          code: "UNKNOWN",
          message:
            error instanceof Error
              ? error.message
              : "Erro desconhecido ao obter configuração do Gemini.",
        },
      ],
      warnings: [],
      processingTimeMs: null,
    };
  }

  // ── 2. Chamar extractWithGemini ──
  const providerResult = await extractWithGemini(request, config, options?.fetchFn);

  // ── 3. Converter resultado do provedor ──
  const extractionResult = convertProviderResult(providerResult, request);

  return extractionResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO — extractAndCreateQuestions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa o pipeline de extração com Gemini e, para cada questão extraída
 * e válida, persiste no banco via createQuestion().
 *
 * Não interrompe o fluxo se uma questão individual falhar ao ser criada:
 * registra o erro em creationErrors e continua com as demais.
 *
 * Quando chamado a partir de uma Server Function com middleware autenticado,
 * o supabaseClient autenticado deve ser passado como terceiro argumento para
 * que o RLS funcione corretamente no servidor.
 *
 * @param request - ImageExtractionRequest produzido pelo image-adapter.
 * @param options - Opções opcionais (overrides de config, fetchFn).
 * @param supabaseClient - Cliente Supabase autenticado (opcional, para uso server-side).
 * @returns ExtractAndCreateResult com extração, questões criadas e erros de criação.
 */
export async function extractAndCreateQuestions(
  request: ImageExtractionRequest,
  options?: GeminiServiceOptions,
  supabaseClient?: SupabaseClient,
): Promise<ExtractAndCreateResult> {
  // ── 1. Executar extração ──
  const extraction = options?.extractFn
    ? await options.extractFn(request, options)
    : await extractQuestionsWithGemini(request, options);

  const created: QuestionBankItem[] = [];
  const creationErrors: QuestionCreationError[] = [];

  // Se a extração falhou ou não produziu questões, retorna direto
  if (!extraction.success || extraction.questions.length === 0) {
    return { extraction, created, creationErrors };
  }

  // Cliente para resolução de entidades e criação de questões
  const clientToUse = supabaseClient ?? defaultBrowserClient;

  // ── 2. Para cada questão extraída, resolver entidades e chamar createQuestion ──
  for (const eq of extraction.questions) {
    try {
      let subjectId: string | null = null;
      let topicId: string | null = null;
      let contestId: string | null = null;
      let sourceId: string | null = null;

      // Resolução de concurso com metadados estruturados
      const trimmedContest = eq.contestMetadata?.contestName?.trim();
      if (trimmedContest) {
        contestId = await resolveContest(
          {
            name: trimmedContest,
            organization: eq.contestMetadata.organization,
            roleTitle: eq.contestMetadata.position,
            examBoard: eq.contestMetadata.examBoard,
            year: eq.contestMetadata.year,
          },
          clientToUse,
        );
      }

      // Resolução de matéria
      const trimmedSubject = eq.subjectLabel?.trim();
      if (trimmedSubject) {
        subjectId = await resolveSubject(trimmedSubject, clientToUse);
      }

      // Resolução de tópico (somente quando houver topicLabel E subjectId resolvido)
      const trimmedTopic = eq.topicLabel?.trim();
      if (trimmedTopic && subjectId) {
        topicId = await resolveTopic(trimmedTopic, subjectId, clientToUse);
      }

      // Resolução de fonte (quando houver sourceTitle, sourceUrl ou externalId)
      if (
        eq.contestMetadata?.sourceTitle ||
        eq.contestMetadata?.sourceUrl ||
        eq.contestMetadata?.externalId
      ) {
        sourceId = await resolveSource(
          {
            title:
              eq.contestMetadata.sourceTitle ??
              (trimmedContest ? `Prova ${trimmedContest}` : "Fonte da Questão"),
            url: eq.contestMetadata.sourceUrl ?? null,
            type: "prova",
            origin: "imagem_print",
            contestId,
            subjectId,
            topicId,
            metadata: eq.contestMetadata.externalId
              ? { external_id: eq.contestMetadata.externalId }
              : null,
          },
          clientToUse,
        );
      }

      const input = mapExtractedToCreateInput(eq, subjectId, topicId, contestId, sourceId);
      // Use the authenticated Supabase client when available (server-side),
      // otherwise fall back to the browser client (client-side).
      const item = supabaseClient
        ? await createQuestionWithClient(input, supabaseClient)
        : await createQuestion(input);
      created.push(item);
    } catch (error: unknown) {
      // Preserve full Supabase error details for diagnostics.
      // Supabase PostgrestError has: message, code, details, hint.
      // Standard Error only has message.
      const errObj = error as Record<string, unknown> | null;

      const message =
        errObj && typeof errObj.message === "string"
          ? errObj.message
          : error instanceof Error
            ? error.message
            : "Erro desconhecido ao criar questão.";

      const creationError: QuestionCreationError = {
        extractedQuestion: eq,
        message,
      };

      // Attach Supabase-specific fields when present
      if (errObj && typeof errObj.code === "string") {
        creationError.code = errObj.code;
      }
      if (errObj && typeof errObj.details === "string") {
        creationError.details = errObj.details;
      }
      if (errObj && typeof errObj.hint === "string") {
        creationError.hint = errObj.hint;
      }

      creationErrors.push(creationError);
    }
  }

  return { extraction, created, creationErrors };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — mapear ExtractedQuestion para CreateQuestionInput
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converte uma ExtractedQuestion (formato da extração) para o formato
 * aceito por createQuestion() do service.
 *
 * Usa mapSourceToOrigin("imagem_print") de ingestion.ts para converter
 * a fonte "imagem_print" para o valor "ocr" aceito pelo enum
 * question_origin do banco.
 *
 * Normaliza a banca examinadora e armazena metadados estruturados em JSONB.
 */
export function mapExtractedToCreateInput(
  eq: ExtractedQuestion,
  subjectId?: string | null,
  topicId?: string | null,
  contestId?: string | null,
  sourceId?: string | null,
): CreateQuestionInput {
  const metadata: Record<string, unknown> = {};

  if (eq.contestMetadata?.position) {
    metadata.position = eq.contestMetadata.position;
  }
  if (eq.contestMetadata?.organization) {
    metadata.organization = eq.contestMetadata.organization;
  }
  if (eq.contestMetadata?.examName) {
    metadata.exam_name = eq.contestMetadata.examName;
  }
  if (
    eq.contestMetadata?.questionNumber !== undefined &&
    eq.contestMetadata?.questionNumber !== null
  ) {
    metadata.question_number = eq.contestMetadata.questionNumber;
  }
  if (eq.contestMetadata?.sourceTitle) {
    metadata.source_title = eq.contestMetadata.sourceTitle;
  }
  if (eq.contestMetadata?.sourceUrl) {
    metadata.source_url = eq.contestMetadata.sourceUrl;
  }
  if (eq.contestMetadata?.externalId) {
    metadata.external_id = eq.contestMetadata.externalId;
  }

  // Gera hash de conteúdo determinístico
  const contentHash = computeQuestionContentHash(eq.statement, eq.alternatives ?? []);
  metadata.content_hash = contentHash;

  // Normalização padronizada de banca
  const normalizedExamBoard = normalizeExamBoard(eq.contestMetadata?.examBoard);

  return {
    statement: eq.statement,
    alternatives: eq.alternatives ?? [],
    correctAnswer: eq.correctAnswer ?? null,
    isTrueFalse: eq.isTrueFalse ?? false,
    examBoard: normalizedExamBoard,
    contestName: eq.contestMetadata?.contestName?.trim() ?? null,
    contestId: contestId ?? null,
    sourceId: sourceId ?? null,
    year: eq.contestMetadata?.year ?? null,
    subjectId: subjectId ?? null,
    topicId: topicId ?? null,
    difficulty: eq.difficulty ?? null,
    origin: mapSourceToOrigin("imagem_print"),
    tags: Array.isArray(eq.tags) ? eq.tags : [],
    explanation: eq.explanation ?? null,
    isPublic: false,
    metadata,
  };
}
