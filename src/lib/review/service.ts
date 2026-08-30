/**
 * REVIEW SERVICE — Etapa 4, Fase 3
 *
 * Camada de orquestração entre:
 *   Supabase → Knowledge/Errors/Diagnosis → Review Engine → Review Decision
 *
 * RESPONSABILIDADES:
 *   - Buscar dados reais do usuário autenticado
 *   - Transformar usando motores existentes (analyzeTopicErrors, buildSignals, diagnoseTopic)
 *   - Chamar computeReviewDecision() para decisão temporal
 *   - Registrar eventos de revisão e agendar próxima revisão
 *
 * NÃO FAZ:
 *   - Recalcular mastery (responsabilidade do Knowledge Engine)
 *   - Duplicar regras de diagnóstico
 *   - Alterar o Planner
 *   - Usar service role ou aceitar userId arbitrário
 *
 * ATOMICIDADE:
 *   recordReviewEvent executa INSERT + UPDATE sequencialmente.
 *   O cliente Supabase não oferece transações atômicas nativas para
 *   operações em tabelas diferentes. Uma RPC transacional será
 *   necessária em fase posterior para garantir atomicidade completa.
 */

import { supabase } from "@/integrations/supabase/client";
import { analyzeTopicErrors, type ErrorRecord } from "@/lib/knowledge/errors";
import { buildSignals } from "@/lib/knowledge/signals";
import { diagnoseTopic } from "@/lib/diagnosis/engine";
import { computeReviewDecision } from "./engine";
import type { TopicReviewInput, TopicReviewDecision } from "./types";
import type { KnowledgeState } from "@/lib/knowledge/engine";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS INTERNOS
// ─────────────────────────────────────────────────────────────────────────────

type KnowledgeRow = {
  topic_id: string;
  mastery: number | null;
  confidence: number | null;
  total_questions: number | null;
  correct_questions: number | null;
  last_studied_at: string | null;
  review_count: number | null;
  last_review_at: string | null;
  last_review_result: string | null;
};

