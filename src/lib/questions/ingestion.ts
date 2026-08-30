/**
 * INFRAESTRUTURA DE INGESTÃO DE QUESTÕES
 *
 * Camada de entrada para questões provenientes de diferentes fontes.
 * Prepara o sistema para receber posteriormente imagens/prints, PDFs de provas
 * e dados estruturados, sem alterar o Question Bank existente.
 *
 * ARQUITETURA:
 *   Fonte → RawIngestionPayload → processIngestionPayload()
 *        → ExtractedQuestion[] → validateExtractedQuestion()
 *        → mapExtractedToQuestionBankInput() → Question Bank
 *
 * Cada fonte futura (OCR, PDF parser, LLM, CSV) será um adaptador
 * que produz ExtractedQuestion[] a partir do payload bruto.
 * O Question Bank não precisa saber de onde veio a questão.
 *
 * PRINCÍPIOS:
 * - Função pura: mesmo input → mesmo output, sempre.
 * - Sem Date.now(), new Date(), Math.random().
 * - Sem Supabase, banco, rede, estado global.
 * - Não altera engines ou services existentes.
 */

import type { QuestionOrigin, QuestionNovelty } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS E TIPOS DE ORIGEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fonte da ingestão — de onde o conteúdo bruto veio.
 * Cada fonte terá um adaptador/parser dedicado no futuro.
 */
export type IngestionSource =
  "manual" | "imagem_print" | "pdf_prova" | "banco_externo" | "api_externa" | "importacao_csv";

/**
 * Status do ciclo de vida de uma ingestão.
 */
export type IngestionStatus =
  "pendente" | "validando" | "valida" | "invalida" | "importada" | "descartada";

/**
 * Tipo de conteúdo bruto recebido.
 */
export type RawContentType =
  "text_plain" | "text_json" | "text_csv" | "image_base64" | "image_url" | "pdf_base64" | "pdf_url";

// ─────────────────────────────────────────────────────────────────────────────
// PAYLOAD BRUTO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conteúdo bruto recebido de qualquer fonte.
 * O adaptador de cada fonte é responsável por preencher este payload.
 */
