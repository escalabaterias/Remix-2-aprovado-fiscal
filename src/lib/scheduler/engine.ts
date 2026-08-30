/**
 * UNIFIED SCHEDULER — Etapa 5, Fase 2 (motor puro)
 *
 * Une, em uma única agenda determinística:
 *   - estudo novo (candidatos JÁ pontuados pelo Planner);
 *   - revisões (candidatos JÁ calculados pelo Review Engine);
 *   - disponibilidade diária/semanal;
 *   - deduplicação por tópico+dia;
 *   - teto de tempo destinado à revisão.
 *
 * REGRAS DE PUREZA
 *   Sem Supabase, sem queries, sem Date.now(), sem Math.random(),
 *   sem efeitos colaterais. Mesmos inputs → mesma saída, sempre.
 *
 * O QUE O SCHEDULER NÃO FAZ
 *   Não recalcula mastery, confidence, knowledgeState, interventionScore,
 *   reviewUrgency, reviewInterval, reviewType, reviewIntensity nem o score
 *   do Planner. Todos esses valores são consumidos como dados de entrada.
 */

import {
  addDays,
  availableMinutesOn,
  daysBetween,
  type AvailabilityWeek,
} from "../planner/availability";
import { chooseActivity, type ActivityKind, type ScoredCandidate } from "../planner/engine";
import type {
  ReviewTaskCandidate,
  UnifiedSchedulerConfig,
  UnifiedSchedulerResult,
  UnifiedTask,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES DA POLÍTICA APROVADA
// ─────────────────────────────────────────────────────────────────────────────

/** Pesos do unified priority score de revisão. */
export const REVIEW_UPS_WEIGHTS = {
  urgency: 0.45,
  intervention: 0.25,
  structural: 0.2,
  examProximity: 0.1,
} as const;

/** Escala que traz o UPS de revisão para a ordem de grandeza do Planner. */
export const REVIEW_UPS_SCALE = 8;

/** Urgência mínima para acessar a capacidade extra de revisão. */
export const URGENT_REVIEW_THRESHOLD = 0.8;

export const DEFAULT_SCHEDULER_LIMITS = {
  reviewCap: 0.3,
  reviewFloor: 0.05,
  urgentReviewExtraCap: 0.15,
  absoluteReviewCeiling: 0.6,
} as const;

export const DEFAULT_REVIEW_MINUTES: Record<"leve" | "moderada" | "intensiva", number> = {
  leve: 20,
  moderada: 35,
  intensiva: 50,
};

// ─────────────────────────────────────────────────────────────────────────────
// ENTRADA
// ─────────────────────────────────────────────────────────────────────────────

export type UnifiedSchedulerInput = {
  /** Candidatos de estudo novo, já pontuados pelo Planner. */
  studyCandidates: ScoredCandidate[];
  /** Fila de revisão, já calculada pelo Review Engine. */
  reviewCandidates: ReviewTaskCandidate[];
  /** Disponibilidade por semana (chave = week_start). */
  weeks: Map<string, AvailabilityWeek>;
  /** Configuração do scheduler. */
  config: UnifiedSchedulerConfig;
  /** Bloco mínimo aceitável em minutos (opcional). */
  minBlockMinutes?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS NUMÉRICOS / TEMPORAIS SEGUROS
// ─────────────────────────────────────────────────────────────────────────────

/** Converte qualquer entrada numérica em número finito, com fallback seguro. */
export function safeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Limita um número ao intervalo 0..1, tratando NaN/Infinity. */
export function safeUnit(value: unknown, fallback = 0): number {
  const n = safeNumber(value, fallback);
  return Math.max(0, Math.min(1, n));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida uma data ISO (YYYY-MM-DD) real. */
export function isValidISODate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

/**
 * Bônus de proximidade da prova (0..1), alinhado às faixas já usadas pelo
 * Planner (<=15 dias, <=60 dias). Sem data válida o bônus é 0.
 */
export function computeExamProximityBonus(startDate: string, examDate: string | null): number {
  if (!isValidISODate(startDate) || !examDate || !isValidISODate(examDate)) return 0;
  const days = daysBetween(startDate, examDate);
  if (!Number.isFinite(days)) return 0;
  if (days <= 0) return 1;
  if (days <= 15) return 1;
  if (days <= 60) return 0.5;
  if (days <= 120) return 0.25;
  return 0;
}

/** UPS de revisão, já escalado para a ordem de grandeza do Planner. */
export function computeReviewUps(
  candidate: Pick<
    ReviewTaskCandidate,
    "reviewUrgency" | "interventionScore" | "structuralPriority"
  >,
  examProximityBonus: number,
): number {
  const urgency = safeUnit(candidate.reviewUrgency);
  const intervention = safeUnit(candidate.interventionScore);
  // structuralPriority vem do Planner (escala ~0..8): normalizado para 0..1.
  const structural = safeUnit(safeNumber(candidate.structuralPriority) / 8);
  const exam = safeUnit(examProximityBonus);
  const raw =
    REVIEW_UPS_WEIGHTS.urgency * urgency +
    REVIEW_UPS_WEIGHTS.intervention * intervention +
    REVIEW_UPS_WEIGHTS.structural * structural +
    REVIEW_UPS_WEIGHTS.examProximity * exam;
  return safeNumber(raw, 0) * REVIEW_UPS_SCALE;
}

/** Atividade determinística para uma revisão. */
export function reviewActivity(reviewType: ReviewTaskCandidate["reviewType"]): ActivityKind {
  if (reviewType === "erro_direcionado") return "exercicios";
  if (reviewType === "recuperacao") return "estudo_dirigido";
  return "revisao";
}

/** Minutos estimados de uma revisão, conforme configuração. */
export function reviewMinutesFor(
  candidate: ReviewTaskCandidate,
  config: UnifiedSchedulerConfig,
): number {
  const table = config.reviewMinutesPerIntensity ?? DEFAULT_REVIEW_MINUTES;
  const intensity = candidate.reviewIntensity;
  const fromConfig = safeNumber(
    table[intensity as keyof typeof table],
    DEFAULT_REVIEW_MINUTES[intensity] ?? DEFAULT_REVIEW_MINUTES.moderada,
  );
  const explicit = safeNumber(candidate.estimatedMinutes, 0);
  const minutes = explicit > 0 ? explicit : fromConfig;
  return Math.max(5, Math.round(minutes));
}

/** Camada de precedência (menor = mais cedo) para desempate determinístico. */
function precedenceTier(item: QueueItem, examBonus: number): number {
  if (item.kind === "review") {
    if (item.urgency >= URGENT_REVIEW_THRESHOLD) return 0;
    if (item.reviewType === "recuperacao" || item.reviewType === "erro_direcionado") return 2;
    return 4;
  }
  // estudo novo de alta prioridade com prova muito próxima
  if (examBonus >= 1 && item.ups >= 5) return 1;
  return 3;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILA INTERNA
// ─────────────────────────────────────────────────────────────────────────────

type QueueItem = {
  kind: "study" | "review";
  topicId: string;
  subjectId: string;
  subjectName: string;
  topicName: string;
  ups: number;
  minutes: number;
  urgency: number;
  reviewType: ReviewTaskCandidate["reviewType"] | null;
  reviewIntensity: ReviewTaskCandidate["reviewIntensity"] | null;
  activity: ActivityKind;
  priorityReason: string;
  order: number;
};

function buildDays(
  input: UnifiedSchedulerInput,
  minBlock: number,
): { date: string; capacity: number }[] {
  const { config, weeks } = input;
  const days: { date: string; capacity: number }[] = [];
  if (!isValidISODate(config.startDate) || !isValidISODate(config.endDate)) return days;
  if (config.endDate < config.startDate) return days;
  const maxDaily = Math.max(0, safeNumber(config.maxDailyMinutes, 0));
  let cursor = config.startDate;
  let guard = 0;
  while (cursor <= config.endDate && guard < 800) {
    const capacity = Math.max(
      0,
      Math.min(safeNumber(availableMinutesOn(cursor, weeks), 0), maxDaily),
    );
    if (capacity >= minBlock) days.push({ date: cursor, capacity });
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return days;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export function buildUnifiedSchedule(input: UnifiedSchedulerInput): UnifiedSchedulerResult {
  const { config } = input;
  const warnings: string[] = [];

  const blockMinutes = Math.max(10, safeNumber(config.blockMinutes, 50));
  const minBlock = Math.max(5, Math.min(safeNumber(input.minBlockMinutes, 20), blockMinutes));

  const reviewCap = safeUnit(config.reviewCap, DEFAULT_SCHEDULER_LIMITS.reviewCap);
  const reviewFloor = safeUnit(config.reviewFloor, DEFAULT_SCHEDULER_LIMITS.reviewFloor);
  const urgentExtra = safeUnit(
    config.urgentReviewExtraCap,
    DEFAULT_SCHEDULER_LIMITS.urgentReviewExtraCap,
  );
  const absoluteCeiling = safeUnit(
    config.absoluteReviewCeiling,
    DEFAULT_SCHEDULER_LIMITS.absoluteReviewCeiling,
  );
  const maxSubjectShare = (() => {
    const raw = safeNumber(config.maxSubjectShare, 1);
    return raw > 0 && raw <= 1 ? raw : 1;
  })();

  const examBonus = computeExamProximityBonus(config.startDate, config.examDate ?? null);

  const days = buildDays(input, minBlock);
  const totalCapacityMinutes = days.reduce((sum, d) => sum + d.capacity, 0);

  // ── Fila de revisão (urgência desc, depois UPS desc, depois topicId) ──
  const reviewQueue: QueueItem[] = input.reviewCandidates
    .filter((c) => typeof c.topicId === "string" && c.topicId.length > 0)
    .map((c, index) => {
      const urgency = safeUnit(c.reviewUrgency);
      const ups = computeReviewUps(c, examBonus);
      return {
        kind: "review" as const,
        topicId: c.topicId,
        subjectId: c.subjectId ?? "",
        subjectName: c.subjectName ?? "",
        topicName: c.topicName ?? "",
        ups,
        minutes: reviewMinutesFor(c, config),
        urgency,
        reviewType: c.reviewType,
        reviewIntensity: c.reviewIntensity,
        activity: reviewActivity(c.reviewType),
        priorityReason: `Revisão ${c.reviewType} (intensidade ${c.reviewIntensity}) com urgência ${urgency.toFixed(2)}.`,
        order: index,
      };
    })
    .sort(
      (a, b) =>
        b.urgency - a.urgency ||
        b.ups - a.ups ||
        a.topicId.localeCompare(b.topicId) ||
        a.order - b.order,
    );

  // ── Fila de estudo novo (score do Planner preservado) ──
  const studyQueue: QueueItem[] = input.studyCandidates
    .filter((c) => typeof c.topicId === "string" && c.topicId.length > 0)
    .map((c, index) => {
      const ups = Math.max(0, safeNumber(c.score, 0));
      const activity = chooseActivity(
        c,
        index,
        config.examDate && isValidISODate(config.examDate) && isValidISODate(config.startDate)
          ? daysBetween(config.startDate, config.examDate)
          : null,
      );
      return {
        kind: "study" as const,
        topicId: c.topicId as string,
        subjectId: c.subjectId,
        subjectName: c.subjectName,
        topicName: c.topicName ?? "",
        ups,
        minutes: blockMinutes,
        urgency: 0,
        reviewType: null,
        reviewIntensity: null,
        activity,
        priorityReason: c.reasons.length
          ? `Estudo novo — ${c.reasons.join("; ")}.`
          : "Estudo novo planejado pelo motor determinístico.",
        order: index,
      };
    })
    .sort((a, b) => b.ups - a.ups || a.topicId.localeCompare(b.topicId) || a.order - b.order);

  if (!days.length || totalCapacityMinutes <= 0) {
    if (reviewQueue.length) {
      warnings.push(`${reviewQueue.length} revisões pendentes excedem a disponibilidade.`);
    }
    if (studyQueue.length) {
      warnings.push("Sem disponibilidade no período — nenhuma tarefa foi agendada.");
    }
    return {
      tasks: [],
      totalCapacityMinutes: Math.max(0, totalCapacityMinutes),
      studyMinutes: 0,
      reviewMinutes: 0,
      unallocatedMinutes: Math.max(0, totalCapacityMinutes),
      deduplicatedTopics: [],
      reviewBacklog: reviewQueue.length,
      warnings,
    };
  }

  // ── Alocação dia a dia ──
  const tasks: UnifiedTask[] = [];
  const deduplicated = new Set<string>();
  const subjectMinutes = new Map<string, number>();
  const subjectLimit = maxSubjectShare >= 1 ? Infinity : totalCapacityMinutes * maxSubjectShare;

  const pendingReviews = [...reviewQueue];
  const pendingStudy = [...studyQueue];

  let studyMinutes = 0;
  let reviewMinutes = 0;

  for (const day of days) {
    let remaining = day.capacity;
    const takenTopics = new Set<string>();
    const dayItems: QueueItem[] = [];

    const baseReviewBudget = Math.max(day.capacity * reviewFloor, day.capacity * reviewCap);
    const urgentBudget = Math.min(
      day.capacity * absoluteCeiling,
      day.capacity * (reviewCap + urgentExtra),
    );
    let reviewUsed = 0;

    // 1) revisões, por urgência
    for (let i = 0; i < pendingReviews.length;) {
      const item = pendingReviews[i]!;
      if (remaining < minBlock) break;
      const budget = item.urgency >= URGENT_REVIEW_THRESHOLD ? urgentBudget : baseReviewBudget;
      const cap = Math.min(budget, day.capacity * absoluteCeiling);
      if (reviewUsed + item.minutes > cap) {
        i += 1;
        continue;
      }
      const minutes = Math.min(item.minutes, remaining);
      if (minutes < minBlock && minutes < item.minutes) {
        i += 1;
        continue;
      }
      if (takenTopics.has(item.topicId)) {
        i += 1;
        continue;
      }
      const used = subjectMinutes.get(item.subjectId) ?? 0;
      if (used + minutes > subjectLimit) {
        i += 1;
        continue;
      }
      pendingReviews.splice(i, 1);
      takenTopics.add(item.topicId);
      subjectMinutes.set(item.subjectId, used + minutes);
      reviewUsed += minutes;
      reviewMinutes += minutes;
      remaining -= minutes;
      dayItems.push({ ...item, minutes });
    }

    // 2) estudo novo no espaço restante
    for (let i = 0; i < pendingStudy.length && remaining >= minBlock;) {
      const item = pendingStudy[i]!;
      if (takenTopics.has(item.topicId)) {
        // revisão do mesmo tópico já ocupa o dia → a revisão prevalece
        deduplicated.add(item.topicId);
        pendingStudy.splice(i, 1);
        continue;
      }
      const minutes = Math.min(item.minutes, remaining);
      if (minutes < minBlock) {
        i += 1;
        continue;
      }
      const used = subjectMinutes.get(item.subjectId) ?? 0;
      if (used + minutes > subjectLimit) {
        i += 1;
        continue;
      }
      pendingStudy.splice(i, 1);
      takenTopics.add(item.topicId);
      subjectMinutes.set(item.subjectId, used + minutes);
      studyMinutes += minutes;
      remaining -= minutes;
      dayItems.push({ ...item, minutes });
    }

    // Ordenação final do dia: precedência → UPS → topicId
    dayItems.sort(
      (a, b) =>
        precedenceTier(a, examBonus) - precedenceTier(b, examBonus) ||
        b.ups - a.ups ||
        a.topicId.localeCompare(b.topicId),
    );

    dayItems.forEach((item, position) => {
      tasks.push({
        taskId: `${item.kind}:${item.topicId}:${day.date}`,
        topicId: item.topicId,
        subjectId: item.subjectId,
        subjectName: item.subjectName,
        topicName: item.topicName,
        scheduledDate: day.date,
        plannedMinutes: item.minutes,
        activity: item.activity,
        source: item.kind === "review" ? "review_engine" : "planner",
        unifiedPriorityScore: Math.round(item.ups * 1000) / 1000,
        priorityReason: item.priorityReason,
        reviewUrgency: item.kind === "review" ? item.urgency : null,
        reviewType: item.kind === "review" ? item.reviewType : null,
        reviewIntensity: item.kind === "review" ? item.reviewIntensity : null,
        position,
        blockId: null,
      });
    });
  }

  if (pendingReviews.length) {
    warnings.push(`${pendingReviews.length} revisões pendentes excedem a disponibilidade.`);
  }
  if (pendingStudy.length) {
    warnings.push(`${pendingStudy.length} tópicos de estudo novo não couberam no período.`);
  }

  const allocated = studyMinutes + reviewMinutes;

  return {
    tasks,
    totalCapacityMinutes,
    studyMinutes,
    reviewMinutes,
    unallocatedMinutes: Math.max(0, totalCapacityMinutes - allocated),
    deduplicatedTopics: Array.from(deduplicated).sort(),
    reviewBacklog: pendingReviews.length,
    warnings,
  };
}
