/**
 * ERROR INTEGRATION — Etapa 6, Fase 4
 *
 * Integra o registro de resposta de questão com a Central de Erros existente.
 * Cria error_entry na tabela existente quando AttemptFeedback.shouldCreateError === true.
 *
 * RESPONSABILIDADES:
 *   - Criar error_entry após resposta incorreta com tópico associado
 *   - Mapear suggestedErrorCategory para o enum error_category do banco
 *   - Vincular corretamente attempt_id, question_id, topic_id, subject_id
 *   - Prevenir duplicidade por attempt_id
 *   - Respeitar RLS e autenticação
 *
 * NÃO FAZ:
 *   - Criar tabelas novas ou sistema paralelo de erros
 *   - Duplicar analyzeTopicErrors()
 *   - Alterar Knowledge Engine, Diagnosis Engine, Review Engine, Unified Scheduler
 *   - Criar error_entry para respostas corretas
 *   - Criar múltiplos error_entries para uma mesma tentativa
 *   - Implementar UI
 *
 * QUERIES POR CHAMADA: máximo 3
 *   1. auth.getUser()
 *   2. error_entries.select (verificar duplicidade por attempt_id)
 *   3. error_entries.insert
 *
 * SEGURANÇA:
 *   Todas as leituras/escritas usam o cliente Supabase do usuário logado.
 *   RLS por user_id é a fronteira de segurança.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { AttemptFeedback } from "./types";

type ErrorCategory = Database["public"]["Enums"]["error_category"];

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

export type CreateErrorFromAttemptInput = {
  /** ID da tentativa registrada em question_attempts */
  attemptId: string;
  /** Feedback computado pelo engine após a tentativa */
  feedback: AttemptFeedback;
};

export type CreateErrorFromAttemptResult = {
  /** Se um error_entry foi criado */
  created: boolean;
  /** ID do error_entry criado (null se não criou) */
  errorEntryId: string | null;
  /** Motivo pelo qual não criou (null se criou) */
  skipReason: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORIAS VÁLIDAS DO BANCO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Categorias válidas do enum error_category no banco.
 * Espelha exatamente o CREATE TYPE public.error_category da migration.
 */
const VALID_ERROR_CATEGORIES: Set<string> = new Set<ErrorCategory>([
  "conhecimento",
  "esquecimento",
  "interpretacao",
  "calculo",
  "atencao",
  "estrategia",
  "velocidade",
  "outros",
]);

const DEFAULT_ERROR_CATEGORY: ErrorCategory = "outros";

/**
 * Mapeia a suggestedErrorCategory do engine para uma categoria válida do banco.
 * Se a sugestão não é válida ou é null, retorna o fallback 'outros'.
 *
 * Função pura.
 */
export function mapToErrorCategory(suggested: string | null): ErrorCategory {
  if (suggested === null) return DEFAULT_ERROR_CATEGORY;
  if (VALID_ERROR_CATEGORIES.has(suggested)) return suggested as ErrorCategory;
  return DEFAULT_ERROR_CATEGORY;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function requireUser(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Usuário não autenticado.");
  }
  return data.user.id;
}

/**
 * Verifica se já existe um error_entry para o attempt_id dado.
 * Previne duplicidade.
 */
async function hasExistingError(attemptId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("error_entries")
    .select("id", { count: "exact", head: true })
    .eq("attempt_id", attemptId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// API PÚBLICA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria um error_entry na Central de Erros a partir do feedback de uma tentativa.
 *
 * Regras:
 *   - Só cria quando feedback.shouldCreateError === true
 *   - Só cria quando feedback.isCorrect === false
 *   - Só cria quando feedback.topicId !== null
 *   - Não cria se já existe error_entry com o mesmo attempt_id
 *   - Mapeia suggestedErrorCategory para enum válido do banco
 *
 * Fluxo:
 *   1. Validar pré-condições (puro, sem I/O)
 *   2. Autenticar usuário
 *   3. Verificar duplicidade por attempt_id
 *   4. Inserir error_entry
 *
 * Queries: máximo 3 (auth + check + insert)
 */
export async function createErrorFromAttempt(
  input: CreateErrorFromAttemptInput,
): Promise<CreateErrorFromAttemptResult> {
  const { attemptId, feedback } = input;

  // 1. Pré-condições (sem I/O)
  if (feedback.isCorrect) {
    return { created: false, errorEntryId: null, skipReason: "resposta_correta" };
  }

  if (!feedback.shouldCreateError) {
    return { created: false, errorEntryId: null, skipReason: "shouldCreateError_false" };
  }

  if (feedback.topicId === null) {
    return { created: false, errorEntryId: null, skipReason: "topic_id_null" };
  }

  // 2. Autenticação
  const userId = await requireUser();

  // 3. Verificar duplicidade
  const alreadyExists = await hasExistingError(attemptId);
  if (alreadyExists) {
    return { created: false, errorEntryId: null, skipReason: "duplicidade_attempt_id" };
  }

  // 4. Mapear categoria
  const category = mapToErrorCategory(feedback.suggestedErrorCategory);

  // 5. Inserir error_entry
  const { data, error } = await supabase
    .from("error_entries")
    .insert({
      user_id: userId,
      attempt_id: attemptId,
      question_id: feedback.questionId,
      topic_id: feedback.topicId,
      subject_id: feedback.subjectId,
      category,
      is_resolved: false,
      occurred_at: feedback.timestamp,
    })
    .select("id")
    .single();

  if (error) throw error;

  return {
    created: true,
    errorEntryId: data.id as string,
    skipReason: null,
  };
}
