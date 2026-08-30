/**
 * KNOWLEDGE INTEGRATION — Etapa 6, Fase 5
 *
 * Integra o registro de resposta de questão com o Knowledge Engine.
 * Atualiza mastery e confidence em user_topic_knowledge após cada tentativa.
 *
 * RESPONSABILIDADES:
 *   - Atualizar mastery/confidence no Knowledge Engine após resposta
 *   - Calcular ajustes baseados em dificuldade, acerto/erro, histórico
 *   - Registrar em knowledge_history para rastreabilidade
 *   - Prevenir duplicidade por attempt_id
 *   - Respeitar RLS e autenticação
 *
 * NÃO FAZ:
 *   - Criar tabelas novas (usa user_topic_knowledge + knowledge_history existentes)
 *   - Alterar Diagnosis Engine, Review Engine, Planner, Scheduler
 *   - Duplicar lógica de erros (fica em error-integration.ts)
 *   - Implementar UI
 *
 * QUERIES POR CHAMADA: máximo 5
 *   1. auth.getUser()
 *   2. user_topic_knowledge.select (estado atual)
 *   3. knowledge_history.select (verificar duplicidade por attempt_id)
 *   4. user_topic_knowledge.upsert (novo mastery/confidence)
 *   5. knowledge_history.insert (registro da atualização)
 *
 * SEGURANÇA:
 *   Todas as leituras/escritas usam o cliente Supabase do usuário logado.
 *   RLS por user_id é a fronteira de segurança.
 */

import { supabase } from "@/integrations/supabase/client";
import type { AttemptFeedback, Difficulty } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateKnowledgeFromAttemptInput = {
  /** ID da tentativa registrada em question_attempts */
  attemptId: string;
  /** Feedback computado pelo engine após a tentativa */
  feedback: AttemptFeedback;
};

export type UpdateKnowledgeFromAttemptResult = {
  /** Se o knowledge foi atualizado */
  updated: boolean;
  /** Novo mastery após atualização (null se não atualizou) */
  newMastery: number | null;
  /** Nova confidence após atualização (null se não atualizou) */
  newConfidence: number | null;
  /** Motivo pelo qual não atualizou (null se atualizou) */
  skipReason: string | null;
};

/**
 * Estado atual do knowledge para um tópico, vindo do banco.
 */
export type CurrentKnowledgeState = {
  mastery: number;
  confidence: number;
  totalQuestions: number;
  correctQuestions: number;
  reviewCount: number;
  lastStudiedAt: string | null;
};

/**
 * Resultado do cálculo puro de atualização do knowledge.
 */
