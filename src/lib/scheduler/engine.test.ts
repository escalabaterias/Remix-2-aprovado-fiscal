/**
 * TESTES DO UNIFIED SCHEDULER — Etapa 5, Fase 2
 * Motor puro: sem banco, sem mocks de rede.
 */

import { describe, expect, it } from "vitest";

import { emptyWeek, weekStartOf, type AvailabilityWeek } from "../planner/availability";
import type { ScoredCandidate } from "../planner/engine";
import {
  buildUnifiedSchedule,
  computeExamProximityBonus,
  computeReviewUps,
  reviewMinutesFor,
  REVIEW_UPS_SCALE,
  safeNumber,
  type UnifiedSchedulerInput,
} from "./engine";
import type { ReviewTaskCandidate, UnifiedSchedulerConfig } from "./types";

// ── Fixtures ────────────────────────────────────────────────────────────────

const START = "2026-03-02"; // segunda
const END = "2026-03-08"; // domingo

function week(minutesPerDay: number, weekStart = weekStartOf(START)): AvailabilityWeek {
  return {
    ...emptyWeek(weekStart),
    minutes_mon: minutesPerDay,
    minutes_tue: minutesPerDay,
    minutes_wed: minutesPerDay,
    minutes_thu: minutesPerDay,
    minutes_fri: minutesPerDay,
    minutes_sat: minutesPerDay,
    minutes_sun: minutesPerDay,
  };
}

function weeksMap(...ws: AvailabilityWeek[]): Map<string, AvailabilityWeek> {
  return new Map(ws.map((w) => [w.week_start, w]));
}

function config(overrides: Partial<UnifiedSchedulerConfig> = {}): UnifiedSchedulerConfig {
  return {
    reviewCap: 0.3,
    reviewFloor: 0.05,
    urgentReviewExtraCap: 0.15,
    absoluteReviewCeiling: 0.6,
    reviewMinutesPerIntensity: { leve: 20, moderada: 35, intensiva: 50 },
    examDate: null,
    startDate: START,
    endDate: END,
    blockMinutes: 50,
    maxDailyMinutes: 300,
    maxSubjectShare: 1,
    ...overrides,
  };
}

function study(id: string, score: number, subjectId = "s1"): ScoredCandidate {
  return {
    contestTopicId: `ct-${id}`,
    subjectId,
    subjectName: `Matéria ${subjectId}`,
    topicId: id,
    topicName: `Tópico ${id}`,
    priority: 3,
    weight: 5,
    incidence: 40,
    relevance: 40,
    isStudied: false,
    mastery: 0.4,
    prerequisiteTopicIds: [],
    score,
    gap: 0.6,
    blockedByPrerequisite: false,
    isPrerequisiteOfBlocked: false,
    reasons: [],
    diagnosticBoost: 0,
  };
}

function review(
  id: string,
  urgency: number,
  overrides: Partial<ReviewTaskCandidate> = {},
): ReviewTaskCandidate {
  return {
    topicId: id,
    subjectId: "s1",
    subjectName: "Matéria s1",
    topicName: `Tópico ${id}`,
    reviewUrgency: urgency,
    reviewType: "manutencao",
    reviewIntensity: "moderada",
    reviewInterval: 7,
    estimatedMinutes: 35,
    interventionScore: 0.5,
    knowledgeState: null,
    structuralPriority: 4,
    ...overrides,
  };
}

function input(overrides: Partial<UnifiedSchedulerInput> = {}): UnifiedSchedulerInput {
  return {
    studyCandidates: [],
    reviewCandidates: [],
    weeks: weeksMap(week(200)),
    config: config(),
    ...overrides,
  };
}

// ── Testes ──────────────────────────────────────────────────────────────────

