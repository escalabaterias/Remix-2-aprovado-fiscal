/**
 * CAMADA DE EXTRAÇÃO DE QUESTÃO A PARTIR DE IMAGEM
 *
 * Define o contrato para transformar uma imagem de questão
 * (via ImageExtractionRequest do image-adapter) em uma ou mais
 * ExtractedQuestion (formato da camada ingestion.ts).
 *
 * ARQUITETURA:
 *   ImageExtractionRequest → [provedor IA/OCR externo] → RawProviderResult
 *     → convertProviderResult() → ExtractionResult (ExtractedQuestion[])
 *
 * Esta fase NÃO chama Google LLM, Gemini, OCR ou qualquer API externa.
 * A função pura convertProviderResult() recebe o resultado bruto de um
 * provedor e o converte para o formato ExtractedQuestion.
 *
 * PRINCÍPIOS:
 * - Função pura: mesmo input → mesmo output, sempre.
 * - Sem Date.now(), new Date(), Math.random().
 * - Sem Supabase, banco, rede, estado global.
 * - Reutiliza tipos de ingestion.ts e image-adapter.ts sem duplicar.
 */

import type { ExtractedQuestion, ExtractedAlternative, ContestMetadata } from "./ingestion";

import type { ImageExtractionRequest } from "./adapters/image-adapter";

// ─────────────────────────────────────────────────────────────────────────────
// RE-EXPORT — a solicitação de extração É o ImageExtractionRequest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Solicitação de extração de questão a partir de imagem.
 * É exatamente o ImageExtractionRequest produzido pelo image-adapter.
 */
export type ExtractionRequest = ImageExtractionRequest;

// ─────────────────────────────────────────────────────────────────────────────
// CONFIANÇA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nível semântico de confiança da extração.
 */
export type ExtractionConfidenceLevel = "high" | "medium" | "low" | "very_low";

/**
 * Classifica um score de confiança numérico (0..1) em um nível semântico.
 *
 * >= 0.85 → high
 * >= 0.60 → medium
 * >= 0.35 → low
 * <  0.35 → very_low
 *
 * Determinístico.
 */