export type RawIngestionPayload = {
  /** Identificador único do payload (gerado externamente) */
  payloadId: string;
  /** Fonte da ingestão */
  source: IngestionSource;
  /** Tipo do conteúdo bruto */
  contentType: RawContentType;
  /** Dados brutos (texto, JSON stringificado, base64, URL, etc) */
  rawData: string;
  /** Metadados opcionais da fonte (ex: nome do arquivo, URL de origem) */
  sourceMetadata?: Record<string, unknown> | null;
  /** Timestamp ISO de quando o payload foi recebido */
  receivedAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// QUESTÃO EXTRAÍDA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Alternativa individual de uma questão.
 */
export type ExtractedAlternative = {
  /** Letra da alternativa (A, B, C, D, E...) */
  letter: string;
  /** Texto da alternativa */
  text: string;
  /** Se é a alternativa correta (quando disponível) */
  isCorrect: boolean | null;
};

/**
 * Metadados de concurso, banca e prova.
 */
export type ContestMetadata = {
  /** Nome da banca examinadora */
  examBoard: string | null;
  /** Nome do concurso */
  contestName: string | null;
  /** Ano da prova */
  year: number | null;
  /** Cargo (quando disponível) */
  position: string | null;
  /** Órgão (quando disponível) */
  organization: string | null;
  /** Nome da prova ou caderno (ex: Prova Tipo 1) */
  examName?: string | null;
  /** Número da questão na prova (ex: 42) */
  questionNumber?: number | string | null;
  /** Título da fonte ou prova */
  sourceTitle?: string | null;
  /** URL da fonte (quando disponível) */
  sourceUrl?: string | null;
  /** Identificador externo (ex: Q123456) */
  externalId?: string | null;
};

/** Alias conceitual para metadados de origem genéricos (PDF, print, API, edital, etc) */
export type OriginContext = ContestMetadata;
export type SourceMetadata = ContestMetadata;

/**
 * Questão extraída e normalizada, pronta para validação.
 * Produzida por um adaptador de ingestão a partir do conteúdo bruto.
 */
export type ExtractedQuestion = {
  /** Identificador temporário dentro da ingestão (ex: índice, hash) */
  extractionId: string;
  /** ID do payload de origem */
  payloadId: string;
  /** Enunciado da questão */
  statement: string;
  /** Alternativas */
  alternatives: ExtractedAlternative[];
  /** Resposta correta (letra) — pode ser extraída das alternativas ou informada separadamente */
  correctAnswer: string | null;
  /** Se é questão de verdadeiro/falso (certo/errado) */
  isTrueFalse: boolean;
  /** Explicação / gabarito comentado (quando disponível) */
  explanation: string | null;
  /** Metadados de concurso */
  contestMetadata: ContestMetadata;
  /** Nome ou ID da matéria (texto livre, será mapeado depois) */
  subjectLabel: string | null;
  /** Nome ou ID do tópico (texto livre, será mapeado depois) */
  topicLabel: string | null;
  /** Dificuldade estimada (1-5, quando disponível) */
  difficulty: number | null;
  /** Tags extraídas */
  tags: string[];
  /** Confiança da extração (0..1) — 1.0 para entrada manual */
  extractionConfidence: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erro de validação de uma questão extraída.
 */
export type IngestionValidationError = {
  /** Campo que falhou na validação */
  field: string;
  /** Descrição do erro */
  message: string;
};

/**
 * Resultado da validação de uma questão extraída.
 */
export type QuestionValidationResult = {
  /** Se a questão é válida para importação */
  isValid: boolean;
  /** Erros encontrados */
  errors: IngestionValidationError[];
  /** Avisos (não impedem importação, mas indicam dados incompletos) */
  warnings: IngestionValidationError[];
};

/**
 * Valida uma questão extraída contra regras de integridade.
 *
 * Regras obrigatórias (geram erro):
 *   - statement não pode ser vazio
 *   - Deve ter pelo menos 2 alternativas (exceto V/F)
 *   - Alternativas devem ter letra e texto não vazios
 *   - Não pode ter letras duplicadas nas alternativas
 *   - correctAnswer, se informado, deve corresponder a uma alternativa existente
 *   - difficulty, se informado, deve ser entre 1 e 5
 *   - extractionConfidence deve ser entre 0 e 1
 *
 * Regras sugeridas (geram warning):
 *   - Sem gabarito (correctAnswer null)
 *   - Sem matéria ou tópico
 *   - Sem metadados de concurso (banca, ano)
 *   - Confiança de extração baixa (<0.5)
 *
 * Determinístico: mesmo input → mesmo output.
 */
export function validateExtractedQuestion(question: ExtractedQuestion): QuestionValidationResult {
  const errors: IngestionValidationError[] = [];
  const warnings: IngestionValidationError[] = [];

  // ── Enunciado ──
  if (!question.statement || question.statement.trim().length === 0) {
    errors.push({ field: "statement", message: "Enunciado é obrigatório." });
  }

  // ── Alternativas ──
  if (!question.isTrueFalse) {
    if (question.alternatives.length < 2) {
      errors.push({
        field: "alternatives",
        message: "Questão de múltipla escolha deve ter pelo menos 2 alternativas.",
      });
    }
  }

  const letters = new Set<string>();
  for (let i = 0; i < question.alternatives.length; i++) {
    const alt = question.alternatives[i]!;
    if (!alt.letter || alt.letter.trim().length === 0) {
      errors.push({
        field: `alternatives[${i}].letter`,
        message: `Alternativa ${i} deve ter uma letra.`,
      });
    }
    if (!alt.text || alt.text.trim().length === 0) {
      errors.push({
        field: `alternatives[${i}].text`,
        message: `Alternativa ${i} deve ter texto.`,
      });
    }
    if (alt.letter && alt.letter.trim().length > 0) {
      const normalizedLetter = alt.letter.trim().toUpperCase();
      if (letters.has(normalizedLetter)) {
        errors.push({
          field: `alternatives[${i}].letter`,
          message: `Letra "${normalizedLetter}" duplicada nas alternativas.`,
        });
      }
      letters.add(normalizedLetter);
    }
  }

  // ── Gabarito ──
  if (question.correctAnswer !== null && question.correctAnswer.trim().length > 0) {
    const answerUpper = question.correctAnswer.trim().toUpperCase();
    if (!question.isTrueFalse && question.alternatives.length > 0) {
      const validLetters = new Set(
        question.alternatives
          .filter((a) => a.letter && a.letter.trim().length > 0)
          .map((a) => a.letter.trim().toUpperCase()),
      );
      if (!validLetters.has(answerUpper)) {
        errors.push({
          field: "correctAnswer",
          message: `Gabarito "${question.correctAnswer}" não corresponde a nenhuma alternativa.`,
        });
      }
    }
  } else {
    warnings.push({
      field: "correctAnswer",
      message: "Questão sem gabarito definido.",
    });
  }

  // ── Dificuldade ──
  if (question.difficulty !== null) {
    if (
      !Number.isFinite(question.difficulty) ||
      question.difficulty < 1 ||
      question.difficulty > 5
    ) {
      errors.push({
        field: "difficulty",
        message: "Dificuldade deve ser entre 1 e 5.",
      });
    }
  }

  // ── Confiança ──
  if (
    !Number.isFinite(question.extractionConfidence) ||
    question.extractionConfidence < 0 ||
    question.extractionConfidence > 1
  ) {
    errors.push({
      field: "extractionConfidence",
      message: "Confiança de extração deve ser entre 0 e 1.",
    });
  } else if (question.extractionConfidence < 0.5) {
    warnings.push({
      field: "extractionConfidence",
      message: "Confiança de extração baixa (< 0.5). Revise manualmente.",
    });
  }

  // ── Warnings de dados incompletos ──
  if (!question.subjectLabel) {
    warnings.push({
      field: "subjectLabel",
      message: "Questão sem matéria definida.",
    });
  }
  if (!question.topicLabel) {
    warnings.push({
      field: "topicLabel",
      message: "Questão sem tópico definido.",
    });
  }
  if (!question.contestMetadata.examBoard) {
    warnings.push({
      field: "contestMetadata.examBoard",
      message: "Questão sem banca examinadora.",
    });
  }
  if (question.contestMetadata.year === null) {
    warnings.push({
      field: "contestMetadata.year",
      message: "Questão sem ano da prova.",
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Classificação objetiva de qualidade de uma questão.
 * - VALID: Estrutura essencial íntegra e sem avisos de metadados opcionais ausentes.
 * - INCOMPLETE: Estrutura essencial íntegra, mas com metadados opcionais ausentes (sem proibir ingestão).
 * - INVALID: Falta informação estrutural essencial (enunciado ausente, alternativas corrompidas, etc).
 */
export type QuestionQualityClass = "VALID" | "INCOMPLETE" | "INVALID";

/**
 * Classifica objetivamente a qualidade de uma questão extraída.
 *
 * Determinístico: mesmo input → mesmo output.
 */
export function classifyQuestionQuality(question: ExtractedQuestion): QuestionQualityClass {
  const validation = validateExtractedQuestion(question);
  if (!validation.isValid) {
    return "INVALID";
  }
  if (validation.warnings.length > 0) {
    return "INCOMPLETE";
  }
  return "VALID";
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULTADO DA INGESTÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Questão validada com resultado da validação.
 */
export type ValidatedQuestion = {
  question: ExtractedQuestion;
  validation: QuestionValidationResult;
};

/**
 * Resultado completo do processamento de um payload de ingestão.
 */
export type IngestionResult = {
  /** ID do payload processado */
  payloadId: string;
  /** Fonte da ingestão */
  source: IngestionSource;
  /** Status geral da ingestão */
  status: IngestionStatus;
  /** Total de questões extraídas */
  totalExtracted: number;
  /** Questões válidas */
  validQuestions: ValidatedQuestion[];
  /** Questões inválidas */
  invalidQuestions: ValidatedQuestion[];
  /** Erros globais (não ligados a uma questão específica) */
  globalErrors: string[];
  /** Timestamp ISO do processamento */
  processedAt: string;
};

/**
 * Processa um payload bruto de ingestão.
 *
 * Nesta fase, o processamento aceita apenas conteúdo do tipo text_json
 * contendo um array de ExtractedQuestion[]. Os demais tipos (imagem, PDF,
 * CSV) retornam erro global indicando que o adaptador não está implementado.
 *
 * Cada questão extraída é validada individualmente.
 *
 * Determinístico: mesmo input → mesmo output.
 *
 * @param payload - Conteúdo bruto recebido.
 * @param processedAt - Timestamp ISO de quando o processamento ocorreu.
 */
export function processIngestionPayload(
  payload: RawIngestionPayload,
  processedAt: string,
): IngestionResult {
  const base: Omit<
    IngestionResult,
    "status" | "totalExtracted" | "validQuestions" | "invalidQuestions" | "globalErrors"
  > = {
    payloadId: payload.payloadId,
    source: payload.source,
    processedAt,
  };

  // ── Apenas text_json é suportado nesta fase ──
  if (payload.contentType !== "text_json") {
    return {
      ...base,
      status: "invalida",
      totalExtracted: 0,
      validQuestions: [],
      invalidQuestions: [],
      globalErrors: [
        `Tipo de conteúdo "${payload.contentType}" ainda não possui adaptador implementado. Use "text_json" com um array de questões.`,
      ],
    };
  }

  // ── Parse do JSON ──
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.rawData);
  } catch {
    return {
      ...base,
      status: "invalida",
      totalExtracted: 0,
      validQuestions: [],
      invalidQuestions: [],
      globalErrors: ["Falha ao fazer parse do JSON. Verifique o formato dos dados."],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      ...base,
      status: "invalida",
      totalExtracted: 0,
      validQuestions: [],
      invalidQuestions: [],
      globalErrors: ["O conteúdo JSON deve ser um array de questões."],
    };
  }

  if (parsed.length === 0) {
    return {
      ...base,
      status: "invalida",
      totalExtracted: 0,
      validQuestions: [],
      invalidQuestions: [],
      globalErrors: ["O array de questões está vazio."],
    };
  }

  // ── Validar cada questão ──
  const questions = parsed as ExtractedQuestion[];
  const validQuestions: ValidatedQuestion[] = [];
  const invalidQuestions: ValidatedQuestion[] = [];

  for (const q of questions) {
    const validation = validateExtractedQuestion(q);
    const entry: ValidatedQuestion = { question: q, validation };
    if (validation.isValid) {
      validQuestions.push(entry);
    } else {
      invalidQuestions.push(entry);
    }
  }

  const totalExtracted = questions.length;
  const status: IngestionStatus =
    validQuestions.length === 0
      ? "invalida"
      : invalidQuestions.length === 0
        ? "valida"
        : "validando"; // mix de válidas e inválidas → requer revisão

  return {
    ...base,
    status,
    totalExtracted,
    validQuestions,
    invalidQuestions,
    globalErrors: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAPEAMENTO PARA O QUESTION BANK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input compatível com o Question Bank para criação de questão.
 * Mapeia da camada de ingestão para o formato que o banco espera.
 * Não depende do Supabase — é um tipo de dado puro.
 */
export type QuestionBankInput = {
  statement: string;
  alternatives: unknown[];
  correctAnswer: string | null;
  isTrueFalse: boolean;
  examBoard: string | null;
  contestName: string | null;
  year: number | null;
  difficulty: number | null;
  origin: QuestionOrigin;
  novelty: QuestionNovelty;
  tags: string[];
  explanation: string | null;
  isPublic: boolean;
};

/**
 * Mapeia IngestionSource para QuestionOrigin do banco.
 *
 * Exportada para reutilização por outros módulos (ex: gemini-service).
 */
export function mapSourceToOrigin(source: IngestionSource): QuestionOrigin {
  switch (source) {
    case "manual":
      return "manual";
    case "imagem_print":
    case "pdf_prova":
      return "ocr";
    case "banco_externo":
    case "api_externa":
      return "banco_externo";
    case "importacao_csv":
      return "banco_externo";
    default:
      return "manual";
  }
}

/**
 * Converte uma questão extraída válida para o formato de entrada
 * do Question Bank existente.
 *
 * Faz a ponte entre a camada de ingestão e o banco sem alterar
 * engines ou services existentes.
 *
 * Determinístico: mesmo input → mesmo output.
 *
 * @param question - Questão extraída (deve ter passado na validação).
 * @param source - Fonte da ingestão (para mapear a origin).
 */
export function mapExtractedToQuestionBankInput(
  question: ExtractedQuestion,
  source: IngestionSource,
): QuestionBankInput {
  // Converter alternativas para o formato JSON do banco
  const alternatives = question.alternatives.map((alt) => ({
    letter: alt.letter,
    text: alt.text,
  }));

  return {
    statement: question.statement,
    alternatives,
    correctAnswer: question.correctAnswer,
    isTrueFalse: question.isTrueFalse,
    examBoard: question.contestMetadata.examBoard,
    contestName: question.contestMetadata.contestName,
    year: question.contestMetadata.year,
    difficulty: question.difficulty,
    origin: mapSourceToOrigin(source),
    novelty: "nova" as QuestionNovelty,
    tags: [...question.tags],
    explanation: question.explanation,
    isPublic: false,
  };
}
