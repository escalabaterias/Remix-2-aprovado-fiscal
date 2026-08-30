/**
 * Serviço de processamento de tentativas — Etapa 3.1
 *
 * Orquestra o ciclo completo:
 * tentativa → resultado → atualização do domínio → erro (se aplicável)
 * → snapshot histórico → estado atual atualizado
 *
 * Usa a RPC process_attempt_knowledge para garantir atomicidade no banco.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type ErrorCategory = Database["public"]["Enums"]["error_category"];

import {
  updateKnowledge,
  INITIAL_STATE,
  type KnowledgeState,
  type AttemptInput,
  type Difficulty,
} from "./engine";

export type ProcessAttemptInput = {
  attemptId: string;
  topicId: string;
  subjectId: string;
  contestId: string | null;
  sessionId: string | null;
  isCorrect: boolean;
  difficulty: Difficulty;
  errorCategory: string | null;
  questionId: string | null;
  rootTopicId: string | null;
};

export type ProcessAttemptResult = {
  status: "processed" | "already_processed";
  historyId: string | null;
  errorId: string | null;
  masteryBefore: number;
  masteryAfter: number;
  confidence: number;
};

/**
 * Busca o estado atual de conhecimento de um tópico.
 */
export async function fetchCurrentKnowledge(topicId: string): Promise<KnowledgeState> {
  const { data, error } = await supabase
    .from("user_topic_knowledge")
    .select("mastery, confidence, total_questions, correct_questions, last_studied_at")
    .eq("topic_id", topicId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ...INITIAL_STATE };

  return {
    mastery: Number(data.mastery ?? 0),
    confidence: Number(data.confidence ?? 0),
    totalQuestions: data.total_questions ?? 0,
    correctQuestions: data.correct_questions ?? 0,
    lastStudiedAt: data.last_studied_at ?? null,
  };
}

/**
 * Processa uma tentativa de questão, atualizando domínio, histórico e erros.
 *
 * Idempotente: se a mesma tentativa (attemptId) já foi processada, retorna
 * sem duplicar.
 *
 * Usa RPC para atomicidade.
 */
export async function processAttempt(input: ProcessAttemptInput): Promise<ProcessAttemptResult> {
  // 1. Buscar estado atual
  const currentState = await fetchCurrentKnowledge(input.topicId);

  // 2. Calcular novo estado (determinístico)
  const attempt: AttemptInput = {
    isCorrect: input.isCorrect,
    difficulty: input.difficulty,
    errorCategory: input.errorCategory,
    attemptId: input.attemptId,
    timestamp: new Date().toISOString(),
  };

  const update = updateKnowledge(currentState, attempt);

  // 3. Chamar RPC para persistência atômica
  // Os parâmetros opcionais aceitam NULL no banco, mas os tipos gerados os
  // declaram como obrigatórios (não têm DEFAULT por serem posicionais).
  const rpcArgs = {
    p_user_id: (await supabase.auth.getUser()).data.user!.id,
    p_topic_id: input.topicId,
    p_subject_id: input.subjectId,
    p_contest_id: input.contestId,
    p_attempt_id: input.attemptId,
    p_session_id: input.sessionId,
    p_mastery_before: update.masteryBefore,
    p_mastery_after: update.masteryAfter,
    p_confidence: update.confidence,
    p_total_questions: update.newState.totalQuestions,
    p_correct_questions: update.newState.correctQuestions,
    p_review_count: 0,
    p_last_studied_at: update.newState.lastStudiedAt,
    p_reason: update.reason,
    p_error_category: input.isCorrect ? null : (input.errorCategory as ErrorCategory | null),
    p_error_question_id: input.isCorrect ? null : input.questionId,
    p_error_root_topic_id: input.isCorrect ? null : input.rootTopicId,
  } as unknown as Database["public"]["Functions"]["process_attempt_knowledge"]["Args"];

  const { data, error } = await supabase.rpc("process_attempt_knowledge", rpcArgs);

  if (error) throw error;

  const result = data as {
    status: string;
    history_id: string | null;
    error_id?: string | null;
  } | null;

  return {
    status: result?.status === "already_processed" ? "already_processed" : "processed",
    historyId: result?.history_id ?? null,
    errorId: result?.error_id ?? null,
    masteryBefore: update.masteryBefore,
    masteryAfter: update.masteryAfter,
    confidence: update.confidence,
  };
}

/**
 * Marca um erro como resolvido.
 */
export async function resolveError(errorId: string): Promise<void> {
  const { error } = await supabase
    .from("error_entries")
    .update({
      is_resolved: true,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", errorId);

  if (error) throw error;
}
