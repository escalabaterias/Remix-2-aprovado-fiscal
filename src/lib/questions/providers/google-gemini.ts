/**
 * ADAPTADOR DE PROVEDOR GOOGLE GEMINI PARA EXTRAÇÃO DE QUESTÕES
 *
 * Recebe um ImageExtractionRequest, envia a imagem para o Google Gemini
 * e retorna um RawProviderResult compatível com a camada extraction.ts.
 *
 * RESPONSABILIDADES:
 *   - Montar o prompt de extração de questões para o Gemini
 *   - Enviar a imagem (base64 ou URL) via API REST do Gemini
 *   - Parsear a resposta JSON do modelo
 *   - Retornar RawProviderResult (sucesso ou erro estruturado)
 *   - Respeitar timeout configurável
 *
 * NÃO FAZ:
 *   - Conversão para ExtractedQuestion (isso é da extraction.ts)
 *   - Validação de questões extraídas (isso é do ingestion.ts)
 *   - Acesso ao Supabase ou banco de dados
 *   - Cache de resultados (isso é do gateway.ts quando implementado)
 *
 * REUTILIZA:
 *   - ImageExtractionRequest (adapters/image-adapter.ts)
 *   - RawProviderResult, ExtractedQuestionData (extraction.ts)
 */

import type { ImageExtractionRequest } from "../adapters/image-adapter";
import type { RawProviderResult, ExtractedQuestionData } from "../extraction";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opções de configuração para o provedor Gemini.
 */
export type GeminiProviderConfig = {
  /** Chave de API do Google Gemini */
  apiKey: string;
  /** Modelo a usar (ex: "gemini-3.6-flash", "gemini-1.5-pro") */
  model?: string;
  /** Timeout em milissegundos (padrão: 30000) */
  timeoutMs?: number;
  /** URL base da API (padrão: endpoint oficial) */
  baseUrl?: string;
};

/** Modelo padrão do Gemini */
const DEFAULT_MODEL = "gemini-3.6-flash";

/** Timeout padrão em ms */
const DEFAULT_TIMEOUT_MS = 30_000;

/** URL base padrão da API Gemini */
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monta o prompt de sistema para extração de questões.
 * Inclui metadados de concurso quando disponíveis para melhorar a extração.
 */
