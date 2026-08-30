/**
 * ERROR CENTRAL SERVICE — Central de Erros, Fase 2
 *
 * Conecta o motor determinístico (engine.ts) ao Supabase, buscando
 * error_entries e user_topic_knowledge do usuário autenticado.
 *
 * RESPONSABILIDADES:
 *   - Obter usuário autenticado via supabase.auth.getUser()
 *   - Buscar error_entries + knowledge em lote (2 queries paralelas)
 *   - Montar KnowledgeMap e delegar ao engine (prioritizeErrors, computeTopicErrorSummaries)
 *   - Expor filtros de conveniência (tópico, matéria, status, período)
 *
 * NÃO FAZ:
 *   - Duplicar regras de priorização (fica no engine)
 *   - Alterar Knowledge, Diagnosis, Review, Planner, Scheduler ou Question Bank
 *   - Aceitar userId arbitrário (RLS + requireUser)
 *
 * SEGURANÇA:
 *   Todas as leituras usam o cliente Supabase do usuário logado.
 *   RLS por user_id é a fronteira de segurança.
 *
 * PERFORMANCE:
 *   - 2 queries em paralelo (error_entries + user_topic_knowledge)
 *   - Agrupamento em memória — sem N+1
 */

import { supabase } from "@/integrations/supabase/client";
import {
  prioritizeErrors,
  computeTopicErrorSummaries,
  computeErrorPriority,
  type KnowledgeMap,
  type PrioritizedError,
  type TopicErrorSummary,
} from "./engine";
import type { ErrorRecord } from "@/lib/knowledge/errors";
import type { KnowledgeState } from "@/lib/knowledge/engine";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS INTERNOS (rows do banco)
// ─────────────────────────────────────────────────────────────────────────────

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

type KnowledgeRow = {
  topic_id: string;
  mastery: number | null;
  confidence: number | null;
  total_questions: number | null;
  correct_questions: number | null;
  last_studied_at: string | null;
};

