/**
 * UNIFIED SERVICE — Etapa 5, Fase 3
 *
 * Camada de ORQUESTRAÇÃO entre os serviços existentes e o Unified Scheduler:
 *
 *   BUSCAR → ADAPTAR → ORQUESTRAR → buildUnifiedSchedule() → PERSISTIR
 *
 * NÃO faz:
 *   - decisão de prioridade unificada (fica em buildUnifiedSchedule);
 *   - recálculo de mastery, confidence, urgência, intervalo ou intensidade;
 *   - duplicação de qualquer regra pedagógica;
 *   - alteração de Knowledge/Diagnosis/Review/Planner Engine ou Review Service.
 *
 * SEGURANÇA:
 *   Todas as leituras/escritas usam o cliente Supabase do usuário logado,
 *   portanto o RLS por user_id permanece como fronteira de segurança.
 *
 * ATOMICIDADE:
 *   DELETE + INSERT de blocos/tarefas ocorrem sequencialmente (mesma
 *   limitação já documentada no Planner Service e no Review Service).
 */

import { supabase } from "@/integrations/supabase/client";
import {
  fetchAvailabilityWeeks,
  fetchCandidates,
  fetchDiagnosticDataForTopics,
  DEFAULT_BLOCK_MINUTES,
  DEFAULT_MAX_DAILY_MINUTES,
  type PlanSettings,
} from "@/lib/planner/service";
import { scoreCandidates, type ActivityKind, type ScoredCandidate } from "@/lib/planner/engine";
import { todayISO, weekStartOf, weekStartsBetween } from "@/lib/planner/availability";
import { getUserReviewQueue, type ReviewQueueItem } from "@/lib/review/service";
import { buildUnifiedSchedule, DEFAULT_REVIEW_MINUTES } from "./engine";
import type {
  ReviewTaskCandidate,
  UnifiedSchedulerConfig,
  UnifiedSchedulerResult,
  UnifiedTask,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

/** Ajustes opcionais de limites do scheduler, persistidos em study_plans.settings. */
export type UnifiedPlanSettings = PlanSettings & {
  reviewCap?: number;
  reviewFloor?: number;
  urgentReviewExtraCap?: number;
  absoluteReviewCeiling?: number;
  maxSubjectShare?: number;
  reviewMinutesPerIntensity?: Record<"leve" | "moderada" | "intensiva", number>;
};

export type GenerateUnifiedScheduleResult = {
  /** Quantidade de tarefas persistidas em plan_tasks */
  tasksCreated: number;
  /** Quantidade de blocos persistidos em plan_blocks */
  blocksCreated: number;
  /** Tarefas geradas com source = 'planner' */
  studyTasks: number;
  /** Tarefas geradas com source = 'review_engine' */
  reviewTasks: number;
  /** Resultado bruto do Unified Scheduler (propagado sem alteração) */
  schedule: UnifiedSchedulerResult;
};

/** Metadados estruturais de um tópico do concurso ativo (carregados em lote). */
type TopicMeta = {
  subjectId: string;
  subjectName: string;
  topicName: string;
  /** Score estrutural do Planner (não recalculado aqui) */
  structuralPriority: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Usuário não autenticado.");
  return data.user.id;
}

function safeUnitOrUndefined(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  if (n < 0 || n > 1) return undefined;
  return n;
}

/**
 * Adapta a fila de revisão (Review Service) para ReviewTaskCandidate,
 * FILTRANDO pelos tópicos do concurso ativo.
 *
 * Sem nenhuma query adicional: subjectId, subjectName, topicName e
 * structuralPriority vêm do Map já carregado dos candidatos do concurso.
 */
export function adaptReviewQueue(
  queue: ReviewQueueItem[],
  topicMetaById: Map<string, TopicMeta>,
  config: Pick<UnifiedSchedulerConfig, "reviewMinutesPerIntensity">,
): ReviewTaskCandidate[] {
  const adapted: ReviewTaskCandidate[] = [];
  for (const item of queue) {
    const meta = topicMetaById.get(item.topicId);
    // FILTRO POR CONCURSO: tópico fora do concurso ativo é descartado.
    if (!meta) continue;
    const table = config.reviewMinutesPerIntensity ?? DEFAULT_REVIEW_MINUTES;
    adapted.push({
      topicId: item.topicId,
      subjectId: meta.subjectId,
      subjectName: meta.subjectName,
      topicName: meta.topicName,
      reviewUrgency: item.reviewUrgency,
      reviewType: item.reviewType,
      reviewIntensity: item.reviewIntensity,
      reviewInterval: item.reviewInterval,
      estimatedMinutes: table[item.reviewIntensity] ?? DEFAULT_REVIEW_MINUTES.moderada,
      interventionScore: item.input.interventionScore,
      knowledgeState: item.input.knowledgeState,
      structuralPriority: meta.structuralPriority,
    });
  }
  return adapted;
}

/** Constrói o Map de metadados a partir dos candidatos já pontuados (sem queries). */
export function buildTopicMetaMap(scored: ScoredCandidate[]): Map<string, TopicMeta> {
  const map = new Map<string, TopicMeta>();
  for (const c of scored) {
    if (!c.topicId) continue;
    const existing = map.get(c.topicId);
    const structuralPriority = Number.isFinite(c.score) ? c.score : 0;
    if (existing && existing.structuralPriority >= structuralPriority) continue;
    map.set(c.topicId, {
      subjectId: c.subjectId,
      subjectName: c.subjectName,
      topicName: c.topicName ?? "",
      structuralPriority,
    });
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gera e persiste a agenda unificada (estudo novo + revisão) de um plano.
 *
 * QUERIES (todas em lote — sem N+1):
 *   1. study_plans (+ contests.exam_date)                       — 1
 *   2. contest_topics (+ subjects.name, topics.name)            — 1  (fetchCandidates)
 *   3. user_topic_knowledge / topic_prerequisites               — 2  (fetchCandidates)
 *   4. availability_weeks                                       — 1
 *   5. user_topic_knowledge / error_entries (diagnóstico)        — 2  (fetchDiagnosticDataForTopics)
 *   6. auth.getUser + user_topic_knowledge / error_entries       — 3  (getUserReviewQueue)
 *   7. DELETE plan_tasks pendentes futuras                      — 1
 *   8. DELETE plan_blocks órfãos futuros                        — 1
 *   9. INSERT plan_blocks                                       — 1
 *  10. INSERT plan_tasks                                        — 1 por lote de 200
 */
export async function generateUnifiedSchedule(
  planId: string,
  options?: { referenceDate?: string },
): Promise<GenerateUnifiedScheduleResult> {
  const user_id = await requireUserId();

  const { data: plan, error: planError } = await supabase
    .from("study_plans")
    .select("id, contest_id, start_date, end_date, settings, contests(exam_date)")
    .eq("id", planId)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan) throw new Error("Plano não encontrado.");
  if (!plan.contest_id) throw new Error("Vincule um concurso ao plano antes de gerar a agenda.");
  if (!plan.start_date || !plan.end_date) throw new Error("Defina data inicial e final do plano.");

  const settings = (plan.settings ?? {}) as UnifiedPlanSettings;
  const blockMinutes = settings.blockMinutes ?? DEFAULT_BLOCK_MINUTES;
  const maxDailyMinutes = settings.maxDailyMinutes ?? DEFAULT_MAX_DAILY_MINUTES;

  const today = options?.referenceDate ?? todayISO();
  const from = plan.start_date > today ? plan.start_date : today;
  if (from > plan.end_date) throw new Error("O período do plano já terminou.");

  // ── 1. Candidatos de estudo do concurso ativo (Planner Service) ──
  let candidates = await fetchCandidates(plan.contest_id);
  if (settings.contestTopicIds?.length) {
    const allowed = new Set(settings.contestTopicIds);
    candidates = candidates.filter((c) => allowed.has(c.contestTopicId));
  }

  const examDate = (plan.contests as { exam_date: string | null } | null)?.exam_date ?? null;

  // ── 2. Diagnóstico em lote (2 queries) ──
  const uniqueTopicIds = Array.from(
    new Set(candidates.map((c) => c.topicId).filter((id): id is string => Boolean(id))),
  );
  const diagnosticData = await fetchDiagnosticDataForTopics(uniqueTopicIds);

  // ── 3. Pontuação estrutural (motor do Planner, sem duplicar regra) ──
  const scored = scoreCandidates(candidates, {
    examDate,
    startDate: from,
    diagnosticData,
  });

  // ── 4. Disponibilidade existente ──
  const weeks = await fetchAvailabilityWeeks(weekStartsBetween(from, plan.end_date));

  // ── 5. Fila de revisão (Review Service) + filtro por concurso ──
  const reviewQueue = await getUserReviewQueue(from);
  const topicMetaById = buildTopicMetaMap(scored);

  const config: UnifiedSchedulerConfig = {
    reviewCap: safeUnitOrUndefined(settings.reviewCap) ?? 0.3,
    reviewFloor: safeUnitOrUndefined(settings.reviewFloor) ?? 0.05,
    urgentReviewExtraCap: safeUnitOrUndefined(settings.urgentReviewExtraCap) ?? 0.15,
    absoluteReviewCeiling: safeUnitOrUndefined(settings.absoluteReviewCeiling) ?? 0.6,
    reviewMinutesPerIntensity: settings.reviewMinutesPerIntensity ?? DEFAULT_REVIEW_MINUTES,
    examDate,
    startDate: from,
    endDate: plan.end_date,
    blockMinutes,
    maxDailyMinutes,
    maxSubjectShare: safeUnitOrUndefined(settings.maxSubjectShare) ?? 1,
  };

  const reviewCandidates = adaptReviewQueue(reviewQueue, topicMetaById, config);

  // ── 6. Motor puro: única fonte de decisão de prioridade unificada ──
  const schedule = buildUnifiedSchedule({
    studyCandidates: scored,
    reviewCandidates,
    weeks,
    config,
  });

  // ── 7. Persistência ──
  const persisted = await persistUnifiedSchedule({
    userId: user_id,
    planId,
    from,
    tasks: schedule.tasks,
  });

  return {
    tasksCreated: persisted.tasksCreated,
    blocksCreated: persisted.blocksCreated,
    studyTasks: schedule.tasks.filter((t) => t.source === "planner").length,
    reviewTasks: schedule.tasks.filter((t) => t.source === "review_engine").length,
    schedule,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTÊNCIA
// ─────────────────────────────────────────────────────────────────────────────

async function persistUnifiedSchedule(args: {
  userId: string;
  planId: string;
  from: string;
  tasks: UnifiedTask[];
}): Promise<{ tasksCreated: number; blocksCreated: number }> {
  const { userId, planId, from, tasks } = args;

  // Remove apenas o que ainda está pendente e sem tempo realizado.
  const { error: deleteTasksError } = await supabase
    .from("plan_tasks")
    .delete()
    .eq("plan_id", planId)
    .eq("status", "pendente")
    .gte("scheduled_date", from)
    .is("actual_minutes", null);
  if (deleteTasksError) throw deleteTasksError;

  const { error: deleteBlocksError } = await supabase
    .from("plan_blocks")
    .delete()
    .eq("plan_id", planId)
    .gte("block_date", from);
  if (deleteBlocksError) throw deleteBlocksError;

  if (!tasks.length) return { tasksCreated: 0, blocksCreated: 0 };

  // Um bloco por semana = ciclo unificado daquela semana.
  const weekStarts = Array.from(new Set(tasks.map((t) => weekStartOf(t.scheduledDate)))).sort();
  const blockRows = weekStarts.map((weekStart, index) => ({
    user_id: userId,
    plan_id: planId,
    name: `Agenda unificada ${index + 1} — semana de ${weekStart
      .split("-")
      .reverse()
      .slice(0, 2)
      .join("/")}`,
    week_start: weekStart,
    cycle_number: index + 1,
    position: index,
    block_date: weekStart,
    planned_minutes: tasks
      .filter((t) => weekStartOf(t.scheduledDate) === weekStart)
      .reduce((sum, t) => sum + t.plannedMinutes, 0),
  }));

  const { data: blocks, error: blockError } = await supabase
    .from("plan_blocks")
    .insert(blockRows)
    .select("id, week_start");
  if (blockError) throw blockError;

  const blockByWeek = new Map<string, string>();
  for (const block of blocks ?? []) {
    if (block.week_start) blockByWeek.set(block.week_start, block.id);
  }

  const taskRows = tasks.map((task) => ({
    user_id: userId,
    plan_id: planId,
    block_id: blockByWeek.get(weekStartOf(task.scheduledDate)) ?? null,
    subject_id: task.subjectId || null,
    topic_id: task.topicId,
    title: task.topicName ? `${task.subjectName} — ${task.topicName}` : task.subjectName,
    activity: task.activity,
    activity_type: task.activity as ActivityKind,
    scheduled_date: task.scheduledDate,
    original_date: task.scheduledDate,
    planned_minutes: task.plannedMinutes,
    status: "pendente" as const,
    priority_score: task.unifiedPriorityScore,
    priority_reason: task.priorityReason,
    position: task.position,
    source: task.source,
    review_event_id: null as string | null,
  }));

  for (let i = 0; i < taskRows.length; i += 200) {
    const { error } = await supabase.from("plan_tasks").insert(taskRows.slice(i, i + 200));
    if (error) throw error;
  }

  return { tasksCreated: taskRows.length, blocksCreated: blockRows.length };
}