export type KnowledgeUpdateResult = {
  newMastery: number;
  newConfidence: number;
  newTotalQuestions: number;
  newCorrectQuestions: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fator de aprendizagem base por dificuldade.
 * Questões mais difíceis têm maior impacto quando acertadas
 * e menor impacto negativo quando erradas (o erro é "esperado").
 */
const MASTERY_GAIN: Record<Difficulty, number> = {
  facil: 0.03,
  media: 0.05,
  dificil: 0.08,
};

const MASTERY_LOSS: Record<Difficulty, number> = {
  facil: 0.06, // errar fácil penaliza mais
  media: 0.04,
  dificil: 0.02, // errar difícil penaliza menos
};

const CONFIDENCE_GAIN: Record<Difficulty, number> = {
  facil: 0.02,
  media: 0.04,
  dificil: 0.06,
};

const CONFIDENCE_LOSS: Record<Difficulty, number> = {
  facil: 0.05,
  media: 0.04,
  dificil: 0.03,
};

/** Multiplicador para primeira tentativa (maior impacto). */
const FIRST_ATTEMPT_MULTIPLIER = 1.5;

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PURA: computeKnowledgeUpdate
// ─────────────────────────────────────────────────────────────────────────────

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Calcula o novo mastery e confidence a partir do estado atual e do feedback.
 *
 * Determinístico: mesmo input → mesmo output.
 * Sem I/O, sem Date.now(), sem Math.random().
 *
 * Regras:
 *   - Acerto: mastery sobe (ganho por dificuldade), confidence sobe
 *   - Erro: mastery desce (perda por dificuldade), confidence desce
 *   - Primeira tentativa tem multiplicador maior
 *   - Mastery e confidence sempre em [0, 1]
 *   - totalQuestions e correctQuestions são incrementados
 */
export function computeKnowledgeUpdate(
  current: CurrentKnowledgeState | null,
  feedback: Pick<AttemptFeedback, "isCorrect" | "knowledgeDifficulty" | "isFirstAttempt">,
): KnowledgeUpdateResult {
  const prev = current ?? {
    mastery: 0,
    confidence: 0,
    totalQuestions: 0,
    correctQuestions: 0,
    reviewCount: 0,
    lastStudiedAt: null,
  };

  const multiplier = feedback.isFirstAttempt ? FIRST_ATTEMPT_MULTIPLIER : 1.0;
  const difficulty = feedback.knowledgeDifficulty;

  let newMastery: number;
  let newConfidence: number;

  if (feedback.isCorrect) {
    newMastery = clamp01(prev.mastery + MASTERY_GAIN[difficulty] * multiplier);
    newConfidence = clamp01(prev.confidence + CONFIDENCE_GAIN[difficulty] * multiplier);
  } else {
    newMastery = clamp01(prev.mastery - MASTERY_LOSS[difficulty] * multiplier);
    newConfidence = clamp01(prev.confidence - CONFIDENCE_LOSS[difficulty] * multiplier);
  }

  return {
    newMastery,
    newConfidence,
    newTotalQuestions: prev.totalQuestions + 1,
    newCorrectQuestions: prev.correctQuestions + (feedback.isCorrect ? 1 : 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS INTERNOS (rows do banco)
// ─────────────────────────────────────────────────────────────────────────────

type KnowledgeRow = {
  topic_id: string;
  mastery: number | null;
  confidence: number | null;
  total_questions: number | null;
  correct_questions: number | null;
  review_count: number | null;
  last_studied_at: string | null;
};

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

function toCurrentKnowledgeState(row: KnowledgeRow): CurrentKnowledgeState {
  return {
    mastery: Number(row.mastery ?? 0),
    confidence: Number(row.confidence ?? 0),
    totalQuestions: row.total_questions ?? 0,
    correctQuestions: row.correct_questions ?? 0,
    reviewCount: row.review_count ?? 0,
    lastStudiedAt: row.last_studied_at ?? null,
  };
}

/**
 * Busca estado atual do knowledge para um tópico.
 */
async function fetchCurrentKnowledge(topicId: string): Promise<CurrentKnowledgeState | null> {
  const { data, error } = await supabase
    .from("user_topic_knowledge")
    .select(
      "topic_id, mastery, confidence, total_questions, correct_questions, review_count, last_studied_at",
    )
    .eq("topic_id", topicId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return toCurrentKnowledgeState(data as KnowledgeRow);
}

/**
 * Verifica se já existe um registro em knowledge_history para este attempt_id.
 * Previne duplicidade.
 */
async function hasExistingKnowledgeUpdate(attemptId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("knowledge_history")
    .select("id", { count: "exact", head: true })
    .eq("attempt_id", attemptId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// API PÚBLICA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atualiza o Knowledge Engine após uma tentativa de questão.
 *
 * Regras:
 *   - Só atualiza quando feedback.topicId !== null
 *   - Não atualiza se já existe knowledge_history para este attempt_id
 *   - Calcula novo mastery/confidence via computeKnowledgeUpdate() (puro)
 *   - Faz upsert em user_topic_knowledge
 *   - Registra em knowledge_history
 *
 * Fluxo:
 *   1. Validar pré-condições (puro, sem I/O)
 *   2. Autenticar usuário
 *   3. Buscar estado atual + verificar duplicidade (em paralelo)
 *   4. Calcular novo estado via computeKnowledgeUpdate() (puro)
 *   5. Upsert em user_topic_knowledge
 *   6. Inserir em knowledge_history
 *
 * Queries: máximo 5 (auth + knowledge select + history check + knowledge upsert + history insert)
 */
export async function updateKnowledgeFromAttempt(
  input: UpdateKnowledgeFromAttemptInput,
): Promise<UpdateKnowledgeFromAttemptResult> {
  const { attemptId, feedback } = input;

  // 1. Pré-condições (sem I/O)
  if (feedback.topicId === null) {
    return { updated: false, newMastery: null, newConfidence: null, skipReason: "topic_id_null" };
  }

  // 2. Autenticação
  const userId = await requireUser();

  // 3. Buscar estado atual + verificar duplicidade em paralelo
  const [currentKnowledge, alreadyUpdated] = await Promise.all([
    fetchCurrentKnowledge(feedback.topicId),
    hasExistingKnowledgeUpdate(attemptId),
  ]);

  if (alreadyUpdated) {
    return {
      updated: false,
      newMastery: null,
      newConfidence: null,
      skipReason: "duplicidade_attempt_id",
    };
  }

  // 4. Calcular novo estado (puro)
  const update = computeKnowledgeUpdate(currentKnowledge, feedback);

  // 5. Upsert em user_topic_knowledge
  const { error: upsertError } = await supabase.from("user_topic_knowledge").upsert(
    {
      user_id: userId,
      topic_id: feedback.topicId,
      mastery: update.newMastery,
      confidence: update.newConfidence,
      total_questions: update.newTotalQuestions,
      correct_questions: update.newCorrectQuestions,
      last_studied_at: feedback.timestamp,
    },
    { onConflict: "user_id,topic_id" },
  );

  if (upsertError) throw upsertError;

  // 6. Registrar em knowledge_history
  const { error: historyError } = await supabase.from("knowledge_history").insert({
    user_id: userId,
    topic_id: feedback.topicId,
    subject_id: feedback.subjectId,
    attempt_id: attemptId,
    mastery_before: currentKnowledge?.mastery ?? 0,
    mastery_after: update.newMastery,
    confidence: update.newConfidence,
    total_questions: update.newTotalQuestions,
    correct_questions: update.newCorrectQuestions,
    last_studied_at: feedback.timestamp,
    reason: `question_attempt:${feedback.knowledgeDifficulty}:${feedback.isCorrect ? "correct" : "wrong"}`,
  });

  if (historyError) throw historyError;

  return {
    updated: true,
    newMastery: update.newMastery,
    newConfidence: update.newConfidence,
    skipReason: null,
  };
}