describe("buildUnifiedSchedule — merge e casos básicos", () => {
  it("1. zero candidatos e zero revisões devolve agenda vazia", () => {
    const r = buildUnifiedSchedule(input());
    expect(r.tasks).toEqual([]);
    expect(r.studyMinutes).toBe(0);
    expect(r.reviewMinutes).toBe(0);
    expect(r.reviewBacklog).toBe(0);
    expect(r.unallocatedMinutes).toBe(r.totalCapacityMinutes);
  });

  it("2. faz merge de estudo novo e revisão", () => {
    const r = buildUnifiedSchedule(
      input({ studyCandidates: [study("t1", 6)], reviewCandidates: [review("r1", 0.5)] }),
    );
    const sources = new Set(r.tasks.map((t) => t.source));
    expect(sources.has("planner")).toBe(true);
    expect(sources.has("review_engine")).toBe(true);
    expect(r.studyMinutes).toBeGreaterThan(0);
    expect(r.reviewMinutes).toBeGreaterThan(0);
  });

  it("3. somente estudo novo", () => {
    const r = buildUnifiedSchedule({
      ...input(),
      studyCandidates: [study("t1", 6), study("t2", 5)],
    });
    expect(r.tasks.every((t) => t.source === "planner")).toBe(true);
    expect(r.reviewMinutes).toBe(0);
    expect(r.tasks.every((t) => t.reviewUrgency === null)).toBe(true);
  });

  it("4. somente revisão", () => {
    const r = buildUnifiedSchedule(input({ reviewCandidates: [review("r1", 0.6)] }));
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0]!.source).toBe("review_engine");
    expect(r.studyMinutes).toBe(0);
    expect(r.tasks[0]!.reviewType).toBe("manutencao");
  });

  it("5. disponibilidade zero não agenda nada e devolve backlog", () => {
    const r = buildUnifiedSchedule(
      input({
        weeks: weeksMap(week(0)),
        studyCandidates: [study("t1", 6)],
        reviewCandidates: [review("r1", 0.9)],
      }),
    );
    expect(r.tasks).toEqual([]);
    expect(r.totalCapacityMinutes).toBe(0);
    expect(r.reviewBacklog).toBe(1);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("6. somente um dia disponível", () => {
    const w: AvailabilityWeek = { ...emptyWeek(weekStartOf(START)), minutes_mon: 100 };
    const r = buildUnifiedSchedule(
      input({ weeks: weeksMap(w), studyCandidates: [study("t1", 6), study("t2", 4)] }),
    );
    expect(r.totalCapacityMinutes).toBe(100);
    expect(new Set(r.tasks.map((t) => t.scheduledDate))).toEqual(new Set([START]));
    expect(r.studyMinutes).toBeLessThanOrEqual(100);
  });
});

describe("unified priority score", () => {
  it("7. UPS de revisão segue a política aprovada e a escala", () => {
    const c = review("r1", 1, { interventionScore: 1, structuralPriority: 8 });
    expect(computeReviewUps(c, 1)).toBeCloseTo(1 * REVIEW_UPS_SCALE, 6);
    const half = computeReviewUps(
      review("r2", 0.5, { interventionScore: 0, structuralPriority: 0 }),
      0,
    );
    expect(half).toBeCloseTo(0.45 * 0.5 * 8, 6);
  });

  it("8. UPS de estudo novo preserva o score do Planner", () => {
    const r = buildUnifiedSchedule(input({ studyCandidates: [study("t1", 6.25)] }));
    expect(r.tasks[0]!.unifiedPriorityScore).toBeCloseTo(6.25, 3);
  });

  it("9. estudo prioritário aparece antes de revisão de manutenção fraca", () => {
    const r = buildUnifiedSchedule(
      input({
        studyCandidates: [study("t1", 9)],
        reviewCandidates: [review("r1", 0.1, { interventionScore: 0, structuralPriority: 0 })],
      }),
    );
    const firstDay = r.tasks.filter((t) => t.scheduledDate === START);
    expect(firstDay[0]!.source).toBe("planner");
  });

  it("10. revisão urgente vem antes de estudo novo", () => {
    const r = buildUnifiedSchedule(
      input({
        studyCandidates: [study("t1", 9)],
        reviewCandidates: [review("r1", 0.95, { interventionScore: 0.9, structuralPriority: 8 })],
      }),
    );
    const firstDay = r.tasks.filter((t) => t.scheduledDate === START);
    expect(firstDay[0]!.source).toBe("review_engine");
    expect(firstDay[0]!.position).toBe(0);
  });
});

