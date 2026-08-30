/**
 * Serviço de diagnóstico — Etapa 3.2
 *
 * Responsável por:
 * - Buscar sinais do Supabase (knowledge, errors)
 * - Executar o diagnosis engine (função pura)
 * - Devolver o diagnóstico estruturado
 *
 * O service PODE acessar Supabase. O engine NÃO.
 *
 * Performance: carregamento em lote para evitar N+1.
 */

import { supabase } from "@/integrations/supabase/client";
import { buildSignals, type PlannerSignals } from "@/lib/knowledge/signals";
import { analyzeTopicErrors, type ErrorRecord } from "@/lib/knowledge/errors";
import { diagnoseTopic, type TopicDiagnosis } from "./engine";
import type { KnowledgeState } from "@/lib/knowledge/engine";

export type DiagnosisWithMeta = TopicDiagnosis & {
  topicId: string;
  topicName: string;
  subjectId: string;
  subjectName: string;
};

type KnowledgeRow = {
  topic_id: string;
  mastery: number | null;
  confidence: number | null;
  total_questions: number | null;
  correct_questions: number | null;
  last_studied_at: string | null;
  review_count: number | null;
  topics: {
    name: string;
    subject_id: string | null;
    subjects: { name: string } | null;
  } | null;
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

/**
 * Diagnóstico de um tópico específico.
 * 3 queries paralelas: knowledge, errors, (review_count já em knowledge).
 */
export async function getTopicDiagnosis(topicId: string): Promise<DiagnosisWithMeta | null> {
  const referenceDate = new Date().toISOString();

  const [knowledgeResult, errorsResult] = await Promise.all([
    supabase
      .from("user_topic_knowledge")
      .select(
        "topic_id, mastery, confidence, total_questions, correct_questions, last_studied_at, review_count, topics(name, subject_id, subjects(name))",
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
  const errorAnalysis = analyzeTopicErrors(errorRecords, topicId, referenceDate);
  const knowledge = toKnowledgeState(kRow);
  const signals = buildSignals(knowledge, errorAnalysis, kRow.review_count ?? 0, referenceDate);
  const diagnosis = diagnoseTopic(signals, referenceDate);

  return {
    ...diagnosis,
    topicId: kRow.topic_id,
    topicName: kRow.topics?.name ?? "Sem nome",
    subjectId: kRow.topics?.subject_id ?? "",
    subjectName: kRow.topics?.subjects?.name ?? "Sem matéria",
  };
}

/**
 * Diagnóstico de TODOS os tópicos do usuário autenticado.
 * 2 queries em lote (knowledge + errors) — sem N+1.
 */
export async function getUserDiagnoses(): Promise<DiagnosisWithMeta[]> {
  const referenceDate = new Date().toISOString();

  const [knowledgeResult, errorsResult] = await Promise.all([
    supabase
      .from("user_topic_knowledge")
      .select(
        "topic_id, mastery, confidence, total_questions, correct_questions, last_studied_at, review_count, topics(name, subject_id, subjects(name))",
      )
      .order("mastery", { ascending: true }),
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

  // Agrupar erros por tópico para evitar filtro repetido
  const errorsByTopic = new Map<string, ErrorRecord[]>();
  for (const e of allErrors) {
    if (!e.topicId) continue;
    const list = errorsByTopic.get(e.topicId) ?? [];
    list.push(e);
    errorsByTopic.set(e.topicId, list);
  }

  const results: DiagnosisWithMeta[] = [];

  for (const kRow of knowledgeRows) {
    const topicErrors = errorsByTopic.get(kRow.topic_id) ?? [];
    const errorAnalysis = analyzeTopicErrors(topicErrors, kRow.topic_id, referenceDate);
    const knowledge = toKnowledgeState(kRow);
    const signals = buildSignals(knowledge, errorAnalysis, kRow.review_count ?? 0, referenceDate);
    const diagnosis = diagnoseTopic(signals, referenceDate);

    results.push({
      ...diagnosis,
      topicId: kRow.topic_id,
      topicName: kRow.topics?.name ?? "Sem nome",
      subjectId: kRow.topics?.subject_id ?? "",
      subjectName: kRow.topics?.subjects?.name ?? "Sem matéria",
    });
  }

  return results;
}

/**
 * Diagnóstico de todos os tópicos de uma matéria.
 * 2 queries com filtro por subject_id.
 */
export async function getSubjectDiagnoses(subjectId: string): Promise<DiagnosisWithMeta[]> {
  const referenceDate = new Date().toISOString();

  // Buscar tópicos da matéria primeiro
  const { data: topicRows, error: topicError } = await supabase
    .from("topics")
    .select("id")
    .eq("subject_id", subjectId);

  if (topicError) throw topicError;
  const topicIds = (topicRows ?? []).map((t) => t.id);
  if (topicIds.length === 0) return [];

  const [knowledgeResult, errorsResult] = await Promise.all([
    supabase
      .from("user_topic_knowledge")
      .select(
        "topic_id, mastery, confidence, total_questions, correct_questions, last_studied_at, review_count, topics(name, subject_id, subjects(name))",
      )
      .in("topic_id", topicIds)
      .order("mastery", { ascending: true }),
    supabase
      .from("error_entries")
      .select(
        "id, user_id, topic_id, subject_id, category, is_resolved, resolved_at, occurred_at, attempt_id, question_id",
      )
      .eq("subject_id", subjectId),
  ]);

  if (knowledgeResult.error) throw knowledgeResult.error;
  if (errorsResult.error) throw errorsResult.error;

  const knowledgeRows = (knowledgeResult.data ?? []) as KnowledgeRow[];
  const allErrors = (errorsResult.data ?? []).map(toErrorRecord);

  const errorsByTopic = new Map<string, ErrorRecord[]>();
  for (const e of allErrors) {
    if (!e.topicId) continue;
    const list = errorsByTopic.get(e.topicId) ?? [];
    list.push(e);
    errorsByTopic.set(e.topicId, list);
  }

  const results: DiagnosisWithMeta[] = [];

  for (const kRow of knowledgeRows) {
    const topicErrors = errorsByTopic.get(kRow.topic_id) ?? [];
    const errorAnalysis = analyzeTopicErrors(topicErrors, kRow.topic_id, referenceDate);
    const knowledge = toKnowledgeState(kRow);
    const signals = buildSignals(knowledge, errorAnalysis, kRow.review_count ?? 0, referenceDate);
    const diagnosis = diagnoseTopic(signals, referenceDate);

    results.push({
      ...diagnosis,
      topicId: kRow.topic_id,
      topicName: kRow.topics?.name ?? "Sem nome",
      subjectId: kRow.topics?.subject_id ?? "",
      subjectName: kRow.topics?.subjects?.name ?? "Sem matéria",
    });
  }

  return results;
}

/**
 * Busca o histórico de knowledge_history para um tópico (para o gráfico de evolução).
 */
export async function getTopicHistory(topicId: string) {
  const { data, error } = await supabase
    .from("knowledge_history")
    .select("id, mastery_before, mastery_after, confidence, total_questions, created_at, reason")
    .eq("topic_id", topicId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}
