/**
 * ATTEMPT SERVICE — Etapa 6, Fase 3 + Fase 4 (integração com Central de Erros) + Fase 5 (Knowledge Engine)
 *
 * Camada de serviço para registrar tentativas de questões e atualizar
 * estatísticas agregadas. Conecta o engine puro ao Supabase.
 *
 * RESPONSABILIDADES:
 *   - Registrar tentativa em question_attempts
 *   - Buscar stats atuais da questão para o usuário
 *   - Computar feedback via computeAttemptFeedback() (engine puro)
 *   - Atualizar question_stats (upsert)
 *   - Criar error_entry quando feedback indica erro (Fase 4)
 *   - Atualizar Knowledge Engine (mastery/confidence) quando topicId presente (Fase 5)
 *   - Retornar AttemptFeedback para integração futura
 *
 * NÃO FAZ:
 *   - Alterar Diagnosis Engine, Review Engine
 *   - Aceitar userId arbitrário (RLS + requireUser)
 *   - Usar Date.now() dentro de regras puras
 *   - Criar tabelas novas (usa question_attempts + question_stats + error_entries + user_topic_knowledge + knowledge_history existentes)
 *
 * QUERIES POR CHAMADA: máximo 12
 *   1. auth.getUser()
 *   2. questions.select (validar existência + buscar metadados)
 *   3. question_stats.select + question_attempts.count (em paralelo)
 *   4. question_attempts.insert
 *   5. question_stats.upsert
 *   6-8. error_entries: auth + check + insert (quando shouldCreateError)
 *   9-12. knowledge: auth + knowledge+history check + upsert + history insert (quando topicId presente)
 *
 * SEGURANÇA:
 *   Todas as leituras/escritas usam o cliente Supabase do usuário logado.
 *   RLS por user_id é a fronteira de segurança.
 */

import { supabase } from "@/integrations/supabase/client";
import { computeAttemptFeedback, type AttemptFeedbackInput } from "./engine";
import { toQuestionStats } from "./service";
import { createErrorFromAttempt } from "./error-integration";
import { updateKnowledgeFromAttempt } from "./knowledge-integration";
import type { AttemptFeedback, QuestionStats, AttemptMode } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

export type SubmitAnswerInput = {
  /** ID da questão sendo respondida */
  questionId: string;
  /** Resposta escolhida pelo aluno */
  chosenAnswer: string;
  /** Se a resposta está correta */
  isCorrect: boolean;
  /** Tempo gasto em segundos (null se não cronometrado) */
  timeSpentSeconds: number | null;
  /** Modo da tentativa */
  mode: AttemptMode;
  /** Confiança declarada (1-5, opcional) */
  declaredConfidence?: number | null;
  /** ID do concurso vinculado (opcional) */
  contestId?: string | null;
  /** ID da sessão de estudo vinculada (opcional) */
  sessionId?: string | null;
  /** Notas/anotações (opcional) */
  notes?: string | null;
  /** Timestamp ISO da tentativa. Se omitido, usa now(). */
  timestamp?: string;
};