describe("deduplicação", () => {
  it("11. estudo e revisão do mesmo tópico no mesmo dia geram uma única tarefa", () => {
    const r = buildUnifiedSchedule(
      input({ studyCandidates: [study("t1", 8)], reviewCandidates: [review("t1", 0.9)] }),
    );
    const sameTopicSameDay = r.tasks.filter((t) => t.topicId === "t1" && t.scheduledDate === START);
    expect(sameTopicSameDay).toHaveLength(1);
    expect(sameTopicSameDay[0]!.source).toBe("review_engine");
    expect(r.deduplicatedTopics).toContain("t1");
  });

  it("12. a revisão prevalece com seu reviewType/intensidade", () => {
    const r = buildUnifiedSchedule(
      input({
        studyCandidates: [study("t1", 8)],
        reviewCandidates: [
          review("t1", 0.9, { reviewType: "erro_direcionado", reviewIntensity: "intensiva" }),
        ],
      }),
    );
    const task = r.tasks.find((t) => t.topicId === "t1")!;
    expect(task.reviewType).toBe("erro_direcionado");
    expect(task.reviewIntensity).toBe("intensiva");
    expect(task.activity).toBe("exercicios");
  });

  it("13. mesmo tópico em dias diferentes pode coexistir", () => {
    const r = buildUnifiedSchedule(
      input({
        reviewCandidates: [review("t1", 0.9), review("t1", 0.85)],
        weeks: weeksMap(week(200)),
      }),
    );
    const dates = r.tasks.filter((t) => t.topicId === "t1").map((t) => t.scheduledDate);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates.length).toBeGreaterThan(1);
  });

  it("14. nunca há duas tarefas do mesmo tópico no mesmo dia", () => {
    const reviews = Array.from({ length: 10 }, (_, i) => review(`t${i % 3}`, 0.7));
    const r = buildUnifiedSchedule(
      input({ reviewCandidates: reviews, weeks: weeksMap(week(300)) }),
    );
    const keys = r.tasks.map((t) => `${t.topicId}|${t.scheduledDate}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("limites de revisão", () => {
  it("15. respeita reviewCap de 30% em dia normal", () => {
    const reviews = Array.from({ length: 8 }, (_, i) => review(`r${i}`, 0.4));
    const r = buildUnifiedSchedule(
      input({ reviewCandidates: reviews, weeks: weeksMap(week(200)) }),
    );
    const byDay = new Map<string, number>();
    for (const t of r.tasks) {
      byDay.set(t.scheduledDate, (byDay.get(t.scheduledDate) ?? 0) + t.plannedMinutes);
    }
    for (const minutes of byDay.values()) expect(minutes).toBeLessThanOrEqual(200 * 0.3);
  });

  it("16. revisão com urgência >= 0.8 usa a exceção de +15%", () => {
    const reviews = Array.from({ length: 6 }, (_, i) => review(`r${i}`, 0.9));
    const r = buildUnifiedSchedule(
      input({ reviewCandidates: reviews, weeks: weeksMap(week(200)) }),
    );
    const firstDay = r.tasks
      .filter((t) => t.scheduledDate === START)
      .reduce((s, t) => s + t.plannedMinutes, 0);
    expect(firstDay).toBeGreaterThan(200 * 0.3);
    expect(firstDay).toBeLessThanOrEqual(200 * 0.45);
  });

  it("17. nunca ultrapassa o teto absoluto de 60% por dia", () => {
    const reviews = Array.from({ length: 30 }, (_, i) => review(`r${i}`, 1));
    const r = buildUnifiedSchedule(
      input({
        reviewCandidates: reviews,
        weeks: weeksMap(week(200)),
        config: config({ urgentReviewExtraCap: 0.9 }),
      }),
    );
    const byDay = new Map<string, number>();
    for (const t of r.tasks) {
      byDay.set(t.scheduledDate, (byDay.get(t.scheduledDate) ?? 0) + t.plannedMinutes);
    }
    for (const minutes of byDay.values()) expect(minutes).toBeLessThanOrEqual(200 * 0.6);
  });

  it("18. urgência 0 e urgência 1 são tratadas sem erro", () => {
    const r = buildUnifiedSchedule(
      input({ reviewCandidates: [review("a", 0), review("b", 1)], weeks: weeksMap(week(200)) }),
    );
    expect(r.tasks.length).toBeGreaterThan(0);
    expect(r.tasks[0]!.reviewUrgency).toBe(1);
  });

  it("19. urgência exatamente 0.8 já conta como urgente", () => {
    const reviews = Array.from({ length: 5 }, (_, i) => review(`r${i}`, 0.8));
    const r = buildUnifiedSchedule(
      input({ reviewCandidates: reviews, weeks: weeksMap(week(200)) }),
    );
    const firstDay = r.tasks
      .filter((t) => t.scheduledDate === START)
      .reduce((s, t) => s + t.plannedMinutes, 0);
    expect(firstDay).toBeGreaterThan(200 * 0.3);
  });
});

describe("capacidade, backlog e disponibilidade", () => {
  it("20. respeita a disponibilidade diária e maxDailyMinutes", () => {
    const r = buildUnifiedSchedule(
      input({
        studyCandidates: Array.from({ length: 20 }, (_, i) => study(`t${i}`, 8 - i * 0.1)),
        weeks: weeksMap(week(400)),
        config: config({ maxDailyMinutes: 120 }),
      }),
    );
    const byDay = new Map<string, number>();
    for (const t of r.tasks) {
      byDay.set(t.scheduledDate, (byDay.get(t.scheduledDate) ?? 0) + t.plannedMinutes);
    }
    for (const minutes of byDay.values()) expect(minutes).toBeLessThanOrEqual(120);
    expect(r.studyMinutes + r.reviewMinutes).toBeLessThanOrEqual(r.totalCapacityMinutes);
  });

  it("21. disponibilidade semanal distinta é respeitada", () => {
    const w1 = week(100, weekStartOf(START));
    const w2 = week(0, weekStartOf("2026-03-09"));
    const r = buildUnifiedSchedule(
      input({
        weeks: weeksMap(w1, w2),
        config: config({ endDate: "2026-03-15" }),
        studyCandidates: Array.from({ length: 30 }, (_, i) => study(`t${i}`, 5)),
      }),
    );
    expect(r.totalCapacityMinutes).toBe(700);
    expect(r.tasks.every((t) => t.scheduledDate <= END)).toBe(true);
  });

  it("22. revisões não alocadas ficam em reviewBacklog com warning", () => {
    const reviews = Array.from({ length: 40 }, (_, i) => review(`r${i}`, 0.5));
    const r = buildUnifiedSchedule(input({ reviewCandidates: reviews, weeks: weeksMap(week(60)) }));
    expect(r.reviewBacklog).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.includes("revisões pendentes"))).toBe(true);
  });

  it("23. métricas de minutos são coerentes", () => {
    const r = buildUnifiedSchedule(
      input({
        studyCandidates: [study("t1", 7), study("t2", 6)],
        reviewCandidates: [review("r1", 0.9)],
        weeks: weeksMap(week(200)),
      }),
    );
    const allocated = r.tasks.reduce((s, t) => s + t.plannedMinutes, 0);
    expect(r.studyMinutes + r.reviewMinutes).toBe(allocated);
    expect(r.unallocatedMinutes).toBe(r.totalCapacityMinutes - allocated);
  });

  it("24. maxSubjectShare limita a participação de uma matéria", () => {
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => study(`a${i}`, 9, "s1")),
      ...Array.from({ length: 10 }, (_, i) => study(`b${i}`, 8, "s2")),
      ...Array.from({ length: 10 }, (_, i) => study(`c${i}`, 7, "s3")),
    ];
    const r = buildUnifiedSchedule(
      input({
        studyCandidates: candidates,
        weeks: weeksMap(week(200)),
        config: config({ maxSubjectShare: 0.35 }),
      }),
    );
    const bySubject = new Map<string, number>();
    for (const t of r.tasks) {
      bySubject.set(t.subjectId, (bySubject.get(t.subjectId) ?? 0) + t.plannedMinutes);
    }
    for (const minutes of bySubject.values()) {
      expect(minutes).toBeLessThanOrEqual(r.totalCapacityMinutes * 0.35 + 1);
    }
  });
});

describe("prova, dados inválidos e determinismo", () => {
  it("25. prova próxima gera bônus de proximidade", () => {
    expect(computeExamProximityBonus(START, "2026-03-10")).toBe(1);
    expect(computeExamProximityBonus(START, "2026-04-10")).toBe(0.5);
    expect(computeExamProximityBonus(START, "2026-12-10")).toBe(0);
    expect(computeExamProximityBonus(START, null)).toBe(0);
    expect(computeExamProximityBonus(START, "data-invalida")).toBe(0);
  });

  it("26. prova próxima eleva o UPS de revisão", () => {
    const c = review("r1", 0.5);
    expect(computeReviewUps(c, 1)).toBeGreaterThan(computeReviewUps(c, 0));
  });

  it("27. NaN/Infinity em urgência, intervenção e score usam fallback seguro", () => {
    const r = buildUnifiedSchedule(
      input({
        studyCandidates: [study("t1", Number.NaN), study("t2", Number.POSITIVE_INFINITY)],
        reviewCandidates: [
          review("r1", Number.NaN, { interventionScore: Number.POSITIVE_INFINITY }),
          review("r2", Number.NEGATIVE_INFINITY, { structuralPriority: Number.NaN }),
        ],
        weeks: weeksMap(week(200)),
      }),
    );
    expect(r.tasks.every((t) => Number.isFinite(t.unifiedPriorityScore))).toBe(true);
    expect(r.tasks.every((t) => Number.isFinite(t.plannedMinutes))).toBe(true);
    expect(safeNumber(Number.NaN, 3)).toBe(3);
  });

  it("28. datas inválidas não lançam exceção", () => {
    const r = buildUnifiedSchedule(
      input({
        config: config({ startDate: "abc", endDate: "2026-02-31" }),
        reviewCandidates: [review("r1", 0.9)],
      }),
    );
    expect(r.tasks).toEqual([]);
    expect(r.reviewBacklog).toBe(1);
  });

  it("29. minutos de revisão vêm da configuração por intensidade", () => {
    const cfg = config();
    expect(
      reviewMinutesFor(review("a", 0.5, { reviewIntensity: "leve", estimatedMinutes: 0 }), cfg),
    ).toBe(20);
    expect(
      reviewMinutesFor(review("b", 0.5, { reviewIntensity: "moderada", estimatedMinutes: 0 }), cfg),
    ).toBe(35);
    expect(
      reviewMinutesFor(
        review("c", 0.5, { reviewIntensity: "intensiva", estimatedMinutes: 0 }),
        cfg,
      ),
    ).toBe(50);
  });

  it("30. muitos candidatos e muitas revisões permanecem determinísticos", () => {
    const base = input({
      studyCandidates: Array.from({ length: 50 }, (_, i) =>
        study(`t${i}`, 9 - i * 0.05, `s${i % 4}`),
      ),
      reviewCandidates: Array.from({ length: 50 }, (_, i) => review(`r${i}`, (i % 10) / 10)),
      weeks: weeksMap(week(240)),
      config: config({ examDate: "2026-03-20", maxSubjectShare: 0.4 }),
    });
    const a = buildUnifiedSchedule(base);
    const b = buildUnifiedSchedule(base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.tasks.length).toBeGreaterThan(0);
  });
});
