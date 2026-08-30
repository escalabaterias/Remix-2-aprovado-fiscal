/**
 * SESSION SERVICE — Fase 3
 *
 * Camada de execução/persistência de sessões de estudo.
 * Conecta o motor (engine) e o service (Fase 2) ao banco,
 * gerenciando o ciclo de vida completo de uma sessão:
 *
 *   criar → iniciar → executar atividades → concluir
 *
 * RESPONSABILIDADES:
 *   - Criar sessão no banco (study_sessions)
 *   - Vincular tarefas selecionadas pelo buildStudySession() via session_id
 *   - Controlar início e conclusão da sessão
 *   - Atualizar status das tarefas conforme execução
 *   - Registrar tempo efetivamente estudado
 *   - Concluir atividades sem duplicidade (idempotência)
 *   - Retomar sessão existente de forma segura
 *   - Isolamento por usuário via RLS
 *
 * REUTILIZA:
 *   - buildStudySession() do service.ts (Fase 2) para montar atividades
 *   - Nenhuma regra de priorização ou seleção é duplicada
 *
 * NÃO FAZ:
 *   - Recalcular scores, mastery, urgência ou intervalos
 *   - Criar UI, rota ou migration
 *   - Alterar engine.ts ou service.ts
 *
 * PERFORMANCE:
 *   - Batch updates para vincular tarefas (evita N+1)
 *   - Single-query fetches com filtros no banco
 *
 * SEGURANÇA:
 *   - Todas as operações usam o cliente Supabase do usuário logado
 *   - RLS por user_id é a fronteira de segurança
 */