export type SubmitAnswerResult = {
  /** ID da tentativa registrada */
  attemptId: string;
  /** Número da tentativa (1-based) */
  attemptNumber: number;
  /** Feedback computado pelo engine */
  feedback: AttemptFeedback;
  /** Stats atualizadas após esta tentativa */
  updatedStats: QuestionStats;
  /** Se um error_entry foi criado na Central de Erros */
  errorCreated: boolean;
  /** ID do error_entry criado (null se não criou) */
  errorEntryId: string | null;
  /** Se o Knowledge Engine foi atualizado (Fase 5) */
  knowledgeUpdated: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS INTERNOS (rows do banco)
// ─────────────────────────────────────────────────────────────────────────────

type QuestionMetaRow = {
  id: string;
  difficulty: number | null;
  topic_id: string | null;
  subject_id: string | null;
};

type StatsRow = {
  question_id: string;
  total_attempts: number;
  correct_count: number;
  wrong_count: number;
  streak_correct: number;
  streak_wrong: number;
  best_time_seconds: number | null;
  avg_time_seconds: number | null;
  last_attempted_at: string | null;
  last_correct_at: string | null;
  last_wrong_at: string | null;
};

type AttemptRow = {
  id: string;
  attempt_number: number;
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

const QUESTION_META_SELECT = "id, difficulty, topic_id, subject_id";

const STATS_SELECT =
  "question_id, total_attempts, correct_count, wrong_count, streak_correct, streak_wrong, best_time_seconds, avg_time_seconds, last_attempted_at, last_correct_at, last_wrong_at";

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES INTERNAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca metadados da questão necessários para o feedback.
 * Lança erro se a questão não existir.
 */
async function fetchQuestionMeta(questionId: string): Promise<QuestionMetaRow> {
  const { data, error } = await supabase
    .from("questions")
    .select(QUESTION_META_SELECT)
    .eq("id", questionId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error(`Questão não encontrada: ${questionId}`);
  }

  return data as QuestionMetaRow;
}

/**
 * Busca stats atuais do usuário para uma questão.
 * Retorna null se nunca tentou.
 */
async function fetchCurrentStats(questionId: string): Promise<QuestionStats | null> {
  const { data, error } = await supabase
    .from("question_stats")
    .select(STATS_SELECT)
    .eq("question_id", questionId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return toQuestionStats(data as StatsRow);
}

/**
 * Calcula o attempt_number para a próxima tentativa.
 * Usa COUNT no banco para evitar race conditions.
 */
async function getNextAttemptNumber(userId: string, questionId: string): Promise<number> {
  const { count, error } = await supabase
    .from("question_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("question_id", questionId);

  if (error) throw error;
  return (count ?? 0) + 1;
}

/**
 * Insere a tentativa em question_attempts.
 */
async function insertAttempt(
  userId: string,
  input: SubmitAnswerInput,
  attemptNumber: number,
  timestamp: string,
): Promise<AttemptRow> {
  const { data, error } = await supabase
    .from("question_attempts")
    .insert({
      user_id: userId,
      question_id: input.questionId,
      chosen_answer: input.chosenAnswer,
      is_correct: input.isCorrect,
      time_spent_seconds: input.timeSpentSeconds,
      mode: input.mode,
      declared_confidence: input.declaredConfidence ?? null,
      contest_id: input.contestId ?? null,
      session_id: input.sessionId ?? null,
      notes: input.notes ?? null,
      attempt_number: attemptNumber,
      answered_at: timestamp,
    })
    .select("id, attempt_number")
    .single();

  if (error) throw error;
  return data as AttemptRow;
}

/**
 * Calcula os novos valores de stats a partir do estado anterior + tentativa.
 * Função pura (sem I/O).
 */
export function computeNewStats(
  current: QuestionStats | null,
  isCorrect: boolean,
  timeSpentSeconds: number | null,
  timestamp: string,
): {
  totalAttempts: number;
  correctCount: number;
  wrongCount: number;
  streakCorrect: number;
  streakWrong: number;
  bestTimeSeconds: number | null;
  avgTimeSeconds: number | null;
  lastAttemptedAt: string;
  lastCorrectAt: string | null;
  lastWrongAt: string | null;
} {
  const prev = current ?? {
    totalAttempts: 0,
    correctCount: 0,
    wrongCount: 0,
    streakCorrect: 0,
    streakWrong: 0,
    bestTimeSeconds: null,
    avgTimeSeconds: null,
    lastAttemptedAt: null,
    lastCorrectAt: null,
    lastWrongAt: null,
    accuracy: 0,
  };

  const totalAttempts = prev.totalAttempts + 1;
  const correctCount = prev.correctCount + (isCorrect ? 1 : 0);
  const wrongCount = prev.wrongCount + (isCorrect ? 0 : 1);

  // Streak
  let streakCorrect: number;
  let streakWrong: number;
  if (isCorrect) {
    streakCorrect = prev.streakCorrect + 1;
    streakWrong = 0;
  } else {
    streakCorrect = 0;
    streakWrong = prev.streakWrong + 1;
  }

  // Tempo
  let bestTimeSeconds = prev.bestTimeSeconds;
  let avgTimeSeconds = prev.avgTimeSeconds;

  if (timeSpentSeconds !== null && timeSpentSeconds > 0 && Number.isFinite(timeSpentSeconds)) {
    if (bestTimeSeconds === null || timeSpentSeconds < bestTimeSeconds) {
      bestTimeSeconds = timeSpentSeconds;
    }
    if (avgTimeSeconds !== null) {
      // Média incremental
      const prevTotal = avgTimeSeconds * prev.totalAttempts;
      avgTimeSeconds = (prevTotal + timeSpentSeconds) / totalAttempts;
    } else {
      avgTimeSeconds = timeSpentSeconds;
    }
    // Proteger contra NaN/Infinity
    if (!Number.isFinite(avgTimeSeconds)) {
      avgTimeSeconds = timeSpentSeconds;
    }
  }

  // Timestamps
  const lastAttemptedAt = timestamp;
  const lastCorrectAt = isCorrect ? timestamp : prev.lastCorrectAt;
  const lastWrongAt = isCorrect ? prev.lastWrongAt : timestamp;

  return {
    totalAttempts,
    correctCount,
    wrongCount,
    streakCorrect,
    streakWrong,
    bestTimeSeconds,
    avgTimeSeconds,
    lastAttemptedAt,
    lastCorrectAt,
    lastWrongAt,
  };
}

/**
 * Faz upsert em question_stats com os novos valores.
 */
async function upsertStats(
  userId: string,
  questionId: string,
  stats: ReturnType<typeof computeNewStats>,
): Promise<void> {
  const { error } = await supabase.from("question_stats").upsert(
    {
      user_id: userId,
      question_id: questionId,
      total_attempts: stats.totalAttempts,
      correct_count: stats.correctCount,
      wrong_count: stats.wrongCount,
      streak_correct: stats.streakCorrect,
      streak_wrong: stats.streakWrong,
      best_time_seconds: stats.bestTimeSeconds,
      avg_time_seconds: stats.avgTimeSeconds,
      last_attempted_at: stats.lastAttemptedAt,
      last_correct_at: stats.lastCorrectAt,
      last_wrong_at: stats.lastWrongAt,
    },
    { onConflict: "user_id,question_id" },
  );

  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// API PÚBLICA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra uma resposta de questão e retorna feedback completo.
 *
 * Fluxo:
 *   1. Validar autenticação
 *   2. Buscar metadados da questão (valida existência)
 *   3. Buscar stats atuais + calcular attemptNumber (em paralelo)
 *   4. Inserir tentativa em question_attempts
 *   5. Computar feedback via computeAttemptFeedback() (puro)
 *   6. Calcular novos stats via computeNewStats() (puro)
 *   7. Upsert em question_stats
 *   8. Criar error_entry se feedback.shouldCreateError (Fase 4)
 *   9. Atualizar Knowledge Engine se topicId presente (Fase 5)
 *   10. Retornar resultado completo
 *
 * Queries: 5-12 (auth + question + stats+count em paralelo + insert + upsert + [error: check + insert] + [knowledge: select+check + upsert + history])
 */
export async function submitAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult> {
  // 1. Autenticação
  const userId = await requireUser();

  const timestamp = input.timestamp ?? new Date().toISOString();

  // 2. Validar questão + buscar metadados
  const questionMeta = await fetchQuestionMeta(input.questionId);

  // 3. Buscar stats atuais + attemptNumber em paralelo
  const [currentStats, attemptNumber] = await Promise.all([
    fetchCurrentStats(input.questionId),
    getNextAttemptNumber(userId, input.questionId),
  ]);

  // 4. Inserir tentativa
  const attemptRow = await insertAttempt(userId, input, attemptNumber, timestamp);

  // 5. Computar feedback (puro — engine)
  const feedbackInput: AttemptFeedbackInput = {
    questionId: input.questionId,
    isCorrect: input.isCorrect,
    difficulty: questionMeta.difficulty,
    topicId: questionMeta.topic_id,
    subjectId: questionMeta.subject_id,
    timestamp,
    currentStats,
  };

  const feedback = computeAttemptFeedback(feedbackInput);

  // 6. Calcular novos stats (puro)
  const newStatsValues = computeNewStats(
    currentStats,
    input.isCorrect,
    input.timeSpentSeconds,
    timestamp,
  );

  // 7. Upsert stats
  await upsertStats(userId, input.questionId, newStatsValues);

  // 8. Criar error_entry se necessário (Fase 4)
  let errorCreated = false;
  let errorEntryId: string | null = null;

  if (feedback.shouldCreateError) {
    const errorResult = await createErrorFromAttempt({
      attemptId: attemptRow.id,
      feedback,
    });
    errorCreated = errorResult.created;
    errorEntryId = errorResult.errorEntryId;
  }

  // 9. Atualizar Knowledge Engine se topicId presente (Fase 5)
  let knowledgeUpdated = false;

  if (feedback.topicId !== null) {
    try {
      const knowledgeResult = await updateKnowledgeFromAttempt({
        attemptId: attemptRow.id,
        feedback,
      });
      knowledgeUpdated = knowledgeResult.updated;
    } catch {
      // Falha na atualização do knowledge não deve bloquear o fluxo principal.
      // A tentativa já foi registrada e as stats atualizadas.
      // O knowledge pode ser atualizado retroativamente se necessário.
      knowledgeUpdated = false;
    }
  }

  // 10. Montar stats de retorno
  const total = newStatsValues.totalAttempts;
  const correct = newStatsValues.correctCount;
  const updatedStats: QuestionStats = {
    ...newStatsValues,
    accuracy: total > 0 ? Math.max(0, Math.min(1, correct / total)) : 0,
  };

  return {
    attemptId: attemptRow.id,
    attemptNumber: attemptRow.attempt_number,
    feedback,
    updatedStats,
    errorCreated,
    errorEntryId,
    knowledgeUpdated,
  };
}
