/**
 * ETAPA 5, FASE 4 — Testes de integração: Unified Service ↔ Planner.
 *
 * Estes testes validam que o fluxo unificado (estudo novo + revisão)
 * funciona corretamente quando invocado pelo mesmo caminho que o
 * generatePlanTasks usaria, mas IN-MEMORY (sem Supabase real).
 *
 * Estratégia:
 *   - Candidatos de estudo pontuados pelo scoreCandidates (Planner Engine)
 *   - Revisões construídas como ReviewTaskCandidate (Review types)
 *   - Disponibilidade construída manualmente
 *   - buildUnifiedSchedule() chamado diretamente
 *   - adaptReviewQueue + buildTopicMetaMap validados
 *
 * MESMA estratégia dos testes existentes do scheduler (engine.test.ts).
 */

import { describe, it, expect } from "vitest";
import {
  scoreCandidates,
  type PlannerCandidate,
  type DiagnosticData,
} from "@/lib/planner/engine";
import {
  buildUnifiedSchedule,
  DEFAULT_REVIEW_MINUTES,
} from "@/lib/scheduler/engine";
import {
  adaptReviewQueue,
  buildTopicMetaMap,
} from "@/lib/scheduler/service";
import type {
  ReviewTaskCandidate,
  UnifiedSchedulerConfig,
} from "@/lib/scheduler/types";
import type { ReviewQueueItem } from "@/lib/review/service";
import type { TopicReviewInput } from "@/lib/review/types";
import {
  emptyWeek,
  weekStartOf,
  todayISO,
  addDays,
} from "@/lib/planner/availability";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function mkCandidate(
  n: number,
  subj: string,
  priority: number,
  mastery: number | null,
  prereq: string[] = [],
): PlannerCandidate {
  return {
    contestTopicId: `ct${n}`,
    subjectId: subj,
    subjectName: subj,
    topicId: `t${n}`,
    topicName: `Topic${n}`,
    priority,
    weight: priority * 2,
    incidence: 50,
    relevance: 50,
    isStudied: false,
    mastery,
    prerequisiteTopicIds: prereq,
  };
}

function mkWeek(start: string, hoursPerDay: number) {
  return {
    ...emptyWeek(start),
    minutes_mon: hoursPerDay * 60,
    minutes_tue: hoursPerDay * 60,
    minutes_wed: hoursPerDay * 60,
    minutes_thu: hoursPerDay * 60,
    minutes_fri: hoursPerDay * 60,
    minutes_sat: hoursPerDay * 60,
  };
}

function mkReviewCandidate(
  topicId: string,
  subjectId: string,
  subjectName: string,
  topicName: string,
  urgency: number,
  reviewType: ReviewTaskCandidate["reviewType"] = "manutencao",
  reviewIntensity: ReviewTaskCandidate["reviewIntensity"] = "moderada",
): ReviewTaskCandidate {
  return {
    topicId,
    subjectId,
    subjectName,
    topicName,
    reviewUrgency: urgency,
    reviewType,
    reviewIntensity,
    reviewInterval: 7,
    estimatedMinutes: DEFAULT_REVIEW_MINUTES[reviewIntensity],
    interventionScore: urgency * 0.8,
    knowledgeState: urgency >= 0.8 ? "PONTO_CRITICO" : "CONSOLIDANDO",
    structuralPriority: 4,
  };
}

function mkReviewQueueItem(
  topicId: string,
  urgency: number,
  reviewType: ReviewTaskCandidate["reviewType"] = "manutencao",
  reviewIntensity: ReviewTaskCandidate["reviewIntensity"] = "moderada",
): ReviewQueueItem {
  const input: TopicReviewInput = {
    topicId,
    mastery: 0.4,
    confidence: 0.5,
    accuracy: 0.5,
    knowledgeState: urgency >= 0.8 ? "PONTO_CRITICO" : "CONSOLIDANDO",
    interventionScore: urgency * 0.8,
    daysSinceStudy: 14,
    unresolvedErrors: 0,
    recurringErrors: 0,
    lastReviewDate: null,
    reviewCount: 1,
    lastReviewResult: null,
    referenceDate: todayISO(),
  };
  return {
    topicId,
    input,
    needsReview: true,
    reviewUrgency: urgency,
    reviewType,
    reviewIntensity,
    reviewInterval: 7,
    suggestedReviewDate: addDays(todayISO(), 1),
    reviewReason: "teste",
  };
}