export function classifyConfidence(score: number): ExtractionConfidenceLevel {
  if (!Number.isFinite(score) || score < 0) return "very_low";
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  if (score >= 0.35) return "low";
  return "very_low";
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Códigos de erro específicos da extração.
 */
export type ExtractionErrorCode =
  | "EMPTY_RESPONSE"
  | "PARSE_FAILURE"
  | "INCOMPLETE_QUESTION"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "UNKNOWN";

/**
 * Erro estruturado da extração.
 */
export type ExtractionError = {
  code: ExtractionErrorCode;
  message: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// WARNINGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aviso da extração — não impede a conversão, mas indica dados incompletos.
 * Shape compatível com IngestionValidationError.
 */
export type ExtractionWarning = {
  field: string;
  message: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// RESULTADO BRUTO DO PROVEDOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dados de uma questão individual extraída pelo provedor.
 * Este é o formato que um provedor (OCR/LLM) deve produzir.
 * A função convertProviderResult() transforma isso em ExtractedQuestion.
 */
export type ExtractedQuestionData = {
  /** Enunciado da questão */
  statement: string;
  /** Alternativas (letra + texto + isCorrect opcional) */
  alternatives: Array<{
    letter: string;
    text: string;
    isCorrect?: boolean | null;
  }>;
  /** Resposta correta (letra) */
  correctAnswer?: string | null;
  /** Se é verdadeiro/falso (certo/errado) */
  isTrueFalse?: boolean;
  /** Explicação / gabarito comentado */
  explanation?: string | null;
  /** Nome da matéria (texto livre) */
  subjectLabel?: string | null;
  subject?: string | null;
  /** Nome do tópico (texto livre) */
  topicLabel?: string | null;
  topic?: string | null;
  /** Nome do concurso */
  contestName?: string | null;
  /** Banca examinadora */
  examBoard?: string | null;
  /** Ano da prova */
  year?: number | null;
  /** Órgão */
  organization?: string | null;
  /** Cargo */
  roleTitle?: string | null;
  position?: string | null;
  /** Nome da prova/caderno */
  examName?: string | null;
  /** Número da questão */
  questionNumber?: number | string | null;
  /** Título da fonte ou prova */
  sourceTitle?: string | null;
  /** URL da fonte */
  sourceUrl?: string | null;
  /** Identificador externo */
  externalId?: string | null;
  /** Dificuldade estimada (1-5) */
  difficulty?: number | null;
  /** Tags extraídas */
  tags?: string[];
  /** Confiança da extração desta questão (0..1) */
  confidence?: number | null;
};

/**
 * Resultado bruto retornado por qualquer provedor de IA/OCR.
 * O contrato genérico que a função pura convertProviderResult() aceita.
 */
export type RawProviderResult = {
  /** Se o provedor retornou com sucesso */
  success: boolean;
  /** Questões extraídas (quando success=true, pode ser array vazio) */
  questions: ExtractedQuestionData[];
  /** Código de erro do provedor (quando success=false) */
  errorCode?: string | null;
  /** Mensagem de erro do provedor (quando success=false) */
  errorMessage?: string | null;
  /** Confiança geral reportada pelo provedor (0..1, opcional) */
  overallConfidence?: number | null;
  /** Tempo de processamento reportado pelo provedor em ms (opcional) */
  processingTimeMs?: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// RESULTADO DA EXTRAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resultado completo da extração de uma imagem.
 */
export type ExtractionResult = {
  /** ID do payload de origem */
  payloadId: string;
  /** Se a extração produziu pelo menos 1 questão */
  success: boolean;
  /** Questões extraídas no formato ExtractedQuestion */
  questions: ExtractedQuestion[];
  /** Total de questões extraídas */
  totalExtracted: number;
  /** Confiança geral da extração (0..1) */
  overallConfidence: number;
  /** Nível de confiança semântico */
  confidenceLevel: ExtractionConfidenceLevel;
  /** Erros que impediram extração de questões */
  errors: ExtractionError[];
  /** Avisos sobre dados incompletos ou qualidade */
  warnings: ExtractionWarning[];
  /** Tempo de processamento do provedor em ms (quando reportado) */
  processingTimeMs: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS PUROS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula a confiança geral a partir das individuais.
 * Se o provedor reportou overallConfidence, usa essa.
 * Senão, faz a média das confianças individuais.
 * Se não há confianças, retorna 0.
 *
 * Determinístico.
 */
export function computeOverallConfidence(
  questions: ExtractedQuestionData[],
  providerOverall: number | null | undefined,
): number {
  // Se o provedor reportou confiança geral, usa essa
  if (
    providerOverall !== null &&
    providerOverall !== undefined &&
    Number.isFinite(providerOverall)
  ) {
    return Math.max(0, Math.min(1, providerOverall));
  }

  // Senão, média das individuais
  if (questions.length === 0) return 0;

  let sum = 0;
  let count = 0;
  for (const q of questions) {
    if (q.confidence !== null && q.confidence !== undefined && Number.isFinite(q.confidence)) {
      sum += Math.max(0, Math.min(1, q.confidence));
      count++;
    }
  }

  if (count === 0) return 0;
  return sum / count;
}

/**
 * Converte uma ExtractedQuestionData do provedor em uma ExtractedAlternative[].
 */
function convertAlternatives(raw: ExtractedQuestionData["alternatives"]): ExtractedAlternative[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => ({
    letter: typeof a.letter === "string" ? a.letter : "",
    text: typeof a.text === "string" ? a.text : "",
    isCorrect: typeof a.isCorrect === "boolean" ? a.isCorrect : null,
  }));
}

/**
 * Gera warnings para uma questão extraída com dados incompletos.
 */
function generateQuestionWarnings(data: ExtractedQuestionData, index: number): ExtractionWarning[] {
  const warnings: ExtractionWarning[] = [];
  const prefix = `questions[${index}]`;

  if (!data.correctAnswer) {
    warnings.push({
      field: `${prefix}.correctAnswer`,
      message: "Questão extraída sem gabarito.",
    });
  }

  if (!data.subjectLabel) {
    warnings.push({
      field: `${prefix}.subjectLabel`,
      message: "Questão extraída sem matéria identificada.",
    });
  }

  if (!data.topicLabel) {
    warnings.push({
      field: `${prefix}.topicLabel`,
      message: "Questão extraída sem tópico identificado.",
    });
  }

  if (!data.alternatives || data.alternatives.length === 0) {
    if (!data.isTrueFalse) {
      warnings.push({
        field: `${prefix}.alternatives`,
        message: "Questão extraída sem alternativas.",
      });
    }
  }

  if (
    data.confidence !== null &&
    data.confidence !== undefined &&
    Number.isFinite(data.confidence) &&
    data.confidence < 0.5
  ) {
    warnings.push({
      field: `${prefix}.confidence`,
      message: `Confiança baixa na extração desta questão (${data.confidence.toFixed(2)}).`,
    });
  }

  return warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converte o resultado bruto de um provedor de IA/OCR para o formato
 * ExtractionResult contendo ExtractedQuestion[] da camada ingestion.ts.
 *
 * Esta é a função pura central da camada de extração.
 * Ela NÃO chama nenhum provedor — recebe o resultado já pronto.
 *
 * Determinístico: mesmo input → mesmo output, sempre.
 *
 * @param providerResult - Resultado bruto do provedor de IA/OCR.
 * @param request - A ImageExtractionRequest original (para payloadId e contestMetadata).
 * @returns ExtractionResult com questões convertidas, erros e warnings.
 */
export function convertProviderResult(
  providerResult: RawProviderResult | ExtractedQuestionData | ExtractedQuestionData[],
  request?: Partial<ExtractionRequest>,
): ExtractionResult {
  const payloadId = request?.payloadId ?? "default-payload";
  const errors: ExtractionError[] = [];
  const warnings: ExtractionWarning[] = [];

  // Normalizar providerResult para o formato canônico RawProviderResult
  let normalizedResult: RawProviderResult;
  if (Array.isArray(providerResult)) {
    normalizedResult = {
      success: true,
      questions: providerResult,
    };
  } else if ("questions" in providerResult && Array.isArray(providerResult.questions)) {
    normalizedResult = providerResult as RawProviderResult;
  } else if ("statement" in providerResult) {
    normalizedResult = {
      success: true,
      questions: [providerResult as ExtractedQuestionData],
    };
  } else {
    normalizedResult = providerResult as RawProviderResult;
  }

  // ── Provedor retornou erro ──
  if (!normalizedResult.success) {
    const code: ExtractionErrorCode = normalizedResult.errorCode
      ? mapProviderErrorCode(normalizedResult.errorCode)
      : "PROVIDER_ERROR";

    errors.push({
      code,
      message: normalizedResult.errorMessage ?? "O provedor de extração retornou erro.",
    });

    return {
      payloadId,
      success: false,
      questions: [],
      totalExtracted: 0,
      overallConfidence: 0,
      confidenceLevel: "very_low",
      errors,
      warnings,
      processingTimeMs: safeProcessingTime(normalizedResult.processingTimeMs),
    };
  }

  // ── Resposta vazia ──
  if (!normalizedResult.questions || normalizedResult.questions.length === 0) {
    errors.push({
      code: "EMPTY_RESPONSE",
      message: "O provedor não extraiu nenhuma questão da imagem.",
    });

    return {
      payloadId,
      success: false,
      questions: [],
      totalExtracted: 0,
      overallConfidence: 0,
      confidenceLevel: "very_low",
      errors,
      warnings,
      processingTimeMs: safeProcessingTime(normalizedResult.processingTimeMs),
    };
  }

  // ── Converter questões ──
  const questions: ExtractedQuestion[] = [];

  for (let i = 0; i < normalizedResult.questions.length; i++) {
    const raw = normalizedResult.questions[i]!;

    // Validação mínima: precisa ter enunciado
    if (
      !raw.statement ||
      (typeof raw.statement === "string" && raw.statement.trim().length === 0)
    ) {
      errors.push({
        code: "INCOMPLETE_QUESTION",
        message: `Questão ${i} extraída sem enunciado.`,
      });
      continue;
    }

    // Gerar warnings para dados incompletos
    const qWarnings = generateQuestionWarnings(raw, i);
    warnings.push(...qWarnings);

    // Converter para ExtractedQuestion
    const confidence =
      raw.confidence !== null && raw.confidence !== undefined && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0;

    const alternatives = convertAlternatives(raw.alternatives ?? []);

    // Determinar correctAnswer: do campo explícito ou das alternativas
    let correctAnswer: string | null =
      typeof raw.correctAnswer === "string" && raw.correctAnswer.trim().length > 0
        ? raw.correctAnswer.trim()
        : null;

    // Se não informado explicitamente, tentar inferir das alternativas
    if (correctAnswer === null && alternatives.length > 0) {
      const correct = alternatives.find((a) => a.isCorrect === true);
      if (correct && correct.letter.trim().length > 0) {
        correctAnswer = correct.letter.trim();
      }
    }

    const reqMetadata = request?.contestMetadata;
    const reqAny = request as Record<string, unknown> | undefined;

    const examBoard =
      reqMetadata?.examBoard || (reqAny?.examBoard as string) || raw.examBoard || null;
    const contestName =
      reqMetadata?.contestName || (reqAny?.contestName as string) || raw.contestName || null;
    const year = reqMetadata?.year ?? (reqAny?.year as number) ?? raw.year ?? null;
    const position =
      reqMetadata?.position ||
      (reqAny?.position as string) ||
      (reqAny?.roleTitle as string) ||
      raw.position ||
      raw.roleTitle ||
      null;
    const organization =
      reqMetadata?.organization || (reqAny?.organization as string) || raw.organization || null;
    const examName = reqMetadata?.examName || (reqAny?.examName as string) || raw.examName || null;
    const questionNumber =
      reqMetadata?.questionNumber ??
      (reqAny?.questionNumber as number) ??
      raw.questionNumber ??
      null;
    const sourceTitle =
      reqMetadata?.sourceTitle || (reqAny?.sourceTitle as string) || raw.sourceTitle || null;
    const sourceUrl =
      reqMetadata?.sourceUrl || (reqAny?.sourceUrl as string) || raw.sourceUrl || null;
    const externalId =
      reqMetadata?.externalId || (reqAny?.externalId as string) || raw.externalId || null;

    const hasAnyMetadata = Boolean(
      examBoard ||
      contestName ||
      year !== null ||
      position ||
      organization ||
      examName ||
      questionNumber !== null ||
      sourceTitle ||
      sourceUrl ||
      externalId,
    );

    const mergedContestMetadata: ContestMetadata | undefined = hasAnyMetadata
      ? {
          examBoard,
          contestName,
          year,
          position,
          organization,
          examName,
          questionNumber,
          sourceTitle,
          sourceUrl,
          externalId,
        }
      : undefined;

    const extracted: ExtractedQuestion = {
      extractionId: `${payloadId}-q${i}`,
      payloadId,
      statement: raw.statement,
      alternatives,
      correctAnswer,
      isTrueFalse: raw.isTrueFalse === true,
      explanation: raw.explanation ?? null,
      ...(mergedContestMetadata ? { contestMetadata: mergedContestMetadata } : {}),
      subjectLabel: raw.subjectLabel || raw.subject || null,
      topicLabel: raw.topicLabel || raw.topic || null,
      difficulty: safeDifficulty(raw.difficulty),
      tags: Array.isArray(raw.tags) ? [...raw.tags] : [],
      extractionConfidence: confidence,
    };

    questions.push(extracted);
  }

  // ── Calcular confiança geral ──
  const overallConfidence = computeOverallConfidence(
    normalizedResult.questions,
    normalizedResult.overallConfidence,
  );

  return {
    payloadId,
    success: questions.length > 0,
    questions,
    totalExtracted: questions.length,
    overallConfidence,
    confidenceLevel: classifyConfidence(overallConfidence),
    errors,
    warnings,
    processingTimeMs: safeProcessingTime(providerResult.processingTimeMs),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapeia um código de erro genérico do provedor para ExtractionErrorCode.
 */
function mapProviderErrorCode(code: string): ExtractionErrorCode {
  const upper = code.toUpperCase();
  if (upper.includes("TIMEOUT")) return "TIMEOUT";
  if (upper.includes("PARSE")) return "PARSE_FAILURE";
  if (upper.includes("EMPTY")) return "EMPTY_RESPONSE";
  return "PROVIDER_ERROR";
}

/**
 * Valida e normaliza o tempo de processamento.
 */
function safeProcessingTime(ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined) return null;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms;
}

/**
 * Valida dificuldade do provedor (1-5 ou null).
 */
function safeDifficulty(d: number | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  if (!Number.isFinite(d) || d < 1 || d > 5) return null;
  return d;
}
