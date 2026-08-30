/**
 * STUDY SESSION SERVICE — Fase 2
 *
 * Conecta o engine puro (buildSession) ao Supabase, buscando as tarefas
 * já geradas pelo Planner/Unified Scheduler e adaptando-as para
 * SessionTaskInput antes de delegar ao motor.
 *
 * RESPONSABILIDADES:
 *   - Obter usuário autenticado via supabase.auth.getUser()
 *   - Buscar plan_tasks pendentes do plano em uma única query
 *   - Adaptar rows do banco para SessionTaskInput
 *   - Chamar buildSession() e retornar o SessionResult
 *
 * NÃO FAZ:
 *   - Recalcular scores, mastery, urgência ou intervalos
 *   - Duplicar regras do engine
 *   - Criar UI, rota ou migration
 *
 * SEGURANÇA:
 *   Todas as leituras usam o cliente Supabase do usuário logado.
 *   RLS por user_id é a fronteira de segurança.
 *
 * PERFORMANCE:
 *   Uma única query com joins inline (subjects.name, topics.name)
 *   para evitar N+1.
 */

import { supabase } from "@/integrations/supabase/client";
import { buildSession } from "./engine";
import type { SessionTaskInput, SessionConfig, SessionResult } from "./types";
import type { ActivityKind } from "@/lib/planner/engine";
import type { UnifiedTaskSource } from "@/lib/scheduler/types";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS INTERNOS (row do banco)
// ─────────────────────────────────────────────────────────────────────────────

type PlanTaskRow = {
  id: string;
  topic_id: string | null;
  subject_id: string | null;
  activity: string | null;
  activity_type: string | null;
  source: string;
  planned_minutes: number | null;
  priority_score: number | null;
  priority_reason: string | null;
  scheduled_date: string | null;
  review_event_id: string | null;
  subjects: { name: string } | null;
  topics: { name: string } | null;
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

/** Garante número finito, com fallback seguro. */
function safeNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Mapeia a source string do banco para UnifiedTaskSource. */
function toSource(raw: string): UnifiedTaskSource {
  if (raw === "review_engine" || raw === "manual") return raw;
  return "planner";
}

/** Mapeia a activity string do banco para ActivityKind. */
function toActivity(raw: string | null): ActivityKind {
  const valid: ActivityKind[] = [
    "teoria",
    "questoes",
    "revisao",
    "flashcards",
    "simulado",
    "exercicios",
    "leitura",
    "estudo_dirigido",
  ];
  if (raw && valid.includes(raw as ActivityKind)) return raw as ActivityKind;
  return "teoria";
}

/** Mapeia review_type de metadados para o tipo esperado. */
type ReviewType = SessionTaskInput["reviewType"];
type ReviewIntensity = SessionTaskInput["reviewIntensity"];

/**
 * Adapta uma row do banco para SessionTaskInput.
 * Campos de revisão (urgency, type, intensity) são inferidos
 * a partir da source e activity.
 */
export function adaptRowToSessionTask(row: PlanTaskRow): SessionTaskInput | null {
  if (!row.topic_id) return null;

  const source = toSource(row.source);
  const activity = toActivity(row.activity ?? row.activity_type);
  const isReview = source === "review_engine";

  return {
    taskId: row.id,
    topicId: row.topic_id,
    subjectId: row.subject_id ?? "",
    subjectName: row.subjects?.name ?? "Matéria",
    topicName: row.topics?.name ?? "Tópico",
    activity,
    source,
    plannedMinutes: safeNum(row.planned_minutes, 0),
    priorityScore: safeNum(row.priority_score, 0),
    priorityReason: row.priority_reason ?? "",
    reviewUrgency: isReview ? safeNum(row.priority_score, 0) / 10 : null,
    reviewType: isReview ? inferReviewType(activity) : null,
    reviewIntensity: isReview ? inferReviewIntensity(row.planned_minutes) : null,
  };
}

/** Infere tipo de revisão a partir da atividade. */
function inferReviewType(activity: ActivityKind): ReviewType {
  if (activity === "exercicios" || activity === "questoes") return "erro_direcionado";
  if (activity === "flashcards") return "manutencao";
  return "consolidacao";
}

/** Infere intensidade a partir dos minutos planejados. */
function inferReviewIntensity(minutes: number | null): ReviewIntensity {
  const m = safeNum(minutes, 30);
  if (m <= 15) return "leve";
  if (m <= 35) return "moderada";
  return "intensiva";
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_TASK_SELECT =
  "id, topic_id, subject_id, activity, activity_type, source, planned_minutes, priority_score, priority_reason, scheduled_date, review_event_id, subjects(name), topics(name)";

// ─────────────────────────────────────────────────────────────────────────────
// OPÇÕES
// ─────────────────────────────────────────────────────────────────────────────

export type StudySessionOptions = {
  /** Data de referência (ISO YYYY-MM-DD). Default: hoje. */
  scheduledDate?: string;
  /** Configuração parcial do motor de sessão. */
  sessionConfig?: Partial<SessionConfig>;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. fetchSessionTasks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca as tarefas pendentes do plano e as adapta para SessionTaskInput.
 *
 * Query: 1 (plan_tasks com joins inline para subjects e topics).
 * Filtros aplicados no banco:
 *   - plan_id = planId
 *   - status = 'pendente'
 *   - scheduled_date = scheduledDate (ou >= hoje se não informado)
 *
 * Retorna as tarefas ordenadas por priority_score desc, scheduled_date asc.
 */
export async function fetchSessionTasks(
  planId: string,
  options: Pick<StudySessionOptions, "scheduledDate"> = {},
): Promise<SessionTaskInput[]> {
  await requireUser();

  const today = new Date().toISOString().slice(0, 10);
  const targetDate = options.scheduledDate ?? today;

  const { data, error } = await supabase
    .from("plan_tasks")
    .select(PLAN_TASK_SELECT)
    .eq("plan_id", planId)
    .eq("status", "pendente")
    .eq("scheduled_date", targetDate)
    .order("priority_score", { ascending: false })
    .order("scheduled_date", { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as PlanTaskRow[];
  const tasks: SessionTaskInput[] = [];

  for (const row of rows) {
    const adapted = adaptRowToSessionTask(row);
    if (adapted) tasks.push(adapted);
  }

  return tasks;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. buildStudySession
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca tarefas pendentes do plano e monta a sessão de estudo completa.
 *
 * Fluxo:
 *   1. fetchSessionTasks() → SessionTaskInput[]
 *   2. buildSession(tasks, config) → SessionResult
 *
 * Queries: 1 (via fetchSessionTasks).
 * Engine: 1 chamada (buildSession), sem duplicar regras.
 */
export async function buildStudySession(
  planId: string,
  options: StudySessionOptions = {},
): Promise<SessionResult> {
  const tasks = await fetchSessionTasks(planId, {
    ...(options.scheduledDate ? { scheduledDate: options.scheduledDate } : {}),
  });

  return buildSession(tasks, options.sessionConfig);
}
