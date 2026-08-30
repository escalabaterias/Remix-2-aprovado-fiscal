/**
 * CONFIGURAÇÃO SEGURA DO GOOGLE GEMINI
 *
 * Lê a API key do ambiente (process.env.GEMINI_API_KEY) e retorna
 * um GeminiProviderConfig pronto para uso por extractWithGemini().
 *
 * RESPONSABILIDADES:
 *   - Ler GEMINI_API_KEY de process.env (server-side)
 *   - Validar que a key existe e não está vazia
 *   - Retornar GeminiProviderConfig com defaults seguros
 *   - Lançar GeminiConfigError com código semântico quando ausente
 *
 * NÃO FAZ:
 *   - Chamada de rede, fetch, ou acesso a banco
 *   - Armazenamento da key em cache ou estado global
 *   - Hardcode de qualquer API key
 *
 * SEGURANÇA:
 *   - A key NUNCA deve ser exposta no bundle do cliente.
 *   - Este módulo deve ser importado apenas em server functions
 *     ou módulos .server.ts.
 */

import type { GeminiProviderConfig } from "./google-gemini";

// ─────────────────────────────────────────────────────────────────────────────
// ERRO
// ─────────────────────────────────────────────────────────────────────────────

export type GeminiConfigErrorCode = "MISSING_API_KEY";

/**
 * Erro lançado quando a configuração do Gemini é inválida ou ausente.
 */
export class GeminiConfigError extends Error {
  readonly code: GeminiConfigErrorCode;

  constructor(code: GeminiConfigErrorCode, message: string) {
    super(message);
    this.name = "GeminiConfigError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPÇÕES DE OVERRIDE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Overrides opcionais para a configuração do Gemini.
 * A apiKey nunca é passada aqui — sempre vem do ambiente.
 */
export type GeminiConfigOverrides = {
  /** Modelo a usar (padrão: "gemini-3.6-flash") */
  model?: string;
  /** Timeout em milissegundos (padrão: 30000) */
  timeoutMs?: number;
  /** URL base da API (padrão: endpoint oficial) */
  baseUrl?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

const ENV_VAR_NAME = "GEMINI_API_KEY";

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Obtém a configuração do Gemini a partir da variável de ambiente.
 *
 * Lê `process.env.GEMINI_API_KEY` e retorna um `GeminiProviderConfig`
 * pronto para ser passado a `extractWithGemini()`.
 *
 * @param overrides - Overrides opcionais para model, timeoutMs e baseUrl.
 * @returns GeminiProviderConfig com a apiKey do ambiente e os defaults.
 * @throws GeminiConfigError se GEMINI_API_KEY não estiver definida ou estiver vazia.
 */
export function getGeminiConfig(overrides?: GeminiConfigOverrides): GeminiProviderConfig {
  const apiKey = process.env[ENV_VAR_NAME];

  if (!apiKey || apiKey.trim().length === 0) {
    throw new GeminiConfigError(
      "MISSING_API_KEY",
      `A variável de ambiente ${ENV_VAR_NAME} não está definida ou está vazia. ` +
        `Defina-a em .env.local ou nas variáveis do ambiente de deploy.`,
    );
  }

  const config: GeminiProviderConfig = {
    apiKey: apiKey.trim(),
  };

  if (overrides?.model !== undefined) {
    config.model = overrides.model;
  }

  if (overrides?.timeoutMs !== undefined) {
    config.timeoutMs = overrides.timeoutMs;
  }

  if (overrides?.baseUrl !== undefined) {
    config.baseUrl = overrides.baseUrl;
  }

  return config;
}