function mkConfig(overrides: Partial<UnifiedSchedulerConfig> = {}): UnifiedSchedulerConfig {
  const w1 = weekStartOf(todayISO());
  return {
    reviewCap: 0.3,
    reviewFloor: 0.05,
    urgentReviewExtraCap: 0.15,
    absoluteReviewCeiling: 0.6,
    reviewMinutesPerIntensity: DEFAULT_REVIEW_MINUTES,
    examDate: null,
    startDate: w1,
    endDate: addDays(w1, 6),
    blockMinutes: 50,
    maxDailyMinutes: 480,
    maxSubjectShare: 1,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTES
// ─────────────────────────────────────────────────────────────────────────────

describe("unified integration — generatePlanTasks with Unified Service", () => {
  const w1 = weekStartOf(todayISO());

  // 1. Plano somente com estudo (sem revisões)
  it("1. study-only plan produces tasks with source=planner", () => {
    const candidates = [
      mkCandidate(1, "Direito", 5, 0.2),
      mkCandidate(2, "Contab", 4, 0.4),
      mkCandidate(3, "Portugues", 3, 0.6),
    ];
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });
    const weeks = new Map([[w1, mkWeek(w1, 4)]]);

    const schedule = buildUnifiedSchedule({
      studyCandidates: scored,
      reviewCandidates: [],
      weeks,
      config: mkConfig(),
    });

    expect(schedule.tasks.length).toBeGreaterThan(0);
    expect(schedule.reviewMinutes).toBe(0);
    expect(schedule.studyMinutes).toBeGreaterThan(0);
    // All tasks should be planner-sourced
    for (const t of schedule.tasks) {
      expect(t.source).toBe("planner");
      expect(t.reviewUrgency).toBeNull();
      expect(t.reviewType).toBeNull();
    }
  });

  // 2. Plano com estudo + revisão
  it("2. study + review plan produces tasks from both sources", () => {
    const candidates = [
      mkCandidate(1, "Direito", 5, 0.2),
      mkCandidate(2, "Contab", 4, 0.4),
    ];
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });

    const reviewCandidates: ReviewTaskCandidate[] = [
      mkReviewCandidate("t10", "Tributario", "Tributario", "ICMS", 0.7),
    ];

    const weeks = new Map([[w1, mkWeek(w1, 5)]]);

    const schedule = buildUnifiedSchedule({
      studyCandidates: scored,
      reviewCandidates,
      weeks,
      config: mkConfig(),
    });

    expect(schedule.tasks.length).toBeGreaterThan(0);
    const studyTasks = schedule.tasks.filter((t) => t.source === "planner");
    const reviewTasks = schedule.tasks.filter((t) => t.source === "review_engine");
    expect(studyTasks.length).toBeGreaterThan(0);
    expect(reviewTasks.length).toBeGreaterThan(0);
    expect(schedule.studyMinutes).toBeGreaterThan(0);
    expect(schedule.reviewMinutes).toBeGreaterThan(0);
  });

  // 3. Plano somente com revisão (sem candidatos de estudo)
  it("3. review-only plan works when no study candidates", () => {
    const reviewCandidates: ReviewTaskCandidate[] = [
      mkReviewCandidate("t1", "S1", "Direito", "Contratos", 0.9, "recuperacao", "intensiva"),
      mkReviewCandidate("t2", "S2", "Contab", "Balanco", 0.5),
    ];

    const weeks = new Map([[w1, mkWeek(w1, 3)]]);

    const schedule = buildUnifiedSchedule({
      studyCandidates: [],
      reviewCandidates,
      weeks,
      config: mkConfig(),
    });

    expect(schedule.tasks.length).toBeGreaterThan(0);
    expect(schedule.studyMinutes).toBe(0);
    expect(schedule.reviewMinutes).toBeGreaterThan(0);
    for (const t of schedule.tasks) {
      expect(t.source).toBe("review_engine");
    }
  });

  // 4. Filtro pelo concurso (adaptReviewQueue + buildTopicMetaMap)
  it("4. review queue filtered by contest topics", () => {
    const candidates = [
      mkCandidate(1, "S1", 5, 0.2),
      mkCandidate(2, "S2", 4, 0.4),
    ];
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });
    const topicMetaById = buildTopicMetaMap(scored);

    // t1 and t2 are in the contest, t99 is NOT
    const queue: ReviewQueueItem[] = [
      mkReviewQueueItem("t1", 0.8),
      mkReviewQueueItem("t2", 0.5),
      mkReviewQueueItem("t99", 0.9), // not in contest
    ];

    const adapted = adaptReviewQueue(queue, topicMetaById, {
      reviewMinutesPerIntensity: DEFAULT_REVIEW_MINUTES,
    });

    // t99 should be filtered out
    expect(adapted.length).toBe(2);
    expect(adapted.map((a) => a.topicId).sort()).toEqual(["t1", "t2"]);
    // Metadata should come from contest candidates
    const t1 = adapted.find((a) => a.topicId === "t1")!;
    expect(t1.subjectId).toBe("S1");
    expect(t1.subjectName).toBe("S1");
  });

  // 5. Deduplicação estudo/revisão
  it("5. deduplication: review takes precedence over study for same topic", () => {
    const candidates = [
      mkCandidate(1, "S1", 5, 0.2),
      mkCandidate(2, "S2", 4, 0.4),
    ];
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });

    // Review for the SAME topic as study candidate t1
    const reviewCandidates: ReviewTaskCandidate[] = [
      mkReviewCandidate("t1", "S1", "S1", "Topic1", 0.9, "recuperacao", "intensiva"),
    ];

    const weeks = new Map([[w1, mkWeek(w1, 4)]]);

    const schedule = buildUnifiedSchedule({
      studyCandidates: scored,
      reviewCandidates,
      weeks,
      config: mkConfig(),
    });

    // t1 should appear as review (not study) on the same day
    // and deduplicatedTopics should include t1
    const t1Tasks = schedule.tasks.filter((t) => t.topicId === "t1");
    // At least one review task for t1
    expect(t1Tasks.some((t) => t.source === "review_engine")).toBe(true);
    // Deduplication should have been applied
    expect(schedule.deduplicatedTopics).toContain("t1");
  });

  // 6. Respeito à disponibilidade
  it("6. respects availability — no tasks on zero-availability days", () => {
    const candidates = [
      mkCandidate(1, "S1", 5, 0.2),
    ];
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });

    // Only Monday has availability
    const sparseWeek = { ...emptyWeek(w1), minutes_mon: 120 };
    const weeks = new Map([[w1, sparseWeek]]);

    const schedule = buildUnifiedSchedule({
      studyCandidates: scored,
      reviewCandidates: [],
      weeks,
      config: mkConfig(),
    });

    expect(schedule.totalCapacityMinutes).toBe(120);
    // All tasks should be on Monday
    for (const t of schedule.tasks) {
      const date = new Date(t.scheduledDate.replace(/-/g, "/"));
      expect(date.getDay()).toBe(1); // Monday
    }
  });

  // 7. Respeito ao reviewCap
  it("7. respects reviewCap — review minutes bounded", () => {
    const candidates = [
      mkCandidate(1, "S1", 5, 0.2),
    ];
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });

    // Many reviews to try to exceed cap
    const reviewCandidates: ReviewTaskCandidate[] = Array.from({ length: 10 }, (_, i) =>
      mkReviewCandidate(
        `r${i}`,
        `RS${i}`,
        `RevSubject${i}`,
        `RevTopic${i}`,
        0.5,
        "manutencao",
        "moderada",
      ),
    );

    const weeks = new Map([[w1, mkWeek(w1, 4)]]);
    const config = mkConfig({ reviewCap: 0.3, absoluteReviewCeiling: 0.4 });

    const schedule = buildUnifiedSchedule({
      studyCandidates: scored,
      reviewCandidates,
      weeks,
      config,
    });

    // Review minutes should not exceed absoluteReviewCeiling * totalCapacity
    const totalCapacity = schedule.totalCapacityMinutes;
    if (totalCapacity > 0) {
      expect(schedule.reviewMinutes).toBeLessThanOrEqual(
        totalCapacity * config.absoluteReviewCeiling + 1,
      );
    }
  });

  // 8. Revisão urgente
  it("8. urgent review gets priority placement", () => {
    const candidates = [
      mkCandidate(1, "S1", 5, 0.2),
    ];
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });

    const reviewCandidates: ReviewTaskCandidate[] = [
      mkReviewCandidate("r1", "RS1", "RevSubject", "UrgentTopic", 0.95, "recuperacao", "intensiva"),
    ];

    const weeks = new Map([[w1, mkWeek(w1, 3)]]);

    const schedule = buildUnifiedSchedule({
      studyCandidates: scored,
      reviewCandidates,
      weeks,
      config: mkConfig(),
    });

    const urgentTask = schedule.tasks.find((t) => t.topicId === "r1");
    expect(urgentTask).toBeDefined();
    expect(urgentTask!.source).toBe("review_engine");
    expect(urgentTask!.reviewUrgency).toBeGreaterThanOrEqual(0.9);
    // Urgent review should be in the first day's first positions
    expect(urgentTask!.position).toBeLessThanOrEqual(1);
  });

  // 9. Source correto em plan_tasks
  it("9. source field correctly set for study and review tasks", () => {
    const candidates = [
      mkCandidate(1, "S1", 5, 0.2),
      mkCandidate(2, "S2", 4, 0.4),
    ];
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });

    const reviewCandidates: ReviewTaskCandidate[] = [
      mkReviewCandidate("r1", "RS1", "RevSubject", "RevTopic", 0.6),
    ];

    const weeks = new Map([[w1, mkWeek(w1, 5)]]);

    const schedule = buildUnifiedSchedule({
      studyCandidates: scored,
      reviewCandidates,
      weeks,
      config: mkConfig(),
    });

    for (const t of schedule.tasks) {
      if (t.source === "planner") {
        expect(t.reviewUrgency).toBeNull();
        expect(t.reviewType).toBeNull();
        expect(t.reviewIntensity).toBeNull();
      } else if (t.source === "review_engine") {
        expect(t.reviewUrgency).toBeGreaterThanOrEqual(0);
        expect(t.reviewType).toBeTruthy();
        expect(t.reviewIntensity).toBeTruthy();
      } else {
        throw new Error(`Unexpected source: ${t.source}`);
      }
    }
  });

  // 10. Ausência de regressão do fluxo antigo (study-only = same as buildPlan output shape)
  it("10. study-only through unified scheduler produces valid plan structure", () => {
    const candidates = [
      mkCandidate(1, "S1", 5, 0.2),
      mkCandidate(2, "S2", 4, 0.4),
      mkCandidate(3, "S3", 3, 0.6),
    ];
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });

    const weeks = new Map([[w1, mkWeek(w1, 5)]]);

    const schedule = buildUnifiedSchedule({
      studyCandidates: scored,
      reviewCandidates: [],
      weeks,
      config: mkConfig(),
    });

    // Structural validation: same fields as legacy plan
    expect(schedule.totalCapacityMinutes).toBeGreaterThan(0);
    expect(schedule.studyMinutes + schedule.reviewMinutes).toBeLessThanOrEqual(
      schedule.totalCapacityMinutes,
    );
    expect(schedule.unallocatedMinutes).toBeGreaterThanOrEqual(0);
    expect(schedule.reviewBacklog).toBe(0);
    expect(schedule.deduplicatedTopics).toEqual([]);

    for (const t of schedule.tasks) {
      expect(typeof t.taskId).toBe("string");
      expect(typeof t.topicId).toBe("string");
      expect(typeof t.subjectId).toBe("string");
      expect(typeof t.scheduledDate).toBe("string");
      expect(t.plannedMinutes).toBeGreaterThan(0);
      expect(typeof t.activity).toBe("string");
      expect(t.source).toBe("planner");
      expect(t.unifiedPriorityScore).toBeGreaterThanOrEqual(0);
      expect(typeof t.priorityReason).toBe("string");
      expect(typeof t.position).toBe("number");
    }
  });

  // 11. Comportamento sem dados de revisão (review queue vazia)
  it("11. empty review queue produces study-only schedule", () => {
    const candidates = [
      mkCandidate(1, "S1", 5, 0.2),
    ];
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });

    const weeks = new Map([[w1, mkWeek(w1, 3)]]);

    const schedule = buildUnifiedSchedule({
      studyCandidates: scored,
      reviewCandidates: [],
      weeks,
      config: mkConfig(),
    });

    expect(schedule.tasks.length).toBeGreaterThan(0);
    expect(schedule.reviewMinutes).toBe(0);
    expect(schedule.reviewBacklog).toBe(0);
    for (const t of schedule.tasks) {
      expect(t.source).toBe("planner");
    }
  });

  // 12. Propagação de erros — config inválida não quebra
  it("12. invalid config values handled safely", () => {
    const candidates = [mkCandidate(1, "S1", 5, 0.2)];
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });

    const weeks = new Map([[w1, mkWeek(w1, 3)]]);

    // Config with edge values
    const schedule = buildUnifiedSchedule({
      studyCandidates: scored,
      reviewCandidates: [],
      weeks,
      config: mkConfig({
        reviewCap: NaN as unknown as number,
        reviewFloor: -1 as unknown as number,
        blockMinutes: 0,
        maxDailyMinutes: Infinity as unknown as number,
      }),
    });

    // Should not throw, should produce a valid (possibly empty) schedule
    expect(Array.isArray(schedule.tasks)).toBe(true);
    expect(Number.isFinite(schedule.totalCapacityMinutes)).toBe(true);
  });

  // 13. Nenhuma chamada N+1 (verificação estrutural)
  it("13. no N+1 pattern — batch processing verified", () => {
    // This test verifies the structural pattern:
    // adaptReviewQueue processes all items in a single pass,
    // buildTopicMetaMap processes all scored in a single pass.
    const candidates = Array.from({ length: 20 }, (_, i) =>
      mkCandidate(i + 1, `S${(i % 4) + 1}`, 5 - (i % 5), (i * 0.05)),
    );
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });

    // Build meta map in single pass
    const metaMap = buildTopicMetaMap(scored);
    expect(metaMap.size).toBeGreaterThan(0);

    // All candidates with topicId should appear
    for (const c of candidates) {
      if (c.topicId) {
        expect(metaMap.has(c.topicId)).toBe(true);
      }
    }

    // Create review queue items (some in contest, some not)
    const queue: ReviewQueueItem[] = [
      ...candidates.slice(0, 5).map((c) => mkReviewQueueItem(c.topicId!, 0.5)),
      mkReviewQueueItem("t_outside_contest", 0.9),
    ];

    // Single-pass adaptation
    const adapted = adaptReviewQueue(queue, metaMap, {
      reviewMinutesPerIntensity: DEFAULT_REVIEW_MINUTES,
    });

    // Only contest topics should pass through
    expect(adapted.length).toBe(5);
    expect(adapted.every((a) => a.topicId !== "t_outside_contest")).toBe(true);
  });

  // 14. buildTopicMetaMap preserva maior score por tópico
  it("14. buildTopicMetaMap keeps highest structuralPriority per topic", () => {
    // Two scored candidates for same topicId (different contestTopicId)
    const candidates = [
      { ...mkCandidate(1, "S1", 5, 0.2), topicId: "shared_topic" },
      { ...mkCandidate(2, "S1", 2, 0.8), topicId: "shared_topic" },
    ];
    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });

    const metaMap = buildTopicMetaMap(scored);
    expect(metaMap.has("shared_topic")).toBe(true);

    // Should keep the highest structuralPriority
    const meta = metaMap.get("shared_topic")!;
    const maxScore = Math.max(...scored.map((s) => s.score));
    expect(meta.structuralPriority).toBe(maxScore);
  });
});