type ErrorRow = {
  id: string;
  user_id: string;
  topic_id: string | null;
  subject_id: string | null;
  category: string | null;
  is_resolved: boolean;
  resolved_at: string | null;
  occurred_at: string;
  attempt_id: string | null;
  question_id: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSORES
// ─────────────────────────────────────────────────────────────────────────────

function toKnowledgeState(row: KnowledgeRow): KnowledgeState {
  return {
    mastery: Number(row.mastery ?? 0),
    confidence: Number(row.confidence ?? 0),
    totalQuestions: row.total_questions ?? 0,
    correctQuestions: row.correct_questions ?? 0,
    lastStudiedAt: row.last_studied_at ?? null,
  };
}

function toErrorRecord(row: ErrorRow): ErrorRecord {
  return {
    id: row.id,
    userId: row.user_id,
    topicId: row.topic_id,
    subjectId: row.subject_id,
    category: row.category,
    isResolved: row.is_resolved,
    resolvedAt: row.resolved_at,
    occurredAt: row.occurred_at,
    attemptId: row.attempt_id,
    questionId: row.question_id,
  };
}

/** Garante valor finito, sem NaN/Infinity. */
function safeNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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
 * Constrói um TopicReviewInput a partir dos dados brutos,
 * usando exclusivamente os motores existentes.
 */
function buildReviewInput(
  topicId: string,
  kRow: KnowledgeRow,
  errors: ErrorRecord[],
  referenceDate: string,
): TopicReviewInput {
  const knowledge = toKnowledgeState(kRow);
  const errorAnalysis = analyzeTopicErrors(errors, topicId, referenceDate);
  const reviewCount = Math.max(0, safeNum(kRow.review_count, 0));
  const signals = buildSignals(knowledge, errorAnalysis, reviewCount, referenceDate);
  const diagnosis = diagnoseTopic(signals, referenceDate);

  const totalQ = knowledge.totalQuestions;
  const accuracy = totalQ > 0 ? knowledge.correctQuestions / totalQ : 0;

  // lastReviewResult: mapear string do banco para tipo esperado
  let lastReviewResult: TopicReviewInput["lastReviewResult"] = null;
  const rawResult = kRow.last_review_result;
  if (rawResult === "success" || rawResult === "partial" || rawResult === "fail") {
    lastReviewResult = rawResult;
  }

  return {
    topicId,
    mastery: safeNum(diagnosis.mastery, 0),
    confidence: safeNum(diagnosis.confidence, 0),
    accuracy: safeNum(accuracy, 0),
    knowledgeState: diagnosis.knowledgeState,
    interventionScore: safeNum(diagnosis.interventionScore, 0),
    daysSinceStudy: signals.daysSinceStudy,
    unresolvedErrors: safeNum(signals.unresolvedErrors, 0),
    recurringErrors: safeNum(signals.recurringErrors, 0),
    lastReviewDate: kRow.last_review_at ?? null,
    reviewCount,
    lastReviewResult,
    referenceDate,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. getTopicReviewDecision
// ─────────────────────────────────────────────────────────────────────────────

export type TopicReviewDecisionResult = TopicReviewDecision & {
  topicId: string;
  input: TopicReviewInput;
};

/**
 * Calcula a decisão de revisão para um tópico específico do usuário autenticado.
 *
 * Queries: 2 (user_topic_knowledge + error_entries), em paralelo.
 *
 * Retorna null se o tópico não possuir user_topic_knowledge
 * (sem inventar dados).
 */
export async function getTopicReviewDecision(
  topicId: string,
  referenceDate?: string,
): Promise<TopicReviewDecisionResult | null> {
  await requireUser();

  const refDate = referenceDate ?? new Date().toISOString().slice(0, 10);

  // 2 queries em paralelo
  const [knowledgeResult, errorsResult] = await Promise.all([
    supabase
      .from("user_topic_knowledge")
      .select(
        "topic_id, mastery, confidence, total_questions, correct_questions, last_studied_at, review_count, last_review_at, last_review_result",
      )
      .eq("topic_id", topicId)
      .maybeSingle(),
    supabase
      .from("error_entries")
      .select(
        "id, user_id, topic_id, subject_id, category, is_resolved, resolved_at, occurred_at, attempt_id, question_id",
      )
      .eq("topic_id", topicId),
  ]);

  if (knowledgeResult.error) throw knowledgeResult.error;
  if (errorsResult.error) throw errorsResult.error;

  const kRow = knowledgeResult.data as KnowledgeRow | null;
  if (!kRow) return null;

  const errorRecords = (errorsResult.data ?? []).map(toErrorRecord);
  const input = buildReviewInput(topicId, kRow, errorRecords, refDate);
  const decision = computeReviewDecision(input);

  return {
    ...decision,
    topicId,
    input,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. getUserReviewQueue
// ─────────────────────────────────────────────────────────────────────────────

export type ReviewQueueItem = TopicReviewDecisionResult;

/**
 * Retorna a fila de revisão do usuário autenticado.
 *
 * Queries: 2 (user_topic_knowledge em lote + error_entries em lote).
 * Processamento: O(N) em memória, sem N+1.
 *
 * Retorna somente tópicos com needsReview === true,
 * ordenados por reviewUrgency decrescente.
 */
export async function getUserReviewQueue(referenceDate?: string): Promise<ReviewQueueItem[]> {
  await requireUser();

  const refDate = referenceDate ?? new Date().toISOString().slice(0, 10);

  // 2 queries em lote — sem N+1
  const [knowledgeResult, errorsResult] = await Promise.all([
    supabase
      .from("user_topic_knowledge")
      .select(
        "topic_id, mastery, confidence, total_questions, correct_questions, last_studied_at, review_count, last_review_at, last_review_result",
      ),
    supabase
      .from("error_entries")
      .select(
        "id, user_id, topic_id, subject_id, category, is_resolved, resolved_at, occurred_at, attempt_id, question_id",
      ),
  ]);

  if (knowledgeResult.error) throw knowledgeResult.error;
  if (errorsResult.error) throw errorsResult.error;

  const knowledgeRows = (knowledgeResult.data ?? []) as KnowledgeRow[];
  const allErrors = (errorsResult.data ?? []).map(toErrorRecord);

  // Agrupar erros por topic_id em memória
  const errorsByTopic = new Map<string, ErrorRecord[]>();
  for (const e of allErrors) {
    if (!e.topicId) continue;
    const list = errorsByTopic.get(e.topicId) ?? [];
    list.push(e);
    errorsByTopic.set(e.topicId, list);
  }

  // Processar tudo em memória
  const queue: ReviewQueueItem[] = [];

  for (const kRow of knowledgeRows) {
    const topicErrors = errorsByTopic.get(kRow.topic_id) ?? [];
    const input = buildReviewInput(kRow.topic_id, kRow, topicErrors, refDate);
    const decision = computeReviewDecision(input);

    if (decision.needsReview) {
      queue.push({
        ...decision,
        topicId: kRow.topic_id,
        input,
      });
    }
  }

  // Ordenar por urgência decrescente
  queue.sort((a, b) => b.reviewUrgency - a.reviewUrgency);

  return queue;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. recordReviewEvent
// ─────────────────────────────────────────────────────────────────────────────

export type RecordReviewInput = {
  topicId: string;
  subjectId?: string | null;
  result: "success" | "partial" | "fail";
  reviewType: "manutencao" | "consolidacao" | "recuperacao" | "erro_direcionado";
  reviewIntensity: "leve" | "moderada" | "intensiva";
  intervalDays: number;
  masteryAtReview: number;
  confidenceAtReview: number;
  sessionId?: string | null;
  taskId?: string | null;
  notes?: string | null;
  reviewedAt?: string | null;
};

export type RecordReviewResult = {
  reviewEventId: string;
  nextReviewAt: string;
  reviewCount: number;
};

/**
 * Registra um evento de revisão e agenda a próxima revisão.
 *
 * Fluxo:
 *   1. Identifica usuário autenticado
 *   2. Busca user_topic_knowledge atual para construir TopicReviewInput
 *   3. Calcula next_review_at usando computeReviewDecision() (engine oficial)
 *   4. Insere review_events
 *   5. Atualiza user_topic_knowledge:
 *      - review_count = review_count + 1
 *      - last_review_at
 *      - last_review_result
 *      - next_review_at
 *
 * NÃO altera mastery. O Review Service registra o evento e agenda a
 * próxima revisão. A evolução do conhecimento pertence ao Knowledge Engine.
 *
 * ATOMICIDADE: INSERT + UPDATE executados sequencialmente.
 * O cliente Supabase não oferece transações nativas para operações em
 * tabelas diferentes. Se a segunda operação falhar, o review_event
 * já terá sido inserido. Uma RPC transacional será necessária em
 * fase posterior para garantir atomicidade completa.
 *
 * Queries: 3 (select knowledge + insert review_event + update knowledge)
 */
export async function recordReviewEvent(input: RecordReviewInput): Promise<RecordReviewResult> {
  const userId = await requireUser();

  const reviewedAt = input.reviewedAt ?? new Date().toISOString();
  const reviewDate = reviewedAt.slice(0, 10);

  // 1. Buscar estado atual para calcular next_review_at via engine
  const { data: kData, error: kError } = await supabase
    .from("user_topic_knowledge")
    .select(
      "topic_id, mastery, confidence, total_questions, correct_questions, last_studied_at, review_count, last_review_at, last_review_result",
    )
    .eq("topic_id", input.topicId)
    .maybeSingle();

  if (kError) throw kError;

  // Se não existe user_topic_knowledge, criar com valores mínimos
  const currentReviewCount = safeNum(kData?.review_count, 0);
  const newReviewCount = currentReviewCount + 1;

  // Construir input para o engine calcular a próxima revisão
  // considerando que ESTA revisão acabou de acontecer
  const reviewInput: TopicReviewInput = {
    topicId: input.topicId,
    mastery: safeNum(input.masteryAtReview, 0),
    confidence: safeNum(input.confidenceAtReview, 0),
    accuracy: kData
      ? (kData.total_questions ?? 0) > 0
        ? safeNum(kData.correct_questions, 0) / (kData.total_questions ?? 1)
        : 0
      : 0,
    knowledgeState: null, // Será recalculado se temos kData
    interventionScore: 0,
    daysSinceStudy: 0, // Acabou de revisar
    unresolvedErrors: 0,
    recurringErrors: 0,
    lastReviewDate: reviewDate,
    reviewCount: newReviewCount,
    lastReviewResult: input.result,
    referenceDate: reviewDate,
  };

  // Se temos dados de knowledge, usar o diagnóstico real
  if (kData) {
    const kRow = kData as KnowledgeRow;
    // Buscar erros para diagnóstico completo
    const { data: errorData } = await supabase
      .from("error_entries")
      .select(
        "id, user_id, topic_id, subject_id, category, is_resolved, resolved_at, occurred_at, attempt_id, question_id",
      )
      .eq("topic_id", input.topicId);

    const errorRecords = (errorData ?? []).map(toErrorRecord);
    const fullInput = buildReviewInput(input.topicId, kRow, errorRecords, reviewDate);

    // Sobrescrever com dados desta revisão
    reviewInput.knowledgeState = fullInput.knowledgeState;
    reviewInput.interventionScore = fullInput.interventionScore;
    reviewInput.unresolvedErrors = fullInput.unresolvedErrors;
    reviewInput.recurringErrors = fullInput.recurringErrors;
    reviewInput.accuracy = fullInput.accuracy;
    // Manter lastReviewDate = reviewDate (esta revisão)
    // Manter lastReviewResult = input.result (resultado desta revisão)
    // Manter reviewCount = newReviewCount (incluindo esta)
  }

  // Calcular próxima revisão via engine oficial
  const decision = computeReviewDecision(reviewInput);
  const nextReviewAt = decision.suggestedReviewDate;

  // 2. Inserir review_event
  // Nomes de coluna conforme o schema real:
  //   review_type_cat / intensity (evitam colisão com os enums homônimos)
  //   scheduled_for / completed_at (colunas temporais SRS já existentes)
  const { data: eventData, error: eventError } = await supabase
    .from("review_events")
    .insert({
      user_id: userId,
      content_type: "topico",
      topic_id: input.topicId,
      subject_id: input.subjectId ?? null,
      review_type_cat: input.reviewType,
      intensity: input.reviewIntensity,
      result: input.result,
      interval_days: input.intervalDays,
      mastery_at_review: safeNum(input.masteryAtReview, 0),
      confidence_at_review: safeNum(input.confidenceAtReview, 0),
      next_review_date: nextReviewAt,
      session_id: input.sessionId ?? null,
      task_id: input.taskId ?? null,
      notes: input.notes ?? null,
      scheduled_for: reviewDate,
      completed_at: reviewedAt,
    })
    .select("id")
    .single();

  if (eventError) throw eventError;

  // 3. Atualizar user_topic_knowledge
  // NÃO altera mastery — responsabilidade do Knowledge Engine
  if (kData) {
    const { error: updateError } = await supabase
      .from("user_topic_knowledge")
      .update({
        review_count: newReviewCount,
        last_review_at: reviewDate,
        last_review_result: input.result,
        next_review_at: nextReviewAt,
      })

      .eq("topic_id", input.topicId)
      .eq("user_id", userId);

    if (updateError) throw updateError;
  } else {
    // Não existe user_topic_knowledge — não criar artificialmente.
    // O Knowledge Engine é responsável por criar este registro.
    // Apenas o review_event foi registrado.
  }

  return {
    reviewEventId: eventData.id,
    nextReviewAt,
    reviewCount: newReviewCount,
  };
}
