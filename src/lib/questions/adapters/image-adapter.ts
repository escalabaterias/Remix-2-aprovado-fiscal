/**
 * ADAPTADOR DE INGESTÃO POR IMAGEM/PRINT
 *
 * Recebe um RawIngestionPayload de origem "imagem_print" e produz
 * uma estrutura intermediária (ImageExtractionRequest) pronta para
 * futura extração por OCR / Google LLM.
 *
 * RESPONSABILIDADES:
 *   - Validar que o payload é de imagem (origem + contentType)
 *   - Extrair e preservar metadados de concurso do sourceMetadata
 *   - Produzir um ImageExtractionRequest determinístico
 *
 * NÃO FAZ:
 *   - OCR ou chamada a API externa
 *   - Acesso ao Supabase
 *   - Validação de questões extraídas (isso é do ingestion.ts)
 *   - Duplicar regras de validateExtractedQuestion
 *
 * PRINCÍPIOS:
 *   - Função pura: mesmo input → mesmo output, sempre.
 *   - Sem Date.now(), new Date(), Math.random().
 *   - Sem Supabase, banco, rede, estado global.
 */

import type { RawIngestionPayload, RawContentType, ContestMetadata } from "../ingestion";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

/** Tipos de conteúdo aceitos pelo adaptador de imagem. */
const IMAGE_CONTENT_TYPES: ReadonlySet<RawContentType> = new Set(["image_base64", "image_url"]);

/**
 * Código de erro específico do adaptador de imagem.
 */
export type ImageAdapterErrorCode = "INVALID_SOURCE" | "INVALID_CONTENT_TYPE" | "EMPTY_IMAGE_DATA";

/**
 * Erro retornado quando o payload não é válido para o adaptador de imagem.
 */
export type ImageAdapterError = {
  code: ImageAdapterErrorCode;
  message: string;
};

/**
 * Resultado da preparação do payload de imagem.
 * Segue o padrão Result (ok | err) para evitar exceções.
 */
export type ImageAdapterResult =
  { ok: true; data: ImageExtractionRequest } | { ok: false; error: ImageAdapterError };

/**
 * Estrutura intermediária pronta para futura extração por OCR/LLM.
 * Contém a imagem bruta + metadados contextuais que ajudam o extrator
 * a interpretar o conteúdo (ex: saber a banca ajuda a identificar o formato).
 */
export type ImageExtractionRequest = {
  /** ID do payload de origem */
  payloadId: string;
  /** Tipo do conteúdo (image_base64 ou image_url) */
  contentType: RawContentType;
  /** Dados brutos da imagem (base64 ou URL) */
  imageData: string;
  /** Metadados de concurso extraídos do sourceMetadata */
  contestMetadata: ContestMetadata;
  /** Metadados adicionais da fonte (preservados integralmente) */
  sourceMetadata: Record<string, unknown> | null;
  /** Timestamp ISO de quando o payload foi recebido */
  receivedAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES AUXILIARES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrai ContestMetadata do sourceMetadata do payload.
 * Campos ausentes ou de tipo incorreto viram null.
 *
 * Determinístico: mesmo input → mesmo output.
 */
export function extractContestMetadata(
  sourceMetadata: Record<string, unknown> | null | undefined,
): ContestMetadata {
  if (!sourceMetadata || typeof sourceMetadata !== "object") {
    return {
      examBoard: null,
      contestName: null,
      year: null,
      position: null,
      organization: null,
    };
  }

  const getString = (key: string): string | null => {
    const val = sourceMetadata[key];
    return typeof val === "string" && val.trim().length > 0 ? val.trim() : null;
  };

  const getNumber = (key: string): number | null => {
    const val = sourceMetadata[key];
    if (typeof val === "number" && Number.isFinite(val)) {
      return val;
    }
    // Aceita string numérica (ex: "2024")
    if (typeof val === "string") {
      const parsed = Number(val);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  };

  return {
    examBoard: getString("examBoard") ?? getString("banca"),
    contestName: getString("contestName") ?? getString("concurso"),
    year: getNumber("year") ?? getNumber("ano"),
    position: getString("position") ?? getString("cargo") ?? getString("roleTitle"),
    organization: getString("organization") ?? getString("orgao"),
    examName: getString("examName") ?? getString("prova"),
    questionNumber:
      getNumber("questionNumber") ??
      getString("questionNumber") ??
      getNumber("numeroQuestao") ??
      getString("numeroQuestao"),
    sourceTitle: getString("sourceTitle") ?? getString("fonte"),
    sourceUrl: getString("sourceUrl") ?? getString("url"),
    externalId: getString("externalId") ?? getString("idExterno"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prepara um payload de imagem/print para futura extração por OCR/LLM.
 *
 * Validações realizadas (específicas do adaptador de imagem):
 *   1. source deve ser "imagem_print"
 *   2. contentType deve ser image_base64 ou image_url
 *   3. rawData não pode ser vazio
 *
 * Não duplica validações do ingestion.ts (ex: validação de questões extraídas).
 *
 * Determinístico: mesmo input → mesmo output.
 *
 * @param payload - Payload bruto recebido.
 * @returns ImageAdapterResult com a estrutura intermediária ou erro.
 */
export function prepareImagePayload(payload: RawIngestionPayload): ImageAdapterResult {
  // ── Validar origem ──
  if (payload.source !== "imagem_print") {
    return {
      ok: false,
      error: {
        code: "INVALID_SOURCE",
        message: `Origem esperada: "imagem_print". Recebida: "${payload.source}".`,
      },
    };
  }

  // ── Validar tipo de conteúdo ──
  if (!IMAGE_CONTENT_TYPES.has(payload.contentType)) {
    return {
      ok: false,
      error: {
        code: "INVALID_CONTENT_TYPE",
        message: `Tipo de conteúdo esperado: image_base64 ou image_url. Recebido: "${payload.contentType}".`,
      },
    };
  }

  // ── Validar dados da imagem ──
  if (!payload.rawData || payload.rawData.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "EMPTY_IMAGE_DATA",
        message: "Dados da imagem estão vazios.",
      },
    };
  }

  // ── Extrair metadados ──
  const contestMetadata = extractContestMetadata(payload.sourceMetadata);

  return {
    ok: true,
    data: {
      payloadId: payload.payloadId,
      contentType: payload.contentType,
      imageData: payload.rawData,
      contestMetadata,
      sourceMetadata: payload.sourceMetadata ?? null,
      receivedAt: payload.receivedAt,
    },
  };
}