export function buildExtractionPrompt(request: ImageExtractionRequest): string {
  const contextParts: string[] = [];

  if (request.contestMetadata?.examBoard) {
    contextParts.push(`Banca: ${request.contestMetadata.examBoard}`);
  }
  if (request.contestMetadata?.contestName) {
    contextParts.push(`Concurso: ${request.contestMetadata.contestName}`);
  }
  if (request.contestMetadata?.year) {
    contextParts.push(`Ano: ${request.contestMetadata.year}`);
  }
  if (request.contestMetadata?.position) {
    contextParts.push(`Cargo: ${request.contestMetadata.position}`);
  }
  if (request.contestMetadata?.organization) {
    contextParts.push(`Órgão: ${request.contestMetadata.organization}`);
  }
  if (request.contestMetadata?.examName) {
    contextParts.push(`Prova: ${request.contestMetadata.examName}`);
  }
  if (request.contestMetadata?.questionNumber) {
    contextParts.push(`Número da questão: ${request.contestMetadata.questionNumber}`);
  }
  if (request.contestMetadata?.sourceTitle) {
    contextParts.push(`Fonte: ${request.contestMetadata.sourceTitle}`);
  }

  const contextBlock =
    contextParts.length > 0
      ? `\n\nContexto pré-informado pelo usuário:\n${contextParts.join("\n")}`
      : "";

  return `Você é um extrator especialista de questões de concurso público a partir de imagens. Analise cuidadosamente todo o conteúdo visual da imagem, incluindo cabeçalhos, rodapés, numeração de páginas e dados contextuais da questão.${contextBlock}

Retorne SOMENTE um JSON válido (sem markdown, sem texto extra) com a seguinte estrutura:
{
  "questions": [
    {
      "statement": "texto do enunciado da questão",
      "alternatives": [
        { "letter": "A", "text": "texto da alternativa", "isCorrect": true },
        { "letter": "B", "text": "texto da alternativa", "isCorrect": false }
      ],
      "correctAnswer": "A",
      "isTrueFalse": false,
      "explanation": "explicação do gabarito (se visível)",
      "subjectLabel": "nome da matéria",
      "topicLabel": "nome do tópico",
      "contestName": "nome do concurso identificado na imagem",
      "examBoard": "banca examinadora identificada na imagem (ex: FGV, CEBRASPE, FCC, VUNESP)",
      "year": 2023,
      "organization": "órgão promotor identificado (ex: Receita Federal, SEFAZ-SP)",
      "roleTitle": "cargo identificado (ex: Auditor Fiscal)",
      "examName": "nome da prova/caderno (ex: Prova Tipo 1)",
      "questionNumber": 42,
      "sourceTitle": "título da fonte ou prova",
      "sourceUrl": null,
      "externalId": null,
      "difficulty": 3,
      "tags": ["tag1", "tag2"],
      "confidence": 0.9
    }
  ],
  "overallConfidence": 0.9
}

Regras:
- Extraia TODAS as questões visíveis na imagem.
- Examine o cabeçalho e rodapé da questão para identificar banca, ano, órgão, concurso, cargo, prova e número da questão.
- Se houver gabarito explicitamente impresso ou fornecido na fonte, preencha correctAnswer e isCorrect nas alternativas.
- Se o gabarito NÃO estiver explicitamente presente na fonte, NUNCA adivinhe, deduza ou resolva a questão para inventar o gabarito: MANTENHA correctAnswer como null e isCorrect como null nas alternativas.
- Se for questão de certo/errado (V/F), defina isTrueFalse como true e correctAnswer como "C" ou "E".
- NUNCA invente URLs ou IDs externos que não estejam explicitamente impressos no texto da imagem. Se ausente, retorne null.
- Estime a dificuldade de 1 (muito fácil) a 5 (muito difícil).
- A confiança (confidence) deve refletir a qualidade da extração dessa questão (0 a 1).
- overallConfidence reflete a qualidade geral da extração de todas as questões.
- Se não conseguir extrair nenhuma questão, retorne { "questions": [], "overallConfidence": 0 }.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORPO DA REQUISIÇÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monta o corpo da requisição para a API Gemini.
 */
export function buildRequestBody(
  request: ImageExtractionRequest,
  prompt: string,
): Record<string, unknown> {
  const imagePart =
    request.contentType === "image_base64"
      ? {
          inlineData: {
            mimeType: "image/png",
            data: request.imageData,
          },
        }
      : {
          fileData: {
            mimeType: "image/png",
            fileUri: request.imageData,
          },
        };

  return {
    contents: [
      {
        parts: [{ text: prompt }, imagePart],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.95,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSE DA RESPOSTA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resultado do parse da resposta Gemini.
 */
type ParsedGeminiResponse = {
  questions: ExtractedQuestionData[];
  overallConfidence: number | null;
};

/**
 * Extrai e parseia o JSON da resposta do Gemini.
 * Tenta extrair do campo text dos candidates, com fallback para extração de JSON embutido.
 *
 * @returns ParsedGeminiResponse ou null se não conseguir parsear.
 */
export function parseGeminiResponse(responseBody: unknown): ParsedGeminiResponse | null {
  if (!responseBody || typeof responseBody !== "object") return null;

  const body = responseBody as Record<string, unknown>;

  // Extrair texto da resposta do candidato
  const candidates = body.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const firstCandidate = candidates[0] as Record<string, unknown> | undefined;
  if (!firstCandidate) return null;

  const content = firstCandidate.content as Record<string, unknown> | undefined;
  if (!content) return null;

  const parts = content.parts as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(parts) || parts.length === 0) return null;

  const textPart = parts.find((p) => typeof p.text === "string");
  if (!textPart || typeof textPart.text !== "string") return null;

  const rawText = (textPart.text as string).trim();
  if (rawText.length === 0) return null;

  // Tentar parse direto
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // Tentar extrair JSON embutido em markdown (```json ... ```)
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      try {
        parsed = JSON.parse(jsonMatch[1].trim());
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object") return null;

  const data = parsed as Record<string, unknown>;

  // Extrair questions
  const rawQuestions = data.questions;
  if (!Array.isArray(rawQuestions)) return null;

  const questions: ExtractedQuestionData[] = rawQuestions
    .filter((q): q is Record<string, unknown> => q !== null && typeof q === "object")
    .map((q) => {
      const getNumber = (val: unknown): number | null => {
        if (typeof val === "number" && Number.isFinite(val)) return val;
        if (typeof val === "string") {
          const num = Number(val);
          if (Number.isFinite(num)) return num;
        }
        return null;
      };

      const getString = (val: unknown): string | null => {
        return typeof val === "string" && val.trim().length > 0 ? val.trim() : null;
      };

      return {
        statement: typeof q.statement === "string" ? q.statement : "",
        alternatives: Array.isArray(q.alternatives)
          ? (q.alternatives as Array<Record<string, unknown>>).map((a) => ({
              letter: typeof a.letter === "string" ? a.letter : "",
              text: typeof a.text === "string" ? a.text : "",
              isCorrect: typeof a.isCorrect === "boolean" ? a.isCorrect : null,
            }))
          : [],
        correctAnswer: typeof q.correctAnswer === "string" ? q.correctAnswer : null,
        isTrueFalse: q.isTrueFalse === true,
        explanation: typeof q.explanation === "string" ? q.explanation : null,
        subjectLabel: getString(q.subjectLabel) ?? getString(q.subject),
        topicLabel: getString(q.topicLabel) ?? getString(q.topic),
        contestName: getString(q.contestName) ?? getString(q.concurso),
        examBoard: getString(q.examBoard) ?? getString(q.banca),
        year: getNumber(q.year) ?? getNumber(q.ano),
        organization: getString(q.organization) ?? getString(q.orgao),
        roleTitle: getString(q.roleTitle) ?? getString(q.cargo) ?? getString(q.position),
        position: getString(q.position) ?? getString(q.cargo) ?? getString(q.roleTitle),
        examName: getString(q.examName) ?? getString(q.prova),
        questionNumber:
          getNumber(q.questionNumber) ??
          getString(q.questionNumber) ??
          getNumber(q.numeroQuestao) ??
          getString(q.numeroQuestao),
        sourceTitle: getString(q.sourceTitle) ?? getString(q.fonte),
        sourceUrl: getString(q.sourceUrl) ?? getString(q.url),
        externalId: getString(q.externalId) ?? getString(q.idExterno),
        difficulty:
          typeof q.difficulty === "number" && Number.isFinite(q.difficulty) ? q.difficulty : null,
        tags: Array.isArray(q.tags)
          ? (q.tags as unknown[]).filter((t): t is string => typeof t === "string")
          : [],
        confidence:
          typeof q.confidence === "number" && Number.isFinite(q.confidence) ? q.confidence : null,
      };
    });

  // Extrair overallConfidence
  const overallConfidence =
    typeof data.overallConfidence === "number" && Number.isFinite(data.overallConfidence)
      ? data.overallConfidence
      : null;

  return { questions, overallConfidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envia uma imagem para o Google Gemini e extrai as questões.
 *
 * Retorna um RawProviderResult compatível com convertProviderResult()
 * de extraction.ts.
 *
 * @param request - ImageExtractionRequest do image-adapter.
 * @param config - Configuração do provedor Gemini.
 * @param fetchFn - Função fetch injetável (para testes). Padrão: fetch global.
 * @returns RawProviderResult com questões extraídas ou erro.
 */
export async function extractWithGemini(
  request: ImageExtractionRequest,
  config: GeminiProviderConfig,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<RawProviderResult> {
  const model = config.model ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}/${model}:generateContent?key=${config.apiKey}`;

  const prompt = buildExtractionPrompt(request);
  const body = buildRequestBody(request, prompt);

  const startTime = Date.now();

  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: unknown) {
    const elapsed = Date.now() - startTime;

    // Abort / timeout
    if (error instanceof DOMException || (error instanceof Error && error.name === "AbortError")) {
      return {
        success: false,
        questions: [],
        errorCode: "TIMEOUT",
        errorMessage: `Requisição ao Gemini excedeu o timeout de ${timeoutMs}ms.`,
        overallConfidence: null,
        processingTimeMs: elapsed,
      };
    }

    return {
      success: false,
      questions: [],
      errorCode: "PROVIDER_ERROR",
      errorMessage:
        error instanceof Error ? error.message : "Erro desconhecido na requisição ao Gemini.",
      overallConfidence: null,
      processingTimeMs: elapsed,
    };
  }

  const elapsed = Date.now() - startTime;

  // HTTP error
  if (!response.ok) {
    let errorMessage = `Gemini API retornou status ${response.status}.`;
    try {
      const errorBody = (await response.json()) as Record<string, unknown>;
      if (
        errorBody.error &&
        typeof errorBody.error === "object" &&
        (errorBody.error as Record<string, unknown>).message
      ) {
        errorMessage = `Gemini API: ${(errorBody.error as Record<string, unknown>).message}`;
      }
    } catch {
      // Ignora erros ao ler o body de erro
    }

    return {
      success: false,
      questions: [],
      errorCode: "PROVIDER_ERROR",
      errorMessage,
      overallConfidence: null,
      processingTimeMs: elapsed,
    };
  }

  // Parse response
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return {
      success: false,
      questions: [],
      errorCode: "PARSE_FAILURE",
      errorMessage: "Não foi possível parsear a resposta JSON do Gemini.",
      overallConfidence: null,
      processingTimeMs: elapsed,
    };
  }

  const parsed = parseGeminiResponse(responseBody);

  if (parsed === null) {
    return {
      success: false,
      questions: [],
      errorCode: "PARSE_FAILURE",
      errorMessage: "Resposta do Gemini não contém formato esperado de questões.",
      overallConfidence: null,
      processingTimeMs: elapsed,
    };
  }

  // Resposta vazia (nenhuma questão)
  if (parsed.questions.length === 0) {
    return {
      success: true,
      questions: [],
      overallConfidence: parsed.overallConfidence,
      processingTimeMs: elapsed,
    };
  }

  return {
    success: true,
    questions: parsed.questions,
    overallConfidence: parsed.overallConfidence,
    processingTimeMs: elapsed,
  };
}