import { supabase } from "@/integrations/supabase/client";
import { buildStudySession } from "./service";
import type { SessionActivity, SessionConfig, SessionResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

export type StudySessionRecord = {
  id: string;
  userId: string;
  planId: string;
  sessionDate: string;
  startedAt: string | null;
  endedAt: string | null;
  grossSeconds: number;
  netSeconds: number;
  questionsCount: number;
  correctCount: number;
  wrongCount: number;
  notes: string | null;
  activities: SessionActivityRecord[];
};

export type SessionActivityRecord = {
  taskId: string;
  topicId: string;
  subjectId: string;
  subjectName: string;
  topicName: string;
  activity: string;
  allocatedMinutes: number;
  actualMinutes: number | null;
  status: string;
  position: number;
};

export type CreateSessionOptions = {
  planId: string;
  scheduledDate?: string;
  sessionConfig?: Partial<SessionConfig>;
  contestId?: string;
  notes?: string;
};

export type CompleteActivityInput = {
  sessionId: string;
  taskId: string;
  actualMinutes: number;
  questionsCount?: number;
  correctCount?: number;
  wrongCount?: number;
  notes?: string;
};

export type CompleteSessionInput = {
  sessionId: string;
  notes?: string;
};

export type SessionStatus = {
  sessionId: string;
  status: "pending" | "in_progress" | "completed";
  startedAt: string | null;
  endedAt: string | null;
  grossSeconds: number;
  netSeconds: number;
  totalActivities: number;
  completedActivities: number;
  pendingActivities: number;
  inProgressActivities: number;
  totalAllocatedMinutes: number;
  totalActualMinutes: number;
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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. createStudySession
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria uma sessão de estudo completa:
 *   1. Chama buildStudySession() para montar as atividades
 *   2. Insere um registro em study_sessions
 *   3. Vincula as tarefas selecionadas via session_id em plan_tasks
 *
 * Retorna o SessionResult do engine + o ID da sessão criada no banco.
 *
 * Queries: 1 (buildStudySession) + 1 (insert session) + 1 (batch update tasks)
 */
export async function createStudySession(
  options: CreateSessionOptions,
): Promise<{ sessionId: string; result: SessionResult }> {
  const userId = await requireUser();
  const { planId, scheduledDate, sessionConfig, contestId, notes } = options;
  const targetDate = scheduledDate ?? todayISO();

  // 1. Montar atividades via buildStudySession (reutiliza engine + service)
  const result = await buildStudySession(planId, {
    scheduledDate: targetDate,
    ...(sessionConfig ? { sessionConfig } : {}),
  });

  if (result.activities.length === 0) {
    // Cria sessão vazia para registro
    const { data: session, error: sessionError } = await supabase
      .from("study_sessions")
      .insert({
        user_id: userId,
        session_date: targetDate,
        contest_id: contestId ?? null,
        activity: "sessao_estudo",
        notes: notes ?? null,
      })
      .select("id")
      .single();

    if (sessionError || !session) throw sessionError ?? new Error("Falha ao criar sessão.");

    return { sessionId: session.id, result };
  }

  // 2. Inserir registro da sessão
  const { data: session, error: sessionError } = await supabase
    .from("study_sessions")
    .insert({
      user_id: userId,
      session_date: targetDate,
      contest_id: contestId ?? null,
      activity: "sessao_estudo",
      notes: notes ?? null,
    })
    .select("id")
    .single();

  if (sessionError || !session) throw sessionError ?? new Error("Falha ao criar sessão.");

  // 3. Vincular tarefas à sessão (batch update)
  const taskIds = result.activities.map((a) => a.taskId);
  const { error: linkError } = await supabase
    .from("plan_tasks")
    .update({ session_id: session.id })
    .in("id", taskIds)
    .eq("user_id", userId);

  if (linkError) throw linkError;

  return { sessionId: session.id, result };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. resumeStudySession
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retoma uma sessão existente que ainda não foi concluída.
 * Busca a sessão e suas tarefas vinculadas, retornando o estado atual.
 *
 * Segurança: RLS garante que só o dono da sessão pode acessá-la.
 * Queries: 1 (session) + 1 (tasks vinculadas)
 */
export async function resumeStudySession(sessionId: string): Promise<StudySessionRecord> {
  await requireUser();

  // Buscar sessão
  const { data: session, error: sessionError } = await supabase
    .from("study_sessions")
    .select(
      "id, user_id, session_date, started_at, ended_at, gross_seconds, net_seconds, questions_count, correct_count, wrong_count, notes",
    )
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    throw sessionError ?? new Error("Sessão não encontrada.");
  }

  if (session.ended_at) {
    throw new Error("Sessão já foi concluída.");
  }

  // Buscar tarefas vinculadas
  const { data: tasks, error: tasksError } = await supabase
    .from("plan_tasks")
    .select(
      "id, topic_id, subject_id, activity, activity_type, planned_minutes, actual_minutes, status, position, subjects(name), topics(name)",
    )
    .eq("session_id", sessionId)
    .order("position", { ascending: true });

  if (tasksError) throw tasksError;

  const activities: SessionActivityRecord[] = (tasks ?? []).map((t: any) => ({
    taskId: t.id,
    topicId: t.topic_id ?? "",
    subjectId: t.subject_id ?? "",
    subjectName: t.subjects?.name ?? "Matéria",
    topicName: t.topics?.name ?? "Tópico",
    activity: t.activity ?? t.activity_type ?? "teoria",
    allocatedMinutes: t.planned_minutes ?? 0,
    actualMinutes: t.actual_minutes ?? null,
    status: t.status ?? "pendente",
    position: t.position ?? 0,
  }));

  return {
    id: session.id,
    userId: session.user_id,
    planId: "", // plan_id não está na study_sessions, inferido pelo contexto
    sessionDate: session.session_date,
    startedAt: session.started_at ?? null,
    endedAt: session.ended_at ?? null,
    grossSeconds: session.gross_seconds ?? 0,
    netSeconds: session.net_seconds ?? 0,
    questionsCount: session.questions_count ?? 0,
    correctCount: session.correct_count ?? 0,
    wrongCount: session.wrong_count ?? 0,
    notes: session.notes ?? null,
    activities,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. startSession
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marca o início de uma sessão de estudo.
 * Registra started_at se ainda não foi definido (idempotente).
 *
 * Queries: 1 (update)
 */
export async function startSession(sessionId: string): Promise<void> {
  const userId = await requireUser();

  // Verificar se já foi iniciada
  const { data: existing, error: fetchError } = await supabase
    .from("study_sessions")
    .select("started_at, ended_at")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (fetchError || !existing) {
    throw fetchError ?? new Error("Sessão não encontrada.");
  }

  if (existing.ended_at) {
    throw new Error("Sessão já foi concluída.");
  }

  // Idempotente: se já foi iniciada, não faz nada
  if (existing.started_at) return;

  const { error: updateError } = await supabase
    .from("study_sessions")
    .update({ started_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (updateError) throw updateError;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. completeActivity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conclui uma atividade individual da sessão.
 * Idempotente: se a tarefa já está concluída, retorna sem erro.
 *
 * Atualiza:
 *   - plan_tasks: status → 'concluida', actual_minutes, completed_at,
 *     questions_count, correct_count, wrong_count
 *   - study_sessions: acumula questions_count, correct_count, wrong_count
 *
 * Queries: 1 (check task) + 1 (update task) + 1 (update session counters)
 */
export async function completeActivity(
  input: CompleteActivityInput,
): Promise<{ alreadyCompleted: boolean }> {
  const userId = await requireUser();
  const { sessionId, taskId, actualMinutes, questionsCount, correctCount, wrongCount, notes } =
    input;

  // Verificar estado atual da tarefa
  const { data: task, error: taskError } = await supabase
    .from("plan_tasks")
    .select("id, status, session_id")
    .eq("id", taskId)
    .eq("user_id", userId)
    .single();

  if (taskError || !task) {
    throw taskError ?? new Error("Tarefa não encontrada.");
  }

  // Verificar que a tarefa pertence a esta sessão
  if (task.session_id !== sessionId) {
    throw new Error("Tarefa não pertence a esta sessão.");
  }

  // Idempotência: se já concluída, retorna sem erro
  if (task.status === "concluida") {
    return { alreadyCompleted: true };
  }

  // Atualizar a tarefa
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("plan_tasks")
    .update({
      status: "concluida" as any,
      actual_minutes: actualMinutes,
      completed_at: now,
      questions_count: questionsCount ?? 0,
      correct_count: correctCount ?? 0,
      wrong_count: wrongCount ?? 0,
      notes: notes ?? null,
    })
    .eq("id", taskId)
    .eq("user_id", userId);

  if (updateError) throw updateError;

  // Acumular contadores na sessão (queries_count, correct, wrong)
  if ((questionsCount ?? 0) > 0 || (correctCount ?? 0) > 0 || (wrongCount ?? 0) > 0) {
    // Buscar contadores atuais da sessão
    const { data: sessionData, error: sessionFetchErr } = await supabase
      .from("study_sessions")
      .select("questions_count, correct_count, wrong_count")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single();

    if (!sessionFetchErr && sessionData) {
      const { error: sessionUpdateErr } = await supabase
        .from("study_sessions")
        .update({
          questions_count: (sessionData.questions_count ?? 0) + (questionsCount ?? 0),
          correct_count: (sessionData.correct_count ?? 0) + (correctCount ?? 0),
          wrong_count: (sessionData.wrong_count ?? 0) + (wrongCount ?? 0),
        })
        .eq("id", sessionId)
        .eq("user_id", userId);

      if (sessionUpdateErr) throw sessionUpdateErr;
    }
  }

  return { alreadyCompleted: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. completeSession
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finaliza a sessão de estudo.
 * Calcula o tempo total (gross_seconds) e o tempo líquido (net_seconds)
 * a partir das tarefas concluídas.
 *
 * Marca tarefas pendentes como 'adiada' (não foram executadas nesta sessão).
 *
 * Queries: 1 (fetch tasks) + 1 (batch update pending→adiada)
 *          + 1 (update session)
 */
export async function completeSession(input: CompleteSessionInput): Promise<SessionStatus> {
  const userId = await requireUser();
  const { sessionId, notes } = input;

  // Buscar sessão
  const { data: session, error: sessionError } = await supabase
    .from("study_sessions")
    .select("id, started_at, ended_at, questions_count, correct_count, wrong_count, notes")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (sessionError || !session) {
    throw sessionError ?? new Error("Sessão não encontrada.");
  }

  if (session.ended_at) {
    // Já concluída — retorna status atual (idempotente)
    return getSessionStatus(sessionId);
  }

  // Buscar tarefas da sessão
  const { data: tasks, error: tasksError } = await supabase
    .from("plan_tasks")
    .select("id, status, actual_minutes, planned_minutes")
    .eq("session_id", sessionId)
    .eq("user_id", userId);

  if (tasksError) throw tasksError;

  const allTasks = tasks ?? [];

  // Calcular tempo líquido (soma de actual_minutes das concluídas)
  let netMinutes = 0;
  const pendingTaskIds: string[] = [];

  for (const t of allTasks) {
    if (t.status === "concluida") {
      netMinutes += t.actual_minutes ?? 0;
    } else if (t.status === "pendente" || t.status === "em_andamento") {
      pendingTaskIds.push(t.id);
    }
  }

  // Marcar tarefas não-concluídas como 'adiada'
  if (pendingTaskIds.length > 0) {
    const { error: batchErr } = await supabase
      .from("plan_tasks")
      .update({ status: "adiada" as any })
      .in("id", pendingTaskIds)
      .eq("user_id", userId);

    if (batchErr) throw batchErr;
  }

  // Calcular tempo bruto (diferença entre started_at e agora)
  const now = new Date();
  const nowISO = now.toISOString();
  let grossSeconds = 0;

  if (session.started_at) {
    const started = new Date(session.started_at);
    grossSeconds = Math.max(0, Math.floor((now.getTime() - started.getTime()) / 1000));
  }

  const netSeconds = netMinutes * 60;

  // Atualizar sessão
  const { error: updateError } = await supabase
    .from("study_sessions")
    .update({
      ended_at: nowISO,
      gross_seconds: grossSeconds,
      net_seconds: netSeconds,
      notes: notes ?? session.notes ?? null,
    })
    .eq("id", sessionId)
    .eq("user_id", userId);

  if (updateError) throw updateError;

  return getSessionStatus(sessionId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. getSessionStatus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Consulta o estado atual de uma sessão de estudo.
 * Retorna métricas de progresso.
 *
 * Queries: 1 (session) + 1 (tasks)
 */
export async function getSessionStatus(sessionId: string): Promise<SessionStatus> {
  await requireUser();

  const { data: session, error: sessionError } = await supabase
    .from("study_sessions")
    .select("id, started_at, ended_at, gross_seconds, net_seconds")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    throw sessionError ?? new Error("Sessão não encontrada.");
  }

  const { data: tasks, error: tasksError } = await supabase
    .from("plan_tasks")
    .select("id, status, actual_minutes, planned_minutes")
    .eq("session_id", sessionId);

  if (tasksError) throw tasksError;

  const allTasks = tasks ?? [];

  let completedActivities = 0;
  let pendingActivities = 0;
  let inProgressActivities = 0;
  let totalAllocatedMinutes = 0;
  let totalActualMinutes = 0;

  for (const t of allTasks) {
    totalAllocatedMinutes += t.planned_minutes ?? 0;
    if (t.status === "concluida") {
      completedActivities += 1;
      totalActualMinutes += t.actual_minutes ?? 0;
    } else if (t.status === "em_andamento") {
      inProgressActivities += 1;
    } else if (t.status === "pendente") {
      pendingActivities += 1;
    }
  }

  let status: SessionStatus["status"] = "pending";
  if (session.ended_at) {
    status = "completed";
  } else if (session.started_at) {
    status = "in_progress";
  }

  return {
    sessionId: session.id,
    status,
    startedAt: session.started_at ?? null,
    endedAt: session.ended_at ?? null,
    grossSeconds: session.gross_seconds ?? 0,
    netSeconds: session.net_seconds ?? 0,
    totalActivities: allTasks.length,
    completedActivities,
    pendingActivities,
    inProgressActivities,
    totalAllocatedMinutes,
    totalActualMinutes,
  };
}
