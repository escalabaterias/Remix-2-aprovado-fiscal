/**
 * Camada de dados do planejador (Etapa 2 + Etapa 3.3 + Etapa 5.4).
 * Todas as leituras/escritas passam pelo cliente Supabase do usuário logado,
 * portanto o RLS existente continua sendo a fronteira de segurança.
 *
 * [Etapa 5, Fase 4] generatePlanTasks agora tenta o caminho unificado
 * (Unified Scheduler) quando existem revisões pendentes para o concurso
 * ativo. Se não houver revisões, o fluxo original (buildPlan) continua
 * exatamente como antes, garantindo zero regressão.
 */
import { supabase } from "@/integrations/supabase/client";

import {
  emptyWeek,
  toISODate,
  todayISO,
  weekStartOf,
  weekStartsBetween,
  type AvailabilityWeek,
} from "./availability";
import {
  buildPlan,
  redistributeTasks,
  scoreCandidates,
  type ActivityKind,
  type DiagnosticData,
  type PlannerCandidate,
} from "./engine";
import { buildSignals } from "@/lib/knowledge/signals";
import { analyzeTopicErrors, type ErrorRecord } from "@/lib/knowledge/errors";
import { diagnoseTopic, computeInterventionScore } from "@/lib/diagnosis/engine";
import type { KnowledgeState } from "@/lib/knowledge/engine";

// [Etapa 5, Fase 4] Imports para integração unificada
import { getUserReviewQueue } from "@/lib/review/service";
import { buildUnifiedSchedule, DEFAULT_REVIEW_MINUTES } from "@/lib/scheduler/engine";
import { adaptReviewQueue, buildTopicMetaMap } from "@/lib/scheduler/service";
import type { UnifiedSchedulerConfig, UnifiedTask } from "@/lib/scheduler/types";

export type PlanSettings = {
  blockMinutes?: number;
  maxDailyMinutes?: number;
  contestTopicIds?: string[];
  // [Etapa 5, Fase 4] Limites opcionais do scheduler unificado
  reviewCap?: number;
  reviewFloor?: number;
  urgentReviewExtraCap?: number;
  absoluteReviewCeiling?: number;
  maxSubjectShare?: number;
  reviewMinutesPerIntensity?: Record<"leve" | "moderada" | "intensiva", number>;
};

export const DEFAULT_BLOCK_MINUTES = 50;
export const DEFAULT_MAX_DAILY_MINUTES = 480;

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sessão expirada.");
  return data.user.id;
}

export async function fetchAvailabilityWeeks(
  weekStarts: string[],
): Promise<Map<string, AvailabilityWeek>> {
  const map = new Map<string, AvailabilityWeek>();
  if (!weekStarts.length) return map;
  const { data, error } = await supabase
    .from("availability_weeks")
    .select(
      "week_start, minutes_sun, minutes_mon, minutes_tue, minutes_wed, minutes_thu, minutes_fri, minutes_sat",
    )
    .in("week_start", weekStarts);
  if (error) throw error;
  for (const row of data ?? []) map.set(row.week_start, row as AvailabilityWeek);
  return map;
}

export async function upsertAvailabilityWeek(week: AvailabilityWeek): Promise<void> {
  const user_id = await requireUserId();
  const { error } = await supabase
    .from("availability_weeks")
    .upsert({ ...week, user_id }, { onConflict: "user_id,week_start" });
  if (error) throw error;
}

/** Copia a disponibilidade de uma semana para outra. */
export async function copyAvailabilityWeek(from: AvailabilityWeek, toWeekStart: string) {
  await upsertAvailabilityWeek({ ...from, week_start: toWeekStart });
}

