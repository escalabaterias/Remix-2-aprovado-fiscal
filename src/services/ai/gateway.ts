/**
 * Camada de serviço de IA — DESACOPLADA e ainda não conectada a nenhum provedor.
 *
 * Princípio: PROCESSAR UMA VEZ → ARMAZENAR → REUTILIZAR.
 *
 * Três níveis previstos:
 *  - `rapida`     operações simples e frequentes (classificação, normalização);
 *  - `inteligente` diagnóstico, planejamento e raciocínio;
 *  - `profunda`   processamento pesado de documentos, provas e grandes bases.
 *
 * Esta etapa define apenas o contrato e o utilitário de hash de entrada usado
 * pelo cache persistido em `ai_results`. Nenhuma chamada de modelo é feita aqui,
 * e nenhuma chave de API é referenciada no frontend: a execução real acontecerá
 * em server functions nas próximas etapas.
 */

export type AiTier = "rapida" | "inteligente" | "profunda";

export type AiTask = {
  /** Identificador estável da tarefa, ex.: "edital.parse", "erro.diagnostico". */
  type: string;
  tier: AiTier;
  /** Referência ao insumo (ids de registros, não conteúdo bruto extenso). */
  inputRef: Record<string, unknown>;
};

export type AiResult<T = unknown> = {
  output: T | null;
  cached: boolean;
  status: "pendente" | "processando" | "processado" | "erro" | "ignorado";
};

/** Hash determinístico e estável do insumo, usado como chave de cache. */
export async function hashInput(input: unknown): Promise<string> {
  const canonical = JSON.stringify(input, Object.keys(input as object).sort());
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Ponto de entrada único e futuro para qualquer tarefa de IA do produto.
 * Implementação prevista para a próxima etapa: consultar `ai_results` pelo
 * par (task_type, input_hash), reutilizar o resultado quando existir e apenas
 * então despachar o processamento para a server function correspondente.
 */
export async function runAiTask<T = unknown>(_task: AiTask): Promise<AiResult<T>> {
  throw new Error("Camada de IA ainda não implementada. Estrutura preparada para a próxima etapa.");
}
