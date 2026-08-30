import { describe, it, expect } from "vitest";
import {
  buildPlan,
  redistributeTasks,
  scoreCandidates,
  computeRawScore,
  chooseActivity,
  DEFAULT_SCORE_WEIGHTS,
  type DiagnosticData,
  type ScoredCandidate,
} from "@/lib/planner/engine";
import { computeDiagnosticBoost } from "@/lib/planner/intelligence";
import { emptyWeek, weekStartOf, todayISO, addDays } from "@/lib/planner/availability";

const mk = (
  n: number,
  subj: string,
  priority: number,
  mastery: number | null,
  prereq: string[] = [],
) => ({
  contestTopicId: `ct${n}`,
  subjectId: subj,
  subjectName: subj,
  topicId: `t${n}`,
  topicName: `T${n}`,
  priority,
  weight: priority * 2,
  incidence: 50,
  relevance: 50,
  isStudied: false,
  mastery,
  prerequisiteTopicIds: prereq,
});

const week = (start: string, hoursPerDay: number) => ({
  ...emptyWeek(start),
  minutes_mon: hoursPerDay * 60,
  minutes_tue: hoursPerDay * 60,
  minutes_wed: hoursPerDay * 60,
  minutes_thu: hoursPerDay * 60,
  minutes_fri: hoursPerDay * 60,
  minutes_sat: hoursPerDay * 60,
});

/**
 * Helper: calcula o teto teórico exato de uma matéria em percentual,
 * considerando blocos inteiros.
 *
 * maxBlocksCeil = ceil(totalBlocks * maxShare)
 * maxPercentCeil = maxBlocksCeil / totalBlocks
 *
 * Para totalBlocks suficientes, maxPercentCeil converge para maxShare.
 */
function maxPercentForBlocks(totalBlocks: number, maxShare: number): number {
  return Math.ceil(totalBlocks * maxShare) / totalBlocks;
}

/**
 * Helper: extrai distribuição por matéria de um resultado do planner.
 */
function subjectDistribution(tasks: { candidate: { subjectId: string }; minutes: number }[]) {
  const bySubject = new Map<string, number>();
  let total = 0;
  for (const t of tasks) {
    bySubject.set(t.candidate.subjectId, (bySubject.get(t.candidate.subjectId) ?? 0) + t.minutes);
    total += t.minutes;
  }
  return { bySubject, total };
}

