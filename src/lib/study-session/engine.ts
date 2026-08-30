/**
 * MOTOR DE SESSÃO DE ESTUDO — Fase 1
 *
 * Recebe tarefas já planejadas pelo Planner/Unified Scheduler e as
 * transforma em uma sequência ordenada de atividades para uma sessão
 * de estudo, respeitando:
 *   - Duração disponível
 *   - Prioridade de cada tarefa
 *   - Tipo de atividade (revisão vs estudo novo)
 *   - Teto de participação por matéria
 *   - Intercalação ou agrupamento de matérias
 *
 * REGRAS DE PUREZA:
 *   Sem Supabase, sem queries, sem Date.now(), sem Math.random(),
 *   sem efeitos colaterais. Mesmos inputs → mesma saída, sempre.
 *
 * O QUE O MOTOR NÃO FAZ:
 *   Não recalcula scores, mastery, urgência nem intervalo de revisão.
 *   Todos esses valores são consumidos como dados de entrada.
 */

import type {
  SessionTaskInput,
  SessionConfig,
  SessionActivity,
  SessionResult,
  DiscardedTask,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  availableMinutes: 120,
  minActivityMinutes: 10,
  maxSubjectShare: 0.5,
  interleaveSubjects: true,
  ordering: "review_first",
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Garante número finito, com fallback seguro. */
function safeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Limita ao intervalo 0..1. */
function safeUnit(value: unknown, fallback = 0): number {
  const n = safeNumber(value, fallback);
  return Math.max(0, Math.min(1, n));
}

/**
 * Chave de ordenação: menor = mais cedo na sessão.
 *
 * Com ordering = "review_first":
 *   - revisões urgentes (urgency >= 0.8): tier 0
 *   - revisões normais: tier 1
 *   - estudo novo: tier 2
 *
 * Com ordering = "study_first":
 *   - estudo novo: tier 0
 *   - revisões urgentes: tier 1
 *   - revisões normais: tier 2
 *
 * Com ordering = "priority":
 *   - tudo no tier 0 (desempate pelo priorityScore)
 */
function orderingTier(task: SessionTaskInput, ordering: SessionConfig["ordering"]): number {
  const isReview = task.source === "review_engine";
  const isUrgent = isReview && safeNumber(task.reviewUrgency) >= 0.8;

  if (ordering === "priority") return 0;

  if (ordering === "review_first") {
    if (isUrgent) return 0;
    if (isReview) return 1;
    return 2;
  }

  // study_first
  if (!isReview) return 0;
  if (isUrgent) return 1;
  return 2;
}

/**
 * Comparador determinístico para duas tarefas.
 * 1. tier (da estratégia de ordering)
 * 2. priorityScore desc
 * 3. topicId asc (desempate estável)
 */
function compareTasksFactory(
  ordering: SessionConfig["ordering"],
): (a: SessionTaskInput, b: SessionTaskInput) => number {
  return (a, b) => {
    const tierA = orderingTier(a, ordering);
    const tierB = orderingTier(b, ordering);
    if (tierA !== tierB) return tierA - tierB;

    const scoreA = safeNumber(a.priorityScore);
    const scoreB = safeNumber(b.priorityScore);
    if (scoreA !== scoreB) return scoreB - scoreA;

    return a.topicId.localeCompare(b.topicId);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERLEAVE (round-robin por matéria)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Intercala tarefas de matérias diferentes em round-robin.
 * Dentro de cada matéria, a ordem interna é preservada.
 * Matérias com maior score total vêm primeiro no ciclo.
 */
function interleave(sorted: SessionTaskInput[]): SessionTaskInput[] {
  // Agrupa por matéria preservando a ordem interna.
  const bySubject = new Map<string, SessionTaskInput[]>();
  const subjectScoreSum = new Map<string, number>();

  for (const t of sorted) {
    if (!bySubject.has(t.subjectId)) bySubject.set(t.subjectId, []);
    bySubject.get(t.subjectId)!.push(t);
    subjectScoreSum.set(
      t.subjectId,
      (subjectScoreSum.get(t.subjectId) ?? 0) + safeNumber(t.priorityScore),
    );
  }

  // Ordena matérias por score total desc, depois subjectId asc.
  const orderedSubjects = Array.from(bySubject.keys()).sort((a, b) => {
    const diff = (subjectScoreSum.get(b) ?? 0) - (subjectScoreSum.get(a) ?? 0);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });

  const result: SessionTaskInput[] = [];
  let rotation = 0;
  const remaining = new Map(bySubject);

  while (remaining.size > 0 && result.length < sorted.length) {
    const subjectId = orderedSubjects[rotation % orderedSubjects.length]!;
    rotation += 1;
    const queue = remaining.get(subjectId);
    if (!queue || queue.length === 0) {
      remaining.delete(subjectId);
      continue;
    }
    result.push(queue.shift()!);
    if (queue.length === 0) remaining.delete(subjectId);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constrói a sequência de atividades para uma sessão de estudo.
 *
 * Algoritmo:
 *  1. Valida entradas; descarta tarefas inválidas.
 *  2. Ordena as tarefas pela estratégia de ordering.
 *  3. Se interleaveSubjects, aplica round-robin por matéria.
 *  4. Percorre a fila, alocando minutos até esgotar a disponibilidade.
 *     - Respeita o teto de participação por matéria.
 *     - Tarefas que não cabem inteiras recebem minutos parciais
 *       (se >= minActivityMinutes), senão são descartadas.
 *  5. Retorna o resultado com métricas.
 *
 * Esta função é PURA: mesmos inputs → mesma saída, sempre.
 */
export function buildSession(
  tasks: SessionTaskInput[],
  config: Partial<SessionConfig> = {},
): SessionResult {
  const cfg: SessionConfig = { ...DEFAULT_SESSION_CONFIG, ...config };
  const warnings: string[] = [];
  const discarded: DiscardedTask[] = [];

  const available = Math.max(0, safeNumber(cfg.availableMinutes, 0));
  const minActivity = Math.max(1, safeNumber(cfg.minActivityMinutes, 10));
  const maxShare = safeUnit(cfg.maxSubjectShare, 0.5);

  // ── Validação de entrada ──────────────────────────────────────────────
  if (available <= 0) {
    if (tasks.length > 0) {
      warnings.push("Sem tempo disponível para a sessão — nenhuma atividade alocada.");
    }
    return {
      activities: [],
      allocatedMinutes: 0,
      availableMinutes: available,
      unallocatedMinutes: 0,
      discardedTasks: tasks.map((t) => ({
        taskId: t.taskId,
        topicId: t.topicId,
        reason: "Sem tempo disponível.",
      })),
      warnings,
    };
  }

  // Filtra tarefas inválidas (sem taskId, topicId ou plannedMinutes <= 0).
  const valid: SessionTaskInput[] = [];
  for (const t of tasks) {
    if (!t.taskId || !t.topicId) {
      discarded.push({
        taskId: t.taskId ?? "(vazio)",
        topicId: t.topicId ?? "(vazio)",
        reason: "Tarefa sem taskId ou topicId válido.",
      });
      continue;
    }
    const planned = safeNumber(t.plannedMinutes, 0);
    if (planned < minActivity) {
      discarded.push({
        taskId: t.taskId,
        topicId: t.topicId,
        reason: `Duração planejada (${planned}min) menor que o mínimo (${minActivity}min).`,
      });
      continue;
    }
    valid.push(t);
  }

  if (valid.length === 0) {
    if (tasks.length > 0) {
      warnings.push("Nenhuma tarefa válida para a sessão.");
    }
    return {
      activities: [],
      allocatedMinutes: 0,
      availableMinutes: available,
      unallocatedMinutes: available,
      discardedTasks: discarded,
      warnings,
    };
  }

  // ── Ordenação ─────────────────────────────────────────────────────────
  const sorted = [...valid].sort(compareTasksFactory(cfg.ordering));

  // ── Intercalação (opcional) ───────────────────────────────────────────
  const ordered = cfg.interleaveSubjects ? interleave(sorted) : sorted;

  // ── Alocação de minutos ──────────────────────────────────────────────
  const activities: SessionActivity[] = [];
  let remaining = available;
  const subjectMinutes = new Map<string, number>();
  const subjectLimit = maxShare >= 1 ? Infinity : available * maxShare;

  for (const task of ordered) {
    if (remaining < minActivity) {
      discarded.push({
        taskId: task.taskId,
        topicId: task.topicId,
        reason: `Tempo restante (${remaining}min) insuficiente.`,
      });
      continue;
    }

    // Verificar teto por matéria.
    const usedBySubject = subjectMinutes.get(task.subjectId) ?? 0;
    const subjectRoom = Math.max(0, subjectLimit - usedBySubject);
    if (subjectRoom < minActivity) {
      discarded.push({
        taskId: task.taskId,
        topicId: task.topicId,
        reason: `Teto de matéria "${task.subjectName}" atingido (${usedBySubject}/${Math.round(subjectLimit)}min).`,
      });
      continue;
    }

    const planned = safeNumber(task.plannedMinutes, 0);
    const allocated = Math.min(planned, remaining, subjectRoom);

    if (allocated < minActivity) {
      discarded.push({
        taskId: task.taskId,
        topicId: task.topicId,
        reason: `Minutos alocáveis (${allocated}min) abaixo do mínimo (${minActivity}min).`,
      });
      continue;
    }

    activities.push({
      taskId: task.taskId,
      topicId: task.topicId,
      subjectId: task.subjectId,
      subjectName: task.subjectName,
      topicName: task.topicName,
      activity: task.activity,
      source: task.source,
      allocatedMinutes: allocated,
      plannedMinutes: planned,
      priorityScore: safeNumber(task.priorityScore),
      priorityReason: task.priorityReason,
      position: activities.length,
      reviewUrgency: task.source === "review_engine" ? safeNumber(task.reviewUrgency) : null,
      reviewType: task.reviewType ?? null,
      reviewIntensity: task.reviewIntensity ?? null,
    });

    remaining -= allocated;
    subjectMinutes.set(task.subjectId, usedBySubject + allocated);
  }

  // ── Tarefas que sobraram da fila (não processadas pelo loop) ──────────
  // O loop já captura todas via discarded dentro do for.

  const allocatedMinutes = activities.reduce((sum, a) => sum + a.allocatedMinutes, 0);

  if (discarded.length > 0 && activities.length > 0) {
    warnings.push(`${discarded.length} tarefa(s) não couberam na sessão de ${available}min.`);
  }

  return {
    activities,
    allocatedMinutes,
    availableMinutes: available,
    unallocatedMinutes: Math.max(0, available - allocatedMinutes),
    discardedTasks: discarded,
    warnings,
  };
}