type ErrorDetailRow = ErrorRow & {
  diagnosis: string | null;
  notes: string | null;
  intervention: string | null;
  topics: { name: string; subject_id: string | null; subjects: { name: string } | null } | null;
  subjects: { name: string } | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS PÚBLICOS
// ─────────────────────────────────────────────────────────────────────────────

export type ErrorCentralFilter = {
  /** Filtrar por tópico. */
  topicId?: string | null;
  /** Filtrar por matéria. */
  subjectId?: string | null;
  /** Filtrar por status: 'all' | 'resolved' | 'unresolved'. Default: 'all'. */
  status?: "all" | "resolved" | "unresolved";
  /** Período em dias (ex: 7, 30, 90). Null = todos. */
  periodDays?: number | null;
};

export type TopicErrorSummaryWithMeta = TopicErrorSummary & {
  topicName: string;
  subjectId: string;
  subjectName: string;
};

export type ErrorDetailResult = {
  error: ErrorRecord;
  prioritized: PrioritizedError;
  topicName: string;
  subjectName: string;
  diagnosis: string | null;
  notes: string | null;
  intervention: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSORES
// ─────────────────────────────────────────────────────────────────────────────

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

function toKnowledgeState(row: KnowledgeRow): KnowledgeState {
  return {
    mastery: Number(row.mastery ?? 0),
    confidence: Number(row.confidence ?? 0),
    totalQuestions: row.total_questions ?? 0,
    correctQuestions: row.correct_questions ?? 0,
    lastStudiedAt: row.last_studied_at ?? null,
  };
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

const ERROR_SELECT =
  "id, user_id, topic_id, subject_id, category, is_resolved, resolved_at, occurred_at, attempt_id, question_id";

const KNOWLEDGE_SELECT =
  "topic_id, mastery, confidence, total_questions, correct_questions, last_studied_at";

const ERROR_DETAIL_SELECT =
  "id, user_id, topic_id, subject_id, category, is_resolved, resolved_at, occurred_at, attempt_id, question_id, diagnosis, notes, intervention, topics!topic_id(name, subject_id, subjects(name)), subjects(name)";

/**
 * Busca error_entries e user_topic_knowledge em paralelo.
 * Aplica filtros no banco quando possível.
 * Retorna os dados brutos convertidos.
 */
async function fetchErrorsAndKnowledge(
  filter: ErrorCentralFilter = {},
): Promise<{ errors: ErrorRecord[]; knowledgeMap: KnowledgeMap }> {
  // Build error query with filters
  let errorQuery = supabase.from("error_entries").select(ERROR_SELECT);

  if (filter.topicId) {
    errorQuery = errorQuery.eq("topic_id", filter.topicId);
  }
  if (filter.subjectId) {
    errorQuery = errorQuery.eq("subject_id", filter.subjectId);
  }
  if (filter.status === "resolved") {
    errorQuery = errorQuery.eq("is_resolved", true);
  } else if (filter.status === "unresolved") {
    errorQuery = errorQuery.eq("is_resolved", false);
  }
  if (filter.periodDays != null && filter.periodDays > 0) {
    const since = new Date();
    since.setDate(since.getDate() - filter.periodDays);
    errorQuery = errorQuery.gte("occurred_at", since.toISOString());
  }

  errorQuery = errorQuery.order("occurred_at", { ascending: false });

  // Knowledge query — all topics (needed for cross-topic recurrence analysis)
  const knowledgeQuery = supabase.from("user_topic_knowledge").select(KNOWLEDGE_SELECT);

  // 2 queries em paralelo — sem N+1
  const [errorsResult, knowledgeResult] = await Promise.all([errorQuery, knowledgeQuery]);

  if (errorsResult.error) throw errorsResult.error;
  if (knowledgeResult.error) throw knowledgeResult.error;

  const errors = ((errorsResult.data ?? []) as ErrorRow[]).map(toErrorRecord);

  const knowledgeMap: KnowledgeMap = new Map();
  for (const row of (knowledgeResult.data ?? []) as KnowledgeRow[]) {
    knowledgeMap.set(row.topic_id, toKnowledgeState(row));
  }

  return { errors, knowledgeMap };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. fetchPrioritizedErrors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca error_entries do usuário autenticado e retorna priorizados
 * pelo motor determinístico.
 *
 * Queries: 2 (error_entries + user_topic_knowledge), em paralelo.
 *
 * @param filter  - Filtros opcionais (tópico, matéria, status, período).
 * @param referenceDate - Data de referência (ISO). Default: agora.
 */
export async function fetchPrioritizedErrors(
  filter: ErrorCentralFilter = {},
  referenceDate?: string,
): Promise<PrioritizedError[]> {
  await requireUser();

  const refDate = referenceDate ?? new Date().toISOString();
  const { errors, knowledgeMap } = await fetchErrorsAndKnowledge(filter);

  return prioritizeErrors(errors, knowledgeMap, refDate);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. fetchTopicErrorSummaries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna resumos de erros agrupados por tópico, com nomes para a UI.
 *
 * Queries: 3 (error_entries + user_topic_knowledge + topics com joins),
 * sendo as 2 primeiras em paralelo.
 *
 * @param filter        - Filtros opcionais.
 * @param referenceDate - Data de referência (ISO). Default: agora.
 */
export async function fetchTopicErrorSummaries(
  filter: ErrorCentralFilter = {},
  referenceDate?: string,
): Promise<TopicErrorSummaryWithMeta[]> {
  await requireUser();

  const refDate = referenceDate ?? new Date().toISOString();
  const { errors, knowledgeMap } = await fetchErrorsAndKnowledge(filter);

  const summaries = computeTopicErrorSummaries(errors, knowledgeMap, refDate);

  if (summaries.length === 0) return [];

  // Buscar nomes dos tópicos em uma query adicional
  const topicIds = summaries.map((s) => s.topicId);
  const { data: topicRows, error: topicError } = await supabase
    .from("topics")
    .select("id, name, subject_id, subjects(name)")
    .in("id", topicIds);

  if (topicError) throw topicError;

  // Montar lookup para nomes
  const topicMeta = new Map<
    string,
    { topicName: string; subjectId: string; subjectName: string }
  >();
  for (const row of topicRows ?? []) {
    const r = row as {
      id: string;
      name: string;
      subject_id: string | null;
      subjects: { name: string } | null;
    };
    topicMeta.set(r.id, {
      topicName: r.name ?? "Sem nome",
      subjectId: r.subject_id ?? "",
      subjectName: r.subjects?.name ?? "Sem matéria",
    });
  }

  return summaries.map((s) => {
    const meta = topicMeta.get(s.topicId);
    return {
      ...s,
      topicName: meta?.topicName ?? "Sem nome",
      subjectId: meta?.subjectId ?? "",
      subjectName: meta?.subjectName ?? "Sem matéria",
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. fetchErrorDetail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca o detalhe de um error_entry específico, incluindo seu score
 * de prioridade calculado pelo engine.
 *
 * Queries: 3 (error_entry com joins + todos os errors do tópico +
 * user_topic_knowledge), sendo as últimas 2 em paralelo.
 *
 * Retorna null se o erro não for encontrado.
 */
export async function fetchErrorDetail(
  errorId: string,
  referenceDate?: string,
): Promise<ErrorDetailResult | null> {
  await requireUser();

  const refDate = referenceDate ?? new Date().toISOString();

  // 1. Buscar o erro com joins para nomes
  const { data: detailData, error: detailError } = await supabase
    .from("error_entries")
    .select(ERROR_DETAIL_SELECT)
    .eq("id", errorId)
    .maybeSingle();

  if (detailError) throw detailError;
  if (!detailData) return null;

  const detail = detailData as ErrorDetailRow;
  const errorRecord = toErrorRecord(detail);

  // 2. Buscar todos os erros do mesmo tópico (para recorrência/frequência)
  //    e o knowledge do tópico, em paralelo
  const topicId = detail.topic_id;

  const [allErrorsResult, knowledgeResult] = await Promise.all([
    topicId
      ? supabase.from("error_entries").select(ERROR_SELECT).eq("topic_id", topicId)
      : Promise.resolve({ data: [] as ErrorRow[], error: null }),
    topicId
      ? supabase
          .from("user_topic_knowledge")
          .select(KNOWLEDGE_SELECT)
          .eq("topic_id", topicId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (allErrorsResult.error) throw allErrorsResult.error;
  if (knowledgeResult.error) throw knowledgeResult.error;

  const allErrors = ((allErrorsResult.data ?? []) as ErrorRow[]).map(toErrorRecord);
  const knowledge = knowledgeResult.data
    ? toKnowledgeState(knowledgeResult.data as KnowledgeRow)
    : null;

  const prioritized = computeErrorPriority(errorRecord, allErrors, knowledge, refDate);

  return {
    error: errorRecord,
    prioritized,
    topicName: detail.topics?.name ?? "Sem tópico",
    subjectName: detail.subjects?.name ?? detail.topics?.subjects?.name ?? "Sem matéria",
    diagnosis: detail.diagnosis,
    notes: detail.notes,
    intervention: detail.intervention,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. resolveErrorEntry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marca um error_entry como resolvido.
 *
 * Queries: 1.
 */
export async function resolveErrorEntry(errorId: string): Promise<void> {
  await requireUser();

  const { error } = await supabase
    .from("error_entries")
    .update({
      is_resolved: true,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", errorId);

  if (error) throw error;
}