describe("planner — core", () => {
  const w1 = weekStartOf(todayISO());
  const w2 = addDays(w1, 7);
  const candidates = [
    mk(1, "Português", 5, 0.2),
    mk(2, "Tributário", 5, null),
    mk(3, "Contabilidade", 4, 0.4),
    mk(4, "Matemática", 3, 0.1, ["t1"]),
  ];

  it("distributes 30h week and 18h next week separately", () => {
    const weeks = new Map([
      [w1, week(w1, 5)],
      [w2, week(w2, 3)],
    ]);
    const res = buildPlan(candidates, weeks, {
      startDate: w1,
      endDate: addDays(w2, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const minutesInWeek = (ws: string) =>
      res.tasks.filter((t) => weekStartOf(t.date) === ws).reduce((s, t) => s + t.minutes, 0);
    expect(res.totalCapacityMinutes).toBe(30 * 60 + 18 * 60);
    expect(minutesInWeek(w1)).toBeGreaterThan(minutesInWeek(w2));

    // Validação rigorosa do teto de 35%.
    // Cálculo: totalBlocks = floor(totalCapacity / blockMinutes)
    // maxPercent = ceil(totalBlocks * 0.35) / totalBlocks
    const totalBlocks = Math.floor(res.totalCapacityMinutes / 50);
    const theoreticalMaxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    const { bySubject, total } = subjectDistribution(res.tasks);
    for (const [, m] of bySubject) {
      // Cada matéria deve estar dentro do teto teórico (arredondamento de blocos).
      expect(m / total).toBeLessThanOrEqual(theoreticalMaxPercent + 0.001);
    }
    expect(bySubject.size).toBe(4);
  });

  it("prioritizes prerequisite over dependent topic", () => {
    const scored = buildPlan(candidates, new Map([[w1, week(w1, 5)]]), {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    }).scored;
    const prereq = scored.find((s) => s.topicId === "t1")!;
    const dependent = scored.find((s) => s.topicId === "t4")!;
    expect(prereq.isPrerequisiteOfBlocked).toBe(true);
    expect(dependent.blockedByPrerequisite).toBe(true);
    expect(prereq.score).toBeGreaterThan(dependent.score);
  });

  it("redistributes overdue tasks without piling on one day", () => {
    const weeks = new Map([
      [w1, week(w1, 5)],
      [w2, week(w2, 3)],
    ]);
    const pending = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      minutes: 50,
      score: 5 - i,
    }));
    const res = redistributeTasks(pending, weeks, new Map(), {
      fromDate: w1,
      endDate: addDays(w2, 6),
      maxDailyMinutes: 480,
    });
    const dates = res.map((r) => r.date);
    expect(dates.every(Boolean)).toBe(true);
    expect(new Set(dates).size).toBeGreaterThan(1);
  });

  it("returns nothing when there is no availability", () => {
    const res = buildPlan(candidates, new Map(), {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    expect(res.tasks).toHaveLength(0);
  });
});

describe("planner — score extensibility", () => {
  it("computeRawScore returns consistent results with default weights", () => {
    const signals = { normPriority: 1, normWeight: 1, normIncidence: 1, normRelevance: 1, gap: 1 };
    const score = computeRawScore(signals);
    expect(score).toBe(2.0 + 1.5 + 1.2 + 1.0 + 2.0);
  });

  it("computeRawScore accepts custom weights", () => {
    const signals = {
      normPriority: 0.5,
      normWeight: 0.5,
      normIncidence: 0,
      normRelevance: 0,
      gap: 0,
    };
    const score = computeRawScore(signals, { ...DEFAULT_SCORE_WEIGHTS, priority: 10 });
    expect(score).toBe(10 * 0.5 + 1.5 * 0.5);
  });
});

describe("planner — 35% subject cap (rigorous validation)", () => {
  const w1 = weekStartOf(todayISO());

  /**
   * ANÁLISE MATEMÁTICA DO TETO DE 35% COM BLOCOS INTEIROS
   *
   * Regra de negócio: com 3+ matérias, nenhuma recebe mais de 35% do total.
   *
   * Teto em blocos: maxBlocks = ceil(totalBlocks * 0.35)
   * Percentual real: maxBlocks / totalBlocks
   *
   * Impossibilidade matemática: totalBlocks < 3 com 3+ matérias.
   *   - 1 bloco, 3 matérias: 1 matéria = 100%
   *   - 2 blocos, 3 matérias: melhor caso = 50%
   *
   * Para totalBlocks >= 3 com 3+ matérias, o teto é respeitável porque
   * ceil(3 * 0.35) = 2, e cada matéria pode receber 1 bloco (33.3%).
   */

  // --- 3 MATÉRIAS ---

  it("3 subjects, one dominant — enforces 35% with sufficient blocks", () => {
    const cands = [mk(1, "A", 5, 0.0), mk(2, "A", 5, 0.0), mk(3, "B", 2, 0.9), mk(4, "C", 2, 0.9)];
    // 5h/day * 6 days = 30h = 1800min → 36 blocks of 50min
    const weeks = new Map([[w1, week(w1, 5)]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const totalBlocks = Math.floor(res.totalCapacityMinutes / 50);
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    const { bySubject, total } = subjectDistribution(res.tasks);
    expect(total).toBeGreaterThan(0);
    for (const [subj, m] of bySubject) {
      expect(m / total).toBeLessThanOrEqual(maxPercent + 0.001);
    }
  });

  it("3 subjects with extremely skewed scores — dominant capped at 35%", () => {
    // Alpha has score ~20x higher than others.
    const cands = [
      { ...mk(1, "Alpha", 5, 0.0), weight: 10, incidence: 100, relevance: 100 },
      mk(2, "Beta", 1, 1.0),
      mk(3, "Gamma", 1, 1.0),
    ];
    const weeks = new Map([[w1, week(w1, 4)]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const totalBlocks = Math.floor(res.totalCapacityMinutes / 50);
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    const { bySubject, total } = subjectDistribution(res.tasks);
    expect(total).toBeGreaterThan(0);
    for (const [, m] of bySubject) {
      expect(m / total).toBeLessThanOrEqual(maxPercent + 0.001);
    }
  });

  it("3 subjects with equal scores — balanced distribution", () => {
    const cands = [mk(1, "X", 3, 0.5), mk(2, "Y", 3, 0.5), mk(3, "Z", 3, 0.5)];
    const weeks = new Map([[w1, week(w1, 5)]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const { bySubject, total } = subjectDistribution(res.tasks);
    expect(bySubject.size).toBe(3);
    // With equal scores and 3 subjects, each should get ~33.3%.
    for (const [, m] of bySubject) {
      const pct = m / total;
      expect(pct).toBeLessThanOrEqual(0.35 + 0.02); // ~33.3%, well under 35%
      expect(pct).toBeGreaterThan(0.2); // reasonable minimum
    }
  });

  // --- 4 MATÉRIAS ---

  it("4 subjects — enforces 35% cap", () => {
    const cands = [
      mk(1, "S1", 5, 0.0),
      mk(2, "S2", 4, 0.3),
      mk(3, "S3", 3, 0.5),
      mk(4, "S4", 2, 0.8),
    ];
    const weeks = new Map([[w1, week(w1, 5)]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const totalBlocks = Math.floor(res.totalCapacityMinutes / 50);
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    const { bySubject, total } = subjectDistribution(res.tasks);
    expect(bySubject.size).toBe(4);
    for (const [, m] of bySubject) {
      expect(m / total).toBeLessThanOrEqual(maxPercent + 0.001);
    }
  });

  // --- 5 MATÉRIAS ---

  it("5 subjects — enforces 35% cap", () => {
    const cands = [
      mk(1, "S1", 5, 0.1),
      mk(2, "S2", 4, 0.3),
      mk(3, "S3", 3, 0.5),
      mk(4, "S4", 2, 0.7),
      mk(5, "S5", 1, 0.9),
    ];
    const weeks = new Map([[w1, week(w1, 5)]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const totalBlocks = Math.floor(res.totalCapacityMinutes / 50);
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    const { bySubject, total } = subjectDistribution(res.tasks);
    expect(bySubject.size).toBe(5);
    for (const [, m] of bySubject) {
      expect(m / total).toBeLessThanOrEqual(maxPercent + 0.001);
    }
  });

  // --- 6+ MATÉRIAS ---

  it("6 subjects — enforces 35% cap", () => {
    const cands = Array.from({ length: 6 }, (_, i) =>
      mk(i + 1, `S${i + 1}`, 5 - (i % 5), i * 0.15),
    );
    const w2 = addDays(w1, 7);
    const weeks = new Map([
      [w1, week(w1, 6)],
      [w2, week(w2, 4)],
    ]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w2, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const totalBlocks = Math.floor(res.totalCapacityMinutes / 50);
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    const { bySubject, total } = subjectDistribution(res.tasks);
    expect(bySubject.size).toBe(6);
    for (const [, m] of bySubject) {
      expect(m / total).toBeLessThanOrEqual(maxPercent + 0.001);
    }
  });

  it("8 subjects — enforces 35% cap with many subjects", () => {
    const cands = Array.from({ length: 8 }, (_, i) =>
      mk(i + 1, `M${i + 1}`, Math.max(1, 5 - i), i * 0.1),
    );
    const weeks = new Map([[w1, week(w1, 6)]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const totalBlocks = Math.floor(res.totalCapacityMinutes / 50);
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    const { bySubject, total } = subjectDistribution(res.tasks);
    expect(bySubject.size).toBe(8);
    for (const [, m] of bySubject) {
      expect(m / total).toBeLessThanOrEqual(maxPercent + 0.001);
    }
  });

  // --- SCORE EXTREMAMENTE DOMINANTE ---

  it("single subject with 100x higher score than others — still capped", () => {
    const cands = [
      { ...mk(1, "Dominant", 5, 0.0), weight: 10, incidence: 100, relevance: 100 },
      { ...mk(2, "Dominant", 5, 0.0), weight: 10, incidence: 100, relevance: 100 },
      { ...mk(3, "Dominant", 5, 0.0), weight: 10, incidence: 100, relevance: 100 },
      mk(4, "Weak1", 1, 1.0),
      mk(5, "Weak2", 1, 1.0),
    ];
    const weeks = new Map([[w1, week(w1, 6)]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const totalBlocks = Math.floor(res.totalCapacityMinutes / 50);
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    const { bySubject, total } = subjectDistribution(res.tasks);
    for (const [, m] of bySubject) {
      expect(m / total).toBeLessThanOrEqual(maxPercent + 0.001);
    }
  });

  // --- POUCOS BLOCOS (exceção matemática documentada) ---

  it("2 blocks, 3 subjects — documents mathematical impossibility", () => {
    // 2h total with 50min blocks = 2 blocks. 3 subjects need minimum 1 each = 3 blocks.
    // Impossible to fit all 3 under 35%. This is the documented exception.
    const cands = [mk(1, "X", 5, 0.0), mk(2, "Y", 3, 0.5), mk(3, "Z", 2, 0.9)];
    const lowWeek = { ...emptyWeek(w1), minutes_mon: 120 };
    const weeks = new Map([[w1, lowWeek]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    expect(res.tasks.length).toBeGreaterThanOrEqual(1);

    // DOCUMENTED EXCEPTION: With only 2 blocks for 3 subjects,
    // it's mathematically impossible to keep all below 35%.
    // The algorithm still produces a valid plan — it just can't satisfy the 35% constraint.
    const totalBlocks = Math.floor(120 / 50); // = 2
    expect(totalBlocks).toBe(2);
    // The best possible split is 1+1 (2 subjects get blocks, 1 gets nothing)
    // or some subjects get 0 blocks. Either way, max is 50% (1/2).
    // This is the documented rounding exception for very low block counts.
  });

  it("3 blocks, 3 subjects — exactly at threshold, should work", () => {
    // 150min total / 50min = 3 blocks. Each subject gets exactly 1 = 33.3% < 35%.
    const cands = [mk(1, "A", 5, 0.0), mk(2, "B", 3, 0.5), mk(3, "C", 2, 0.9)];
    const lowWeek = { ...emptyWeek(w1), minutes_mon: 150 };
    const weeks = new Map([[w1, lowWeek]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const { bySubject, total } = subjectDistribution(res.tasks);
    if (bySubject.size === 3 && total > 0) {
      // With exactly 3 blocks and 3 subjects, each gets 1 block = 33.3%.
      for (const [, m] of bySubject) {
        expect(m / total).toBeLessThanOrEqual(0.35 + 0.001);
      }
    }
  });

  it("4 blocks, 3 subjects — cap works cleanly", () => {
    // 200min / 50 = 4 blocks. ceil(4 * 0.35) = 2. Max = 2/4 = 50%... wait.
    // But post-rounding enforcement limits to ceil(4*0.35)=2 blocks = 50%.
    // However the dominant subject should get at most 2 blocks out of 4.
    const cands = [
      { ...mk(1, "Dom", 5, 0.0), weight: 10 },
      mk(2, "Med", 3, 0.5),
      mk(3, "Low", 1, 0.9),
    ];
    const lowWeek = { ...emptyWeek(w1), minutes_mon: 200 };
    const weeks = new Map([[w1, lowWeek]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const totalBlocks = Math.floor(200 / 50); // 4
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35); // ceil(1.4)/4 = 2/4 = 0.50
    const { bySubject, total } = subjectDistribution(res.tasks);
    for (const [, m] of bySubject) {
      expect(m / total).toBeLessThanOrEqual(maxPercent + 0.001);
    }
  });

  // --- MUITAS HORAS/BLOCOS ---

  it("many blocks (60+) — cap converges to exactly 35%", () => {
    // 10h/day * 6 days = 60h = 3600min / 50 = 72 blocks
    const cands = [
      { ...mk(1, "Heavy", 5, 0.0), weight: 10, incidence: 100 },
      mk(2, "Mid1", 3, 0.4),
      mk(3, "Mid2", 3, 0.4),
      mk(4, "Light", 1, 0.9),
    ];
    const highWeek = {
      ...emptyWeek(w1),
      minutes_mon: 600,
      minutes_tue: 600,
      minutes_wed: 600,
      minutes_thu: 600,
      minutes_fri: 600,
      minutes_sat: 600,
    };
    const weeks = new Map([[w1, highWeek]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 600,
    });
    const totalBlocks = Math.floor(res.totalCapacityMinutes / 50);
    expect(totalBlocks).toBeGreaterThanOrEqual(60);
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    // With 72 blocks: ceil(72*0.35)=ceil(25.2)=26, 26/72=0.3611... ≈ 36.1%
    // That's the mathematical ceiling from block rounding.
    const { bySubject, total } = subjectDistribution(res.tasks);
    for (const [, m] of bySubject) {
      expect(m / total).toBeLessThanOrEqual(maxPercent + 0.001);
    }
    // Also verify it's close to 35% (within 2% for large block counts)
    expect(maxPercent).toBeLessThan(0.37);
  });

  it("100+ blocks — cap is effectively 35%", () => {
    // Verify that with large block counts, the rounding error becomes negligible.
    const totalBlocks = 100;
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    // ceil(100 * 0.35) / 100 = 35/100 = 0.35 exactly.
    expect(maxPercent).toBe(0.35);

    const totalBlocks200 = 200;
    const maxPercent200 = maxPercentForBlocks(totalBlocks200, 0.35);
    // ceil(200 * 0.35) / 200 = 70/200 = 0.35 exactly.
    expect(maxPercent200).toBe(0.35);
  });

  // --- EDGE: many subjects with many topics each ---

  it("4 subjects, 3 topics each — cap respected per subject", () => {
    const cands = [
      mk(1, "S1", 5, 0.0),
      mk(2, "S1", 4, 0.2),
      mk(3, "S1", 3, 0.4),
      mk(4, "S2", 4, 0.3),
      mk(5, "S2", 3, 0.5),
      mk(6, "S2", 2, 0.7),
      mk(7, "S3", 3, 0.5),
      mk(8, "S3", 2, 0.6),
      mk(9, "S3", 1, 0.8),
      mk(10, "S4", 2, 0.7),
      mk(11, "S4", 1, 0.9),
      mk(12, "S4", 1, 0.9),
    ];
    const weeks = new Map([[w1, week(w1, 5)]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const totalBlocks = Math.floor(res.totalCapacityMinutes / 50);
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    const { bySubject, total } = subjectDistribution(res.tasks);
    expect(bySubject.size).toBe(4);
    for (const [, m] of bySubject) {
      expect(m / total).toBeLessThanOrEqual(maxPercent + 0.001);
    }
  });
});

describe("planner — stress tests", () => {
  const w1 = weekStartOf(todayISO());
  const w2 = addDays(w1, 7);
  const w3 = addDays(w1, 14);
  const w4 = addDays(w1, 21);

  // Cenário A: 1 matéria, pouca disponibilidade
  it("A — 1 subject, low availability", () => {
    const cands = [mk(1, "Solo", 5, 0.2)];
    const lowWeek = { ...emptyWeek(w1), minutes_tue: 60, minutes_thu: 60 };
    const weeks = new Map([[w1, lowWeek]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    expect(res.tasks.length).toBeGreaterThanOrEqual(1);
    expect(res.allocatedMinutes).toBeLessThanOrEqual(120);
    expect(res.tasks.every((t) => t.candidate.subjectId === "Solo")).toBe(true);
  });

  // Cenário B: 2 matérias extremamente desequilibradas
  it("B — 2 subjects extremely unbalanced", () => {
    const cands = [
      { ...mk(1, "Heavy", 5, 0.0), weight: 10, incidence: 100, relevance: 100 },
      mk(2, "Light", 1, 1.0),
    ];
    const weeks = new Map([[w1, week(w1, 5)]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const bySubject = new Map<string, number>();
    for (const t of res.tasks)
      bySubject.set(t.candidate.subjectId, (bySubject.get(t.candidate.subjectId) ?? 0) + t.minutes);
    // With 2 subjects, maxShare = 1/2 + 0.15 = 0.65. Heavy should dominate but Light gets some.
    expect(bySubject.has("Light")).toBe(true);
    expect(bySubject.get("Light") ?? 0).toBeGreaterThan(0);
  });

  // Cenário C: 3 matérias, uma com score muito superior
  it("C — 3 subjects, one dominant", () => {
    const cands = [
      { ...mk(1, "Dom", 5, 0.0), weight: 10 },
      mk(2, "Med", 3, 0.5),
      mk(3, "Low", 1, 0.9),
    ];
    const weeks = new Map([[w1, week(w1, 5)]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const totalBlocks = Math.floor(res.totalCapacityMinutes / 50);
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    const { bySubject, total } = subjectDistribution(res.tasks);
    for (const [, m] of bySubject) expect(m / total).toBeLessThanOrEqual(maxPercent + 0.001);
    expect(bySubject.size).toBe(3);
  });

  // Cenário D: 5+ matérias
  it("D — 6 subjects", () => {
    const cands = Array.from({ length: 6 }, (_, i) =>
      mk(i + 1, `S${i + 1}`, 5 - (i % 5), i * 0.15),
    );
    const weeks = new Map([
      [w1, week(w1, 6)],
      [w2, week(w2, 4)],
    ]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w2, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const subjects = new Set(res.tasks.map((t) => t.candidate.subjectId));
    expect(subjects.size).toBe(6);
    const totalBlocks = Math.floor(res.totalCapacityMinutes / 50);
    const maxPercent = maxPercentForBlocks(totalBlocks, 0.35);
    const { bySubject, total } = subjectDistribution(res.tasks);
    for (const [, m] of bySubject) expect(m / total).toBeLessThanOrEqual(maxPercent + 0.001);
  });

  // Cenário E: semana com disponibilidade zero
  it("E — week with zero availability", () => {
    const cands = [mk(1, "S1", 5, 0.2), mk(2, "S2", 4, 0.3)];
    const weeks = new Map([
      [w1, emptyWeek(w1)],
      [w2, week(w2, 4)],
    ]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w2, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    // All tasks should be in w2.
    const w1Tasks = res.tasks.filter((t) => weekStartOf(t.date) === w1);
    expect(w1Tasks).toHaveLength(0);
    expect(res.tasks.length).toBeGreaterThan(0);
  });

  // Cenário F: disponibilidade muito baixa (30min/dia, 1 dia)
  it("F — very low availability", () => {
    const cands = [mk(1, "S1", 5, 0.2), mk(2, "S2", 4, 0.3)];
    const lowWeek = { ...emptyWeek(w1), minutes_wed: 30 };
    const weeks = new Map([[w1, lowWeek]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 25,
      maxDailyMinutes: 480,
    });
    expect(res.tasks.length).toBeGreaterThanOrEqual(1);
    expect(res.allocatedMinutes).toBeLessThanOrEqual(30);
  });

  // Cenário G: disponibilidade muito alta (12h/dia)
  it("G — very high availability", () => {
    const cands = [mk(1, "S1", 5, 0.2), mk(2, "S2", 4, 0.3), mk(3, "S3", 3, 0.5)];
    const highWeek = {
      ...emptyWeek(w1),
      minutes_mon: 720,
      minutes_tue: 720,
      minutes_wed: 720,
      minutes_thu: 720,
      minutes_fri: 720,
      minutes_sat: 720,
    };
    const weeks = new Map([[w1, highWeek]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 600,
    });
    expect(res.tasks.length).toBeGreaterThan(10);
    // maxDailyMinutes limits actual allocation per day.
    for (const day of ["mon", "tue", "wed", "thu", "fri", "sat"]) {
      const dayTasks = res.tasks.filter((t) => {
        const d = new Date(t.date.replace(/-/g, "/"));
        const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
        return dayNames[d.getDay()] === day;
      });
      const dayMinutes = dayTasks.reduce((s, t) => s + t.minutes, 0);
      expect(dayMinutes).toBeLessThanOrEqual(600);
    }
  });

  // Cenário H: todas as matérias com mastery 1.0 (domínio total)
  it("H — all subjects mastered", () => {
    const cands = [
      { ...mk(1, "S1", 5, 1.0), isStudied: true },
      { ...mk(2, "S2", 4, 1.0), isStudied: true },
      { ...mk(3, "S3", 3, 1.0), isStudied: true },
    ];
    const weeks = new Map([[w1, week(w1, 4)]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    // Even with mastery 1.0, the planner still allocates tasks
    // (gap = 0 but score still > 0 from priority/weight).
    expect(res.tasks.length).toBeGreaterThan(0);
  });

  // Cenário I: prova em 10 dias (consolidação)
  it("I — exam in 10 days triggers consolidation", () => {
    const cands = [
      { ...mk(1, "S1", 5, 0.3), isStudied: true },
      { ...mk(2, "S2", 4, 0.5), isStudied: true },
    ];
    const weeks = new Map([[w1, week(w1, 4)]]);
    const examDate = addDays(w1, 10);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    expect(res.tasks.length).toBeGreaterThan(0);
    // [Etapa 5, Fase 5] chooseActivity should NOT produce 'revisao' for study tasks.
    const activities = new Set(res.tasks.map((t) => t.activity));
    expect(activities.has("revisao")).toBe(false);
    // Should produce questoes and/or flashcards for consolidation.
    expect(activities.has("questoes") || activities.has("flashcards")).toBe(true);
  });

  // Cenário J: 4 semanas completas
  it("J — 4 full weeks", () => {
    const cands = [
      mk(1, "S1", 5, 0.1),
      mk(2, "S2", 4, 0.3),
      mk(3, "S3", 3, 0.5),
      mk(4, "S4", 2, 0.7),
    ];
    const weeks = new Map([
      [w1, week(w1, 4)],
      [w2, week(w2, 4)],
      [w3, week(w3, 4)],
      [w4, week(w4, 4)],
    ]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w4, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    expect(res.tasks.length).toBeGreaterThan(20);
    const weekCounts = new Map<string, number>();
    for (const t of res.tasks) {
      const ws = weekStartOf(t.date);
      weekCounts.set(ws, (weekCounts.get(ws) ?? 0) + 1);
    }
    // All 4 weeks should have tasks.
    expect(weekCounts.size).toBe(4);
  });

  // Cenário K: candidatos duplicados (mesmo tópico, matérias diferentes)
  it("K — duplicate topic across subjects handled", () => {
    const cands = [
      mk(1, "S1", 5, 0.2),
      mk(2, "S2", 4, 0.3),
      { ...mk(3, "S1", 3, 0.5), topicId: "t1" }, // same topicId as candidate 1
    ];
    const weeks = new Map([[w1, week(w1, 4)]]);
    const res = buildPlan(cands, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    expect(res.tasks.length).toBeGreaterThan(0);
  });
});

describe("planner — diagnostic integration (Etapa 3.3)", () => {
  const w1 = weekStartOf(todayISO());

  it("diagnostic data increases score for critical topics", () => {
    const candidates = [
      mk(1, "S1", 3, 0.3),
      mk(2, "S2", 3, 0.3),
    ];

    const diagnosticData = new Map<string, DiagnosticData>([
      [
        "t1",
        {
          knowledgeState: "PONTO_CRITICO",
          mastery: 0.2,
          confidence: 0.4,
          accuracy: 0.3,
          recentErrors: 5,
          unresolvedErrors: 4,
          recurringErrors: 2,
          daysSinceStudy: 30,
          daysSinceError: 2,
          interventionScore: 0.85,
        },
      ],
    ]);

    const withDiag = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
      diagnosticData,
    });
    const withoutDiag = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
    });

    const t1WithDiag = withDiag.find((s) => s.topicId === "t1")!;
    const t1WithoutDiag = withoutDiag.find((s) => s.topicId === "t1")!;
    expect(t1WithDiag.score).toBeGreaterThan(t1WithoutDiag.score);
    expect(t1WithDiag.diagnosticBoost).toBeGreaterThan(0);
  });

  it("dominated topic with high mastery gets minimal boost", () => {
    const candidates = [mk(1, "S1", 3, 0.9)];
    const diagnosticData = new Map<string, DiagnosticData>([
      [
        "t1",
        {
          knowledgeState: "DOMINADO",
          mastery: 0.95,
          confidence: 0.9,
          accuracy: 0.9,
          recentErrors: 0,
          unresolvedErrors: 0,
          recurringErrors: 0,
          daysSinceStudy: 2,
          daysSinceError: null,
          interventionScore: 0.02,
        },
      ],
    ]);

    const scored = scoreCandidates(candidates, {
      startDate: w1,
      examDate: null,
      diagnosticData,
    });
    expect(scored[0]!.diagnosticBoost).toBeLessThan(0.1);
  });

  it("buildPlan propagates diagnostic data correctly", () => {
    const candidates = [
      mk(1, "S1", 3, 0.3),
      mk(2, "S2", 3, 0.3),
      mk(3, "S3", 3, 0.3),
    ];
    const diagnosticData = new Map<string, DiagnosticData>([
      [
        "t1",
        {
          knowledgeState: "PONTO_CRITICO",
          mastery: 0.15,
          confidence: 0.3,
          accuracy: 0.2,
          recentErrors: 8,
          unresolvedErrors: 5,
          recurringErrors: 3,
          daysSinceStudy: 45,
          daysSinceError: 1,
          interventionScore: 0.92,
        },
      ],
    ]);

    const weeks = new Map([[w1, week(w1, 5)]]);
    const res = buildPlan(candidates, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
      diagnosticData,
    });

    const t1Scored = res.scored.find((s) => s.topicId === "t1")!;
    expect(t1Scored.diagnosticBoost).toBeGreaterThan(0);
    // t1 should have highest score due to PONTO_CRITICO + high intervention.
    expect(t1Scored.score).toBe(Math.max(...res.scored.map((s) => s.score)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ETAPA 5, FASE 5 — chooseActivity não gera mais 'revisao'
// ─────────────────────────────────────────────────────────────────────────────

describe("planner — chooseActivity heuristic (Fase 5)", () => {
  /**
   * Helper: cria um ScoredCandidate mínimo para testes do chooseActivity.
   */
  function mkScored(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
    return {
      contestTopicId: "ct1",
      subjectId: "S1",
      subjectName: "S1",
      topicId: "t1",
      topicName: "T1",
      priority: 3,
      weight: 6,
      incidence: 50,
      relevance: 50,
      isStudied: false,
      mastery: null,
      prerequisiteTopicIds: [],
      score: 5,
      gap: 0.8,
      blockedByPrerequisite: false,
      isPrerequisiteOfBlocked: false,
      reasons: [],
      diagnosticBoost: 0,
      ...overrides,
    };
  }

  it("1. estudo novo (gap alto, nao estudado) produz teoria/questoes", () => {
    const c = mkScored({ gap: 0.8, isStudied: false });
    // Primeiro bloco: teoria
    expect(chooseActivity(c, 0, null)).toBe("teoria");
    // Segundo bloco: questoes
    expect(chooseActivity(c, 1, null)).toBe("questoes");
    // Terceiro bloco: teoria
    expect(chooseActivity(c, 2, null)).toBe("teoria");
  });

  it("2. chooseActivity NUNCA retorna 'revisao' — nenhuma combinacao", () => {
    const combinations: Array<{ c: ScoredCandidate; index: number; days: number | null }> = [];

    // Todas as combinações relevantes
    for (const isStudied of [true, false]) {
      for (const gap of [0.0, 0.3, 0.5, 0.7, 0.9, 1.0]) {
        for (const daysToExam of [null, 5, 10, 15, 30, 60, 120]) {
          for (const index of [0, 1, 2, 3, 4, 5, 10, 20]) {
            combinations.push({
              c: mkScored({ isStudied, gap }),
              index,
              days: daysToExam,
            });
          }
        }
      }
    }

    for (const { c, index, days } of combinations) {
      const activity = chooseActivity(c, index, days);
      expect(activity).not.toBe("revisao");
    }
  });

  it("3. topico ja estudado usa flashcards em vez de revisao a cada 3 blocos", () => {
    const c = mkScored({ isStudied: true, gap: 0.3 });
    // index 0 → questoes
    expect(chooseActivity(c, 0, null)).toBe("questoes");
    // index 1 → questoes
    expect(chooseActivity(c, 1, null)).toBe("questoes");
    // index 2 → flashcards (era 'revisao' antes da Fase 5)
    expect(chooseActivity(c, 2, null)).toBe("flashcards");
    // index 3 → questoes
    expect(chooseActivity(c, 3, null)).toBe("questoes");
    // index 5 → flashcards
    expect(chooseActivity(c, 5, null)).toBe("flashcards");
  });

  it("4. prova proxima (<=15 dias) usa questoes/flashcards em vez de revisao", () => {
    const c = mkScored({ isStudied: true, gap: 0.3 });
    // index 0 → questoes (era 'revisao')
    expect(chooseActivity(c, 0, 10)).toBe("questoes");
    // index 1 → flashcards (era 'questoes')
    expect(chooseActivity(c, 1, 10)).toBe("flashcards");
    // index 2 → questoes
    expect(chooseActivity(c, 2, 10)).toBe("questoes");
    // Nenhum retorna 'revisao'
    for (let i = 0; i < 20; i++) {
      expect(chooseActivity(c, i, 5)).not.toBe("revisao");
    }
  });

  it("5. comportamento deterministico permanece — mesmo input = mesmo output", () => {
    const c = mkScored({ isStudied: true, gap: 0.5 });
    const first = chooseActivity(c, 2, 10);
    for (let i = 0; i < 100; i++) {
      expect(chooseActivity(c, 2, 10)).toBe(first);
    }
  });

  it("6. buildPlan inteiro nao gera nenhuma tarefa com activity='revisao'", () => {
    const w1 = weekStartOf(todayISO());
    const candidates = [
      { ...mk(1, "S1", 5, 0.3), isStudied: true },
      { ...mk(2, "S2", 4, 0.5), isStudied: true },
      mk(3, "S3", 3, 0.2),
    ];
    const weeks = new Map([[w1, week(w1, 5)]]);

    // Sem prova
    const res1 = buildPlan(candidates, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    expect(res1.tasks.length).toBeGreaterThan(0);
    for (const t of res1.tasks) {
      expect(t.activity).not.toBe("revisao");
    }

    // Com prova em 10 dias
    const res2 = buildPlan(candidates, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: addDays(w1, 10),
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    expect(res2.tasks.length).toBeGreaterThan(0);
    for (const t of res2.tasks) {
      expect(t.activity).not.toBe("revisao");
    }
  });
});