export async function fetchCandidates(contestId: string): Promise<PlannerCandidate[]> {
  const { data: contestTopics, error } = await supabase
    .from("contest_topics")
    .select(
      "id, subject_id, topic_id, priority, weight, incidence_score, relevance_score, is_studied, subjects(name), topics(name)",
    )
    .eq("contest_id", contestId);
  if (error) throw error;

  const rows = contestTopics ?? [];
  const topicIds = rows.map((r) => r.topic_id).filter((id): id is string => Boolean(id));

  const [knowledge, prerequisites] = await Promise.all([
    topicIds.length
      ? supabase.from("user_topic_knowledge").select("topic_id, mastery").in("topic_id", topicIds)
      : Promise.resolve({ data: [], error: null } as const),
    topicIds.length
      ? supabase
          .from("topic_prerequisites")
          .select("topic_id, prerequisite_topic_id")
          .in("topic_id", topicIds)
      : Promise.resolve({ data: [], error: null } as const),
  ]);

  const masteryByTopic = new Map<string, number | null>();
  for (const row of knowledge.data ?? []) {
    const raw = row.mastery === null ? null : Number(row.mastery);
    masteryByTopic.set(row.topic_id, raw === null ? null : raw > 1 ? raw / 100 : raw);
  }

  const prereqByTopic = new Map<string, string[]>();
  for (const row of prerequisites.data ?? []) {
    const list = prereqByTopic.get(row.topic_id) ?? [];
    list.push(row.prerequisite_topic_id);
    prereqByTopic.set(row.topic_id, list);
  }

  return rows.map((row) => ({
    contestTopicId: row.id,
    subjectId: row.subject_id,
    subjectName: (row.subjects as { name: string } | null)?.name ?? "Matéria",
    topicId: row.topic_id,
    topicName: (row.topics as { name: string } | null)?.name ?? null,
    priority: row.priority ?? 3,
    weight: row.weight === null ? null : Number(row.weight),
    incidence: row.incidence_score === null ? null : Number(row.incidence_score),
    relevance: row.relevance_score === null ? null : Number(row.relevance_score),
    isStudied: Boolean(row.is_studied),
    mastery: row.topic_id ? (masteryByTopic.get(row.topic_id) ?? null) : null,
    prerequisiteTopicIds: row.topic_id ? (prereqByTopic.get(row.topic_id) ?? []) : [],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ETAPA 3.3, FASE 3 — Diagnóstico real → Planner
// ─────────────────────────────────────────────────────────────────────────────

type KnowledgeRow = {
  topic_id: string;
  mastery: number | null;
  confidence: number | null;
  total_questions: number | null;
  correct_questions: number | null;
  last_studied_at: string | null;
  review_count: number | null;
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
 * [Etapa 3.3, Fase 3] Busca dados diagnósticos reais para um conjunto de tópicos.
 *
 * Executa exatamente 2 queries ao Supabase (independente da quantidade de tópicos):
 *   1. user_topic_knowledge — mastery, confidence, questions, last_studied_at
 *   2. error_entries — erros do usuário para os tópicos
 *
 * Em seguida, processa em memória usando os mesmos motores do diagnóstico
 * (buildSignals, analyzeTopicErrors, diagnoseTopic, computeInterventionScore)
 * para construir o Map<string, DiagnosticData> que o planner consome.
 *
 * RLS: ambas as tabelas possuem RLS por user_id, garantindo isolamento.
 * Se um tópico não tiver dados de conhecimento, ele simplesmente não aparece
 * no mapa — o planner trata ausência como "sem diagnóstico" (comportamento
 * seguro definido na Fase 2).
 */
export async function fetchDiagnosticDataForTopics(
  topicIds: string[],
): Promise<Map<string, DiagnosticData>> {
  const diagnosticMap = new Map<string, DiagnosticData>();
  if (topicIds.length === 0) return diagnosticMap;

  const referenceDate = new Date().toISOString();

  // 2 queries em lote — sem N+1
  const [knowledgeResult, errorsResult] = await Promise.all([
    supabase
      .from("user_topic_knowledge")
      .select(
        "topic_id, mastery, confidence, total_questions, correct_questions, last_studied_at, review_count",
      )
      .in("topic_id", topicIds),
    supabase
      .from("error_entries")
      .select(
        "id, user_id, topic_id, subject_id, category, is_resolved, resolved_at, occurred_at, attempt_id, question_id",
      )
      .in("topic_id", topicIds),
  ]);

  if (knowledgeResult.error) throw knowledgeResult.error;
  if (errorsResult.error) throw errorsResult.error;

  const knowledgeRows = (knowledgeResult.data ?? []) as KnowledgeRow[];
  const allErrors = (errorsResult.data ?? []).map(toErrorRecord);

  // Agrupar erros por tópico (mesma estratégia do diagnosis/service.ts)
  const errorsByTopic = new Map<string, ErrorRecord[]>();
  for (const e of allErrors) {
    if (!e.topicId) continue;
    const list = errorsByTopic.get(e.topicId) ?? [];
    list.push(e);
    errorsByTopic.set(e.topicId, list);
  }

  // Processar cada tópico com dados usando os motores existentes
  for (const kRow of knowledgeRows) {
    const topicErrors = errorsByTopic.get(kRow.topic_id) ?? [];
    const errorAnalysis = analyzeTopicErrors(topicErrors, kRow.topic_id, referenceDate);
    const knowledge = toKnowledgeState(kRow);
    const signals = buildSignals(knowledge, errorAnalysis, kRow.review_count ?? 0, referenceDate);
    const diagnosis = diagnoseTopic(signals, referenceDate);

    diagnosticMap.set(kRow.topic_id, {
      knowledgeState: diagnosis.knowledgeState,
      mastery: diagnosis.mastery,
      confidence: diagnosis.confidence,
      accuracy: diagnosis.accuracy,
      recentErrors: signals.recentErrors,
      unresolvedErrors: signals.unresolvedErrors,
      recurringErrors: signals.recurringErrors,
      daysSinceStudy: signals.daysSinceStudy,
      daysSinceError: signals.daysSinceError,
      interventionScore: diagnosis.interventionScore,
    });
  }

  return diagnosticMap;
}

export type GenerateResult = {
  tasksCreated: number;
  capacityMinutes: number;
  allocatedMinutes: number;
  skippedPast: number;
  /** [Etapa 5, Fase 4] Tarefas de estudo novo geradas */
  studyTasks?: number;
  /** [Etapa 5, Fase 4] Tarefas de revisão geradas */
  reviewTasks?: number;
  /** [Etapa 5, Fase 4] Indica se o caminho unificado foi utilizado */
  unifiedPath?: boolean;
};

/**
 * Gera (ou regenera) as tarefas futuras do plano.
 * Tarefas passadas e tarefas já trabalhadas NUNCA são apagadas.
 *
 * [Etapa 3.3, Fase 3] Busca diagnósticos reais do usuário e
 * passa ao buildPlan via diagnosticData.
 *
 * [Etapa 5, Fase 4] Agora tenta o caminho unificado (Unified Scheduler)
 * quando existem revisões pendentes para o concurso ativo.
 * Se não houver revisões, o fluxo original (buildPlan) continua
 * exatamente como antes, garantindo zero regressão.
 *
 * FLUXO:
 *   1. Busca plano, candidatos, disponibilidade, diagnóstico (inalterado)
 *   2. Pontua candidatos via scoreCandidates()
 *   3. Busca fila de revisão via getUserReviewQueue()
 *   4. Filtra revisões pelos tópicos do concurso ativo
 *   5. Se há revisões → buildUnifiedSchedule()
 *      Se não há → buildPlan() (fallback, zero regressão)
 *   6. Persiste plan_blocks + plan_tasks com source correto
 */
export async function generatePlanTasks(planId: string): Promise<GenerateResult> {
  const user_id = await requireUserId();

  const { data: plan, error: planError } = await supabase
    .from("study_plans")
    .select("id, contest_id, start_date, end_date, settings, contests(exam_date)")
    .eq("id", planId)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan) throw new Error("Plano não encontrado.");
  if (!plan.contest_id) throw new Error("Vincule um concurso ao plano antes de gerar tarefas.");
  if (!plan.start_date || !plan.end_date) throw new Error("Defina data inicial e final do plano.");

  const settings = (plan.settings ?? {}) as PlanSettings;
  const blockMinutes = settings.blockMinutes ?? DEFAULT_BLOCK_MINUTES;
  const maxDailyMinutes = settings.maxDailyMinutes ?? DEFAULT_MAX_DAILY_MINUTES;

  const today = todayISO();
  const from = plan.start_date > today ? plan.start_date : today;
  if (from > plan.end_date) throw new Error("O período do plano já terminou.");

  let candidates = await fetchCandidates(plan.contest_id);
  if (settings.contestTopicIds?.length) {
    const allowed = new Set(settings.contestTopicIds);
    candidates = candidates.filter((c) => allowed.has(c.contestTopicId));
  }
  if (!candidates.length) {
    throw new Error("Nenhuma matéria/tópico vinculado ao concurso para planejar.");
  }

  const weeks = await fetchAvailabilityWeeks(weekStartsBetween(from, plan.end_date));

  // [Etapa 3.3, Fase 3] Buscar diagnósticos reais para os tópicos candidatos.
  const topicIds = candidates.map((c) => c.topicId).filter((id): id is string => Boolean(id));
  const uniqueTopicIds = Array.from(new Set(topicIds));
  const diagnosticData = await fetchDiagnosticDataForTopics(uniqueTopicIds);

  const examDate = (plan.contests as { exam_date: string | null } | null)?.exam_date ?? null;

  // ── [Etapa 5, Fase 4] Tentar caminho unificado ──────────────────────
  // Pontua candidatos (mesmo motor do buildPlan, sem duplicar regra)
  const scored = scoreCandidates(candidates, {
    startDate: from,
    examDate,
    diagnosticData,
  });

  // Busca fila de revisão (2 queries: user_topic_knowledge + error_entries)
  let reviewCandidates: import("@/lib/scheduler/types").ReviewTaskCandidate[] = [];
  try {
    const reviewQueue = await getUserReviewQueue(from);
    const topicMetaById = buildTopicMetaMap(scored);

    const schedulerConfig: Pick<UnifiedSchedulerConfig, "reviewMinutesPerIntensity"> = {
      reviewMinutesPerIntensity: settings.reviewMinutesPerIntensity ?? DEFAULT_REVIEW_MINUTES,
    };

    reviewCandidates = adaptReviewQueue(reviewQueue, topicMetaById, schedulerConfig);
  } catch {
    // Se a busca de revisões falhar, continua sem revisões (fallback seguro).
    // O plano de estudo novo é gerado normalmente.
    reviewCandidates = [];
  }

  // ── DECISÃO: caminho unificado ou fallback ──────────────────────────
  if (reviewCandidates.length > 0) {
    // CAMINHO UNIFICADO: estudo novo + revisão em uma única agenda
    return generateUnifiedPath({
      userId: user_id,
      planId,
      from,
      endDate: plan.end_date,
      examDate,
      blockMinutes,
      maxDailyMinutes,
      scored,
      reviewCandidates,
      weeks,
      settings,
      startDate: plan.start_date,
    });
  }

  // FALLBACK: fluxo original (buildPlan) — zero regressão
  return generateLegacyPath({
    userId: user_id,
    planId,
    from,
    endDate: plan.end_date,
    examDate,
    blockMinutes,
    maxDailyMinutes,
    candidates,
    weeks,
    diagnosticData,
    startDate: plan.start_date,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// [Etapa 5, Fase 4] Caminho unificado (Unified Scheduler)
// ─────────────────────────────────────────────────────────────────────────────

type UnifiedPathArgs = {
  userId: string;
  planId: string;
  from: string;
  endDate: string;
  examDate: string | null;
  blockMinutes: number;
  maxDailyMinutes: number;
  scored: import("./engine").ScoredCandidate[];
  reviewCandidates: import("@/lib/scheduler/types").ReviewTaskCandidate[];
  weeks: Map<string, AvailabilityWeek>;
  settings: PlanSettings;
  startDate: string;
};

async function generateUnifiedPath(args: UnifiedPathArgs): Promise<GenerateResult> {
  const {
    userId,
    planId,
    from,
    endDate,
    examDate,
    blockMinutes,
    maxDailyMinutes,
    scored,
    reviewCandidates,
    weeks,
    settings,
    startDate,
  } = args;

  const safeUnit = (v: unknown): number | undefined => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) return undefined;
    return n;
  };

  const config: UnifiedSchedulerConfig = {
    reviewCap: safeUnit(settings.reviewCap) ?? 0.3,
    reviewFloor: safeUnit(settings.reviewFloor) ?? 0.05,
    urgentReviewExtraCap: safeUnit(settings.urgentReviewExtraCap) ?? 0.15,
    absoluteReviewCeiling: safeUnit(settings.absoluteReviewCeiling) ?? 0.6,
    reviewMinutesPerIntensity: settings.reviewMinutesPerIntensity ?? DEFAULT_REVIEW_MINUTES,
    examDate,
    startDate: from,
    endDate,
    blockMinutes,
    maxDailyMinutes,
    maxSubjectShare: safeUnit(settings.maxSubjectShare) ?? 1,
  };

  const schedule = buildUnifiedSchedule({
    studyCandidates: scored,
    reviewCandidates,
    weeks,
    config,
  });

  // Remove apenas o que ainda está pendente e não teve nenhum tempo realizado.
  const { error: deleteError } = await supabase
    .from("plan_tasks")
    .delete()
    .eq("plan_id", planId)
    .eq("status", "pendente")
    .gte("scheduled_date", from)
    .is("actual_minutes", null);
  if (deleteError) throw deleteError;

  if (!schedule.tasks.length) {
    return {
      tasksCreated: 0,
      capacityMinutes: schedule.totalCapacityMinutes,
      allocatedMinutes: 0,
      skippedPast: startDate < from ? 1 : 0,
      studyTasks: 0,
      reviewTasks: 0,
      unifiedPath: true,
    };
  }

  // Um bloco por semana = ciclo unificado daquela semana.
  const weekStarts = Array.from(
    new Set(schedule.tasks.map((t) => weekStartOf(t.scheduledDate))),
  ).sort();
  const blockRows = weekStarts.map((weekStart, index) => ({
    user_id: userId,
    plan_id: planId,
    name: `Agenda ${index + 1} — semana de ${weekStart.split("-").reverse().slice(0, 2).join("/")}`,
    week_start: weekStart,
    cycle_number: index + 1,
    position: index,
    block_date: weekStart,
    planned_minutes: schedule.tasks
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

  const taskRows = schedule.tasks.map((task) => ({
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
  }));

  for (let i = 0; i < taskRows.length; i += 200) {
    const { error } = await supabase.from("plan_tasks").insert(taskRows.slice(i, i + 200));
    if (error) throw error;
  }

  const studyTasks = schedule.tasks.filter((t) => t.source === "planner").length;
  const reviewTasks = schedule.tasks.filter((t) => t.source === "review_engine").length;

  return {
    tasksCreated: taskRows.length,
    capacityMinutes: schedule.totalCapacityMinutes,
    allocatedMinutes: schedule.studyMinutes + schedule.reviewMinutes,
    skippedPast: startDate < from ? 1 : 0,
    studyTasks,
    reviewTasks,
    unifiedPath: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Caminho legado (buildPlan original) — zero regressão
// ─────────────────────────────────────────────────────────────────────────────

type LegacyPathArgs = {
  userId: string;
  planId: string;
  from: string;
  endDate: string;
  examDate: string | null;
  blockMinutes: number;
  maxDailyMinutes: number;
  candidates: PlannerCandidate[];
  weeks: Map<string, AvailabilityWeek>;
  diagnosticData: Map<string, DiagnosticData>;
  startDate: string;
};

async function generateLegacyPath(args: LegacyPathArgs): Promise<GenerateResult> {
  const {
    userId,
    planId,
    from,
    endDate,
    examDate,
    blockMinutes,
    maxDailyMinutes,
    candidates,
    weeks,
    diagnosticData,
    startDate,
  } = args;

  const result = buildPlan(candidates, weeks, {
    startDate: from,
    endDate,
    examDate,
    blockMinutes,
    maxDailyMinutes,
    diagnosticData,
  });

  // Remove apenas o que ainda está pendente e não teve nenhum tempo realizado.
  const { error: deleteError } = await supabase
    .from("plan_tasks")
    .delete()
    .eq("plan_id", planId)
    .eq("status", "pendente")
    .gte("scheduled_date", from)
    .is("actual_minutes", null);
  if (deleteError) throw deleteError;

  if (!result.tasks.length) {
    return {
      tasksCreated: 0,
      capacityMinutes: result.totalCapacityMinutes,
      allocatedMinutes: 0,
      skippedPast: 0,
      unifiedPath: false,
    };
  }

  // Um bloco por semana = ciclo de estudo daquela semana.
  const weekStarts = Array.from(new Set(result.tasks.map((t) => weekStartOf(t.date)))).sort();
  const blockRows = weekStarts.map((weekStart, index) => ({
    user_id: userId,
    plan_id: planId,
    name: `Ciclo ${index + 1} — semana de ${weekStart.split("-").reverse().slice(0, 2).join("/")}`,
    week_start: weekStart,
    cycle_number: index + 1,
    position: index,
    block_date: weekStart,
    planned_minutes: result.tasks
      .filter((t) => weekStartOf(t.date) === weekStart)
      .reduce((sum, t) => sum + t.minutes, 0),
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

  const taskRows = result.tasks.map((task) => ({
    user_id: userId,
    plan_id: planId,
    block_id: blockByWeek.get(weekStartOf(task.date)) ?? null,
    subject_id: task.candidate.subjectId,
    topic_id: task.candidate.topicId,
    title: task.candidate.topicName
      ? `${task.candidate.subjectName} — ${task.candidate.topicName}`
      : task.candidate.subjectName,
    activity: task.activity,
    activity_type: task.activity as ActivityKind,
    scheduled_date: task.date,
    original_date: task.date,
    planned_minutes: task.minutes,
    status: "pendente" as const,
    priority_score: task.priorityScore,
    priority_reason: task.priorityReason,
    position: task.position,
    source: "planner" as const,
  }));

  for (let i = 0; i < taskRows.length; i += 200) {
    const { error } = await supabase.from("plan_tasks").insert(taskRows.slice(i, i + 200));
    if (error) throw error;
  }

  return {
    tasksCreated: taskRows.length,
    capacityMinutes: result.totalCapacityMinutes,
    allocatedMinutes: result.allocatedMinutes,
    skippedPast: startDate < from ? 1 : 0,
    unifiedPath: false,
  };
}

export type CompleteTaskInput = {
  taskId: string;
  status: "concluida" | "parcialmente_concluida" | "cancelada";
  grossMinutes: number;
  pauseMinutes: number;
  questionsCount?: number;
  correctCount?: number;
  wrongCount?: number;
  notes?: string;
};

/**
 * Conclusão de tarefa: registra tempo bruto, pausas e TEMPO LÍQUIDO,
 * além de criar a sessão de estudo correspondente (métrica real do dashboard).
 */
export async function completeTask(input: CompleteTaskInput): Promise<void> {
  const user_id = await requireUserId();
  const netMinutes = Math.max(0, input.grossMinutes - input.pauseMinutes);

  const { data: task, error: taskError } = await supabase
    .from("plan_tasks")
    .select("id, plan_id, subject_id, topic_id, scheduled_date, activity, plan_id")
    .eq("id", input.taskId)
    .maybeSingle();
  if (taskError) throw taskError;
  if (!task) throw new Error("Tarefa não encontrada.");

  const { data: plan } = await supabase
    .from("study_plans")
    .select("contest_id")
    .eq("id", task.plan_id)
    .maybeSingle();

  let sessionId: string | null = null;
  if (netMinutes > 0 && input.status !== "cancelada") {
    const { data: session, error: sessionError } = await supabase
      .from("study_sessions")
      .insert({
        user_id,
        contest_id: plan?.contest_id ?? null,
        subject_id: task.subject_id,
        topic_id: task.topic_id,
        session_date: task.scheduled_date ?? todayISO(),
        gross_seconds: Math.round(input.grossMinutes * 60),
        net_seconds: Math.round(netMinutes * 60),
        activity: task.activity,
        questions_count: input.questionsCount ?? 0,
        correct_count: input.correctCount ?? 0,
        wrong_count: input.wrongCount ?? 0,
        ended_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (sessionError) throw sessionError;
    sessionId = session.id;
  }

  const { error } = await supabase
    .from("plan_tasks")
    .update({
      status: input.status,
      actual_minutes: netMinutes,
      gross_minutes: Math.round(input.grossMinutes),
      questions_count: input.questionsCount ?? 0,
      correct_count: input.correctCount ?? 0,
      wrong_count: input.wrongCount ?? 0,
      completed_at: new Date().toISOString(),
      session_id: sessionId,
      notes: input.notes ?? null,
    })
    .eq("id", input.taskId);
  if (error) throw error;
}

export async function startTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from("plan_tasks")
    .update({ status: "em_andamento" })
    .eq("id", taskId);
  if (error) throw error;
}

export type ReplanResult = {
  moved: number;
  unplaced: number;
  deficitMinutes: number;
};

/**
 * Replanejamento: o que ficou pendente no passado não é apagado nem
 * considerado feito — é redistribuído na disponibilidade futura real.
 */
export async function replanPlan(planId: string): Promise<ReplanResult> {
  const today = todayISO();

  const { data: plan, error: planError } = await supabase
    .from("study_plans")
    .select("id, end_date, settings")
    .eq("id", planId)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan?.end_date) throw new Error("Plano sem data final.");

  const settings = (plan.settings ?? {}) as PlanSettings;
  const maxDailyMinutes = settings.maxDailyMinutes ?? DEFAULT_MAX_DAILY_MINUTES;

  const { data: tasks, error: tasksError } = await supabase
    .from("plan_tasks")
    .select(
      "id, scheduled_date, planned_minutes, status, priority_score, rescheduled_count, original_date",
    )
    .eq("plan_id", planId);
  if (tasksError) throw tasksError;

  const all = tasks ?? [];
  const overdue = all.filter(
    (t) =>
      (t.status === "pendente" || t.status === "em_andamento" || t.status === "reagendada") &&
      t.scheduled_date !== null &&
      t.scheduled_date < today,
  );
  const futurePlanned = new Map<string, number>();
  for (const t of all) {
    if (t.scheduled_date && t.scheduled_date >= today && t.status === "pendente") {
      futurePlanned.set(
        t.scheduled_date,
        (futurePlanned.get(t.scheduled_date) ?? 0) + (t.planned_minutes ?? 0),
      );
    }
  }

  if (!overdue.length) return { moved: 0, unplaced: 0, deficitMinutes: 0 };

  const weeks = await fetchAvailabilityWeeks(weekStartsBetween(today, plan.end_date));

  const placements = redistributeTasks(
    overdue.map((t) => ({
      id: t.id,
      minutes: t.planned_minutes ?? 30,
      score: Number(t.priority_score ?? 0),
    })),
    weeks,
    futurePlanned,
    { fromDate: today, endDate: plan.end_date, maxDailyMinutes },
  );

  let moved = 0;
  let unplaced = 0;
  for (const placement of placements) {
    const task = overdue.find((t) => t.id === placement.id)!;
    if (placement.date) {
      const { error } = await supabase
        .from("plan_tasks")
        .update({
          scheduled_date: placement.date,
          status: "pendente",
          original_date: task.original_date ?? task.scheduled_date,
          rescheduled_count: (task.rescheduled_count ?? 0) + 1,
        })
        .eq("id", placement.id);
      if (error) throw error;
      moved += 1;
    } else {
      const { error } = await supabase
        .from("plan_tasks")
        .update({
          status: "reagendada",
          original_date: task.original_date ?? task.scheduled_date,
          notes:
            "Sem capacidade na disponibilidade futura — ajuste a disponibilidade ou reduza o escopo.",
        })
        .eq("id", placement.id);
      if (error) throw error;
      unplaced += 1;
    }
  }

  const deficitMinutes = overdue.reduce((sum, t) => sum + (t.planned_minutes ?? 0), 0);
  return { moved, unplaced, deficitMinutes };
}

/** Semanas padrão sugeridas a partir de hoje (uso na tela de disponibilidade). */
export function nextWeekStarts(count: number): string[] {
  const base = weekStartOf(toISODate(new Date()));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(base);
    date.setDate(date.getDate() + index * 7);
    return toISODate(date);
  });
}

export { emptyWeek };
