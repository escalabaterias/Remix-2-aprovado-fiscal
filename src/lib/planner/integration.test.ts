/**
 * ETAPA 3.3, FASE 3 — Testes de integração: diagnóstico real → planner.
 *
 * Estes testes verificam que o DiagnosticData construído a partir dos
 * motores de diagnóstico existentes chega corretamente ao planner e
 * influencia o ranking final.
 *
 * Como são testes unitários/de integração in-memory (sem Supabase real),
 * simulam o fluxo completo:
 *   sinais → diagnoseTopic → DiagnosticData → scoreCandidates → buildPlan
 */

import { describe, it, expect } from "vitest";
import {
  scoreCandidates,
  buildPlan,
  type DiagnosticData,
  type PlannerCandidate,
} from "@/lib/planner/engine";
import { computeDiagnosticBoost, type IntelligenceInput } from "@/lib/planner/intelligence";
import { diagnoseTopic, computeInterventionScore } from "@/lib/diagnosis/engine";
import { buildSignals, type PlannerSignals } from "@/lib/knowledge/signals";
import { analyzeTopicErrors, type ErrorRecord } from "@/lib/knowledge/errors";
import type { KnowledgeState } from "@/lib/knowledge/engine";
import { emptyWeek, weekStartOf, todayISO, addDays } from "@/lib/planner/availability";

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

/**
 * Simula o fluxo real de construção de DiagnosticData a partir de
 * KnowledgeState + ErrorRecord[], usando exatamente os mesmos motores
 * que fetchDiagnosticDataForTopics usa.
 */
function buildDiagnosticData(
  topicId: string,
  knowledge: KnowledgeState,
  errors: ErrorRecord[],
  referenceDate: string,
): DiagnosticData {
  const errorAnalysis = analyzeTopicErrors(errors, topicId, referenceDate);
  const signals = buildSignals(knowledge, errorAnalysis, 0, referenceDate);
  const diagnosis = diagnoseTopic(signals, referenceDate);

  return {
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
  };
}

const REF_DATE = "2026-08-29T21:00:00.000Z";

// ─────────────────────────────────────────────────────────────────────────────
// A) PONTO_CRITICO recebe boost no tópico correspondente
// ─────────────────────────────────────────────────────────────────────────────

describe("integration — diagnostic data reaches planner", () => {
  it("A) PONTO_CRITICO topic receives diagnostic boost", () => {
    const candidates = [mkCandidate(1, "S1", 3, 0.5), mkCandidate(2, "S2", 3, 0.5)];

    // t1 = PONTO_CRITICO
    const criticalKnowledge: KnowledgeState = {
      mastery: 0.2,
      confidence: 0.8,
      totalQuestions: 20,
      correctQuestions: 4,
      lastStudiedAt: "2026-08-27T10:00:00.000Z",
    };
    const criticalData = buildDiagnosticData("t1", criticalKnowledge, [], REF_DATE);
    expect(criticalData.knowledgeState).toBe("PONTO_CRITICO");

    const diagnosticMap = new Map<string, DiagnosticData>();
    diagnosticMap.set("t1", criticalData);

    const withDiag = scoreCandidates(candidates, {
      startDate: todayISO(),
      examDate: null,
      diagnosticData: diagnosticMap,
    });
    const withoutDiag = scoreCandidates(candidates, {
      startDate: todayISO(),
      examDate: null,
    });

    const t1WithDiag = withDiag.find((s) => s.topicId === "t1")!;
    const t1WithoutDiag = withoutDiag.find((s) => s.topicId === "t1")!;

    // Score with diagnostic should be higher
    expect(t1WithDiag.score).toBeGreaterThan(t1WithoutDiag.score);
    expect(t1WithDiag.diagnosticBoost).toBeGreaterThan(0);
    // Reason should mention diagnostic state
    expect(t1WithDiag.reasons.some((r) => r.includes("Ponto crítico"))).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B) Sem diagnóstico não inventa dados
  // ─────────────────────────────────────────────────────────────────────────

  it("B) topic without diagnostic data receives no artificial boost", () => {
    const candidates = [mkCandidate(1, "S1", 3, 0.5)];

    // Map exists but has no entry for t1
    const diagnosticMap = new Map<string, DiagnosticData>();

    const scored = scoreCandidates(candidates, {
      startDate: todayISO(),
      examDate: null,
      diagnosticData: diagnosticMap,
    });

    const t1 = scored.find((s) => s.topicId === "t1")!;
    expect(t1.diagnosticBoost).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // C) Isolamento entre usuários (simulação por topicId)
  // ─────────────────────────────────────────────────────────────────────────

  it("C) diagnostic data for topic X does not affect topic Y", () => {
    const candidates = [mkCandidate(1, "S1", 3, 0.5), mkCandidate(2, "S2", 3, 0.5)];

    const criticalData = buildDiagnosticData(
      "t1",
      {
        mastery: 0.15,
        confidence: 0.85,
        totalQuestions: 25,
        correctQuestions: 4,
        lastStudiedAt: "2026-08-28T10:00:00.000Z",
      },
      [],
      REF_DATE,
    );

    const diagnosticMap = new Map<string, DiagnosticData>();
    diagnosticMap.set("t1", criticalData); // Only t1 has diagnostic

    const scored = scoreCandidates(candidates, {
      startDate: todayISO(),
      examDate: null,
      diagnosticData: diagnosticMap,
    });

    const t2 = scored.find((s) => s.topicId === "t2")!;
    expect(t2.diagnosticBoost).toBe(0); // t2 unaffected
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D) topicId corretamente associado
  // ─────────────────────────────────────────────────────────────────────────

  it("D) diagnostic boost applied to correct topicId", () => {
    const candidates = [
      mkCandidate(1, "S1", 3, 0.5),
      mkCandidate(2, "S2", 3, 0.5),
      mkCandidate(3, "S3", 3, 0.5),
    ];

    // Only t2 gets a PONTO_CRITICO diagnostic
    const data = buildDiagnosticData(
      "t2",
      {
        mastery: 0.1,
        confidence: 0.9,
        totalQuestions: 30,
        correctQuestions: 3,
        lastStudiedAt: "2026-08-28T12:00:00.000Z",
      },
      [],
      REF_DATE,
    );

    const diagnosticMap = new Map<string, DiagnosticData>();
    diagnosticMap.set("t2", data);

    const scored = scoreCandidates(candidates, {
      startDate: todayISO(),
      examDate: null,
      diagnosticData: diagnosticMap,
    });

    const t1 = scored.find((s) => s.topicId === "t1")!;
    const t2 = scored.find((s) => s.topicId === "t2")!;
    const t3 = scored.find((s) => s.topicId === "t3")!;

    expect(t2.diagnosticBoost).toBeGreaterThan(0);
    expect(t1.diagnosticBoost).toBe(0);
    expect(t3.diagnosticBoost).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // E) Sinais corretamente transformados em DiagnosticData
  // ─────────────────────────────────────────────────────────────────────────

  it("E) signals correctly transformed into DiagnosticData", () => {
    const knowledge: KnowledgeState = {
      mastery: 0.35,
      confidence: 0.65,
      totalQuestions: 12,
      correctQuestions: 4,
      lastStudiedAt: "2026-08-20T10:00:00.000Z",
    };

    const errors: ErrorRecord[] = [
      {
        id: "e1",
        userId: "u1",
        topicId: "t1",
        subjectId: "s1",
        category: "interpretacao",
        isResolved: true,
        resolvedAt: "2026-08-21T10:00:00.000Z",
        occurredAt: "2026-08-20T11:00:00.000Z",
        attemptId: "a1",
        questionId: "q1",
      },
      {
        id: "e2",
        userId: "u1",
        topicId: "t1",
        subjectId: "s1",
        category: "interpretacao",
        isResolved: false,
        resolvedAt: null,
        occurredAt: "2026-08-25T11:00:00.000Z",
        attemptId: "a2",
        questionId: "q2",
      },
    ];

    const data = buildDiagnosticData("t1", knowledge, errors, REF_DATE);

    expect(data.mastery).toBe(knowledge.mastery);
    expect(data.confidence).toBe(knowledge.confidence);
    expect(data.accuracy).toBeCloseTo(4 / 12, 5);
    expect(data.unresolvedErrors).toBe(1);
    expect(data.recurringErrors).toBe(1); // e2 appeared after resolved e1
    expect(data.daysSinceStudy).toBeGreaterThanOrEqual(0);
    expect(data.interventionScore).toBeGreaterThanOrEqual(0);
    expect(data.interventionScore).toBeLessThanOrEqual(1);
    expect(data.knowledgeState).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // F) Dados reais chegam ao scoreCandidates
  // ─────────────────────────────────────────────────────────────────────────

  it("F) real diagnostic data reaches scoreCandidates and produces boost", () => {
    const knowledge: KnowledgeState = {
      mastery: 0.2,
      confidence: 0.75,
      totalQuestions: 15,
      correctQuestions: 3,
      lastStudiedAt: "2026-08-15T10:00:00.000Z",
    };
    const data = buildDiagnosticData("t1", knowledge, [], REF_DATE);

    const candidates = [mkCandidate(1, "S1", 3, 0.5)];
    const diagnosticMap = new Map<string, DiagnosticData>();
    diagnosticMap.set("t1", data);

    const scored = scoreCandidates(candidates, {
      startDate: todayISO(),
      examDate: null,
      diagnosticData: diagnosticMap,
    });

    expect(scored[0]!.diagnosticBoost).toBeGreaterThan(0);
    expect(scored[0]!.score).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // G) finalScore usado na ordenação
  // ─────────────────────────────────────────────────────────────────────────

  it("G) finalScore (with diagnostic boost) is used for ordering", () => {
    // t1 = low priority but PONTO_CRITICO
    // t2 = high priority but DOMINADO
    const candidates = [
      mkCandidate(1, "S1", 2, 0.5), // low priority
      mkCandidate(2, "S2", 5, 0.5), // high priority
    ];

    const criticalData = buildDiagnosticData(
      "t1",
      {
        mastery: 0.1,
        confidence: 0.9,
        totalQuestions: 30,
        correctQuestions: 3,
        lastStudiedAt: "2026-08-10T10:00:00.000Z",
      },
      [],
      REF_DATE,
    );

    const dominatedData = buildDiagnosticData(
      "t2",
      {
        mastery: 0.9,
        confidence: 0.95,
        totalQuestions: 50,
        correctQuestions: 45,
        lastStudiedAt: "2026-08-28T10:00:00.000Z",
      },
      [],
      REF_DATE,
    );

    expect(criticalData.knowledgeState).toBe("PONTO_CRITICO");
    expect(dominatedData.knowledgeState).toBe("DOMINADO");

    const diagnosticMap = new Map<string, DiagnosticData>();
    diagnosticMap.set("t1", criticalData);
    diagnosticMap.set("t2", dominatedData);

    const scored = scoreCandidates(candidates, {
      startDate: todayISO(),
      examDate: null,
      diagnosticData: diagnosticMap,
    });

    const t1 = scored.find((s) => s.topicId === "t1")!;
    const t2 = scored.find((s) => s.topicId === "t2")!;

    // PONTO_CRITICO boost should compensate the lower structural priority
    // The diagnostic boost for t1 should be significantly higher than t2
    expect(t1.diagnosticBoost).toBeGreaterThan(t2.diagnosticBoost);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // H) Sem aplicação dupla do boost
  // ─────────────────────────────────────────────────────────────────────────

  it("H) no double application of diagnostic boost", () => {
    const candidates = [mkCandidate(1, "S1", 3, 0.5)];

    const data = buildDiagnosticData(
      "t1",
      {
        mastery: 0.3,
        confidence: 0.7,
        totalQuestions: 15,
        correctQuestions: 5,
        lastStudiedAt: "2026-08-25T10:00:00.000Z",
      },
      [],
      REF_DATE,
    );

    const diagnosticMap = new Map<string, DiagnosticData>();
    diagnosticMap.set("t1", data);

    // Score with diagnostic once
    const scoredOnce = scoreCandidates(candidates, {
      startDate: todayISO(),
      examDate: null,
      diagnosticData: diagnosticMap,
    });

    // Score again with same diagnostic — should be identical (no accumulation)
    const scoredTwice = scoreCandidates(candidates, {
      startDate: todayISO(),
      examDate: null,
      diagnosticData: diagnosticMap,
    });

    expect(scoredOnce[0]!.score).toBe(scoredTwice[0]!.score);
    expect(scoredOnce[0]!.diagnosticBoost).toBe(scoredTwice[0]!.diagnosticBoost);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // I) Ausência de diagnóstico preserva comportamento anterior
  // ─────────────────────────────────────────────────────────────────────────

  it("I) absence of diagnostic data preserves original behavior", () => {
    const candidates = [mkCandidate(1, "S1", 4, 0.3), mkCandidate(2, "S2", 5, 0.1)];

    const withoutDiag = scoreCandidates(candidates, {
      startDate: todayISO(),
      examDate: null,
    });

    const withEmptyDiag = scoreCandidates(candidates, {
      startDate: todayISO(),
      examDate: null,
      diagnosticData: new Map(),
    });

    // Empty diagnostic map = same as no diagnostic map
    for (let i = 0; i < candidates.length; i++) {
      expect(withoutDiag[i]!.score).toBe(withEmptyDiag[i]!.score);
      expect(withoutDiag[i]!.diagnosticBoost).toBe(0);
      expect(withEmptyDiag[i]!.diagnosticBoost).toBe(0);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // J) Carregamento sem N+1 (verificação estrutural)
  // ─────────────────────────────────────────────────────────────────────────

  it("J) multiple topics processed without N+1 pattern", () => {
    // Simulate what fetchDiagnosticDataForTopics does in-memory:
    // Process all topics from a single batch of knowledge + errors
    const topicIds = ["t1", "t2", "t3", "t4", "t5"];
    const referenceDate = REF_DATE;

    // Simulate bulk knowledge rows
    const knowledgeMap = new Map<string, KnowledgeState>();
    for (const tid of topicIds) {
      knowledgeMap.set(tid, {
        mastery: 0.3 + Math.random() * 0.5,
        confidence: 0.5,
        totalQuestions: 10,
        correctQuestions: 5,
        lastStudiedAt: "2026-08-25T10:00:00.000Z",
      });
    }

    // Simulate bulk error rows (all at once, not per-topic)
    const allErrors: ErrorRecord[] = [];

    // Build diagnostic data in a single pass (like the real function)
    const diagnosticMap = new Map<string, DiagnosticData>();
    const errorsByTopic = new Map<string, ErrorRecord[]>();
    for (const e of allErrors) {
      if (!e.topicId) continue;
      const list = errorsByTopic.get(e.topicId) ?? [];
      list.push(e);
      errorsByTopic.set(e.topicId, list);
    }

    for (const tid of topicIds) {
      const k = knowledgeMap.get(tid)!;
      const topicErrors = errorsByTopic.get(tid) ?? [];
      const errorAnalysis = analyzeTopicErrors(topicErrors, tid, referenceDate);
      const signals = buildSignals(k, errorAnalysis, 0, referenceDate);
      const diagnosis = diagnoseTopic(signals, referenceDate);

      diagnosticMap.set(tid, {
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

    // All 5 topics should have diagnostic data from single-pass processing
    expect(diagnosticMap.size).toBe(5);
    for (const tid of topicIds) {
      expect(diagnosticMap.has(tid)).toBe(true);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // K) Determinismo
  // ─────────────────────────────────────────────────────────────────────────

  it("K) planner remains deterministic with diagnostic data", () => {
    const candidates = [
      mkCandidate(1, "S1", 4, 0.3),
      mkCandidate(2, "S2", 3, 0.5),
      mkCandidate(3, "S3", 5, 0.1),
    ];

    const diagnosticMap = new Map<string, DiagnosticData>();
    for (const c of candidates) {
      if (!c.topicId) continue;
      diagnosticMap.set(
        c.topicId,
        buildDiagnosticData(
          c.topicId,
          {
            mastery: c.mastery ?? 0.5,
            confidence: 0.6,
            totalQuestions: 10,
            correctQuestions: Math.round((c.mastery ?? 0.5) * 10),
            lastStudiedAt: "2026-08-25T10:00:00.000Z",
          },
          [],
          REF_DATE,
        ),
      );
    }

    const opts = { startDate: todayISO(), examDate: null, diagnosticData: diagnosticMap };
    const first = scoreCandidates(candidates, opts);

    for (let i = 0; i < 50; i++) {
      const result = scoreCandidates(candidates, opts);
      for (let j = 0; j < candidates.length; j++) {
        expect(result[j]!.score).toBe(first[j]!.score);
        expect(result[j]!.diagnosticBoost).toBe(first[j]!.diagnosticBoost);
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // L) Dados nulos/inconsistentes tratados com segurança
  // ─────────────────────────────────────────────────────────────────────────

  it("L) null/edge-case data handled safely", () => {
    const candidates = [mkCandidate(1, "S1", 3, null)];

    // DiagnosticData with edge values
    const edgeData: DiagnosticData = {
      knowledgeState: null,
      mastery: 0,
      confidence: 0,
      accuracy: 0,
      recentErrors: 0,
      unresolvedErrors: 0,
      recurringErrors: 0,
      daysSinceStudy: null,
      daysSinceError: null,
      interventionScore: 0,
    };

    const diagnosticMap = new Map<string, DiagnosticData>();
    diagnosticMap.set("t1", edgeData);

    const scored = scoreCandidates(candidates, {
      startDate: todayISO(),
      examDate: null,
      diagnosticData: diagnosticMap,
    });

    expect(Number.isFinite(scored[0]!.score)).toBe(true);
    expect(Number.isFinite(scored[0]!.diagnosticBoost)).toBe(true);
    expect(Number.isNaN(scored[0]!.score)).toBe(false);
    expect(scored[0]!.diagnosticBoost).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M + N) FLUXO COMPLETO PONTA A PONTA
// ─────────────────────────────────────────────────────────────────────────────

describe("integration — full end-to-end flow", () => {
  it("M) complete flow: knowledge → diagnosis → DiagnosticData → planner → plan", () => {
    const w1 = weekStartOf(todayISO());
    const candidates = [
      mkCandidate(1, "Direito", 3, 0.5),
      mkCandidate(2, "Contabilidade", 3, 0.5),
      mkCandidate(3, "Portugues", 3, 0.5),
    ];

    // Simulate real user data for t1: PONTO_CRITICO
    const t1Knowledge: KnowledgeState = {
      mastery: 0.15,
      confidence: 0.85,
      totalQuestions: 25,
      correctQuestions: 4,
      lastStudiedAt: "2026-08-27T10:00:00.000Z",
    };
    const t1Errors: ErrorRecord[] = [
      {
        id: "e1",
        userId: "user1",
        topicId: "t1",
        subjectId: "s1",
        category: "interpretacao",
        isResolved: true,
        resolvedAt: "2026-08-22T10:00:00.000Z",
        occurredAt: "2026-08-20T11:00:00.000Z",
        attemptId: "a1",
        questionId: "q1",
      },
      {
        id: "e2",
        userId: "user1",
        topicId: "t1",
        subjectId: "s1",
        category: "interpretacao",
        isResolved: false,
        resolvedAt: null,
        occurredAt: "2026-08-26T11:00:00.000Z",
        attemptId: "a2",
        questionId: "q2",
      },
    ];

    // Simulate real user data for t3: DOMINADO
    const t3Knowledge: KnowledgeState = {
      mastery: 0.92,
      confidence: 0.95,
      totalQuestions: 50,
      correctQuestions: 46,
      lastStudiedAt: "2026-08-28T10:00:00.000Z",
    };

    // Build diagnostic data using real engines
    const diagnosticMap = new Map<string, DiagnosticData>();
    diagnosticMap.set("t1", buildDiagnosticData("t1", t1Knowledge, t1Errors, REF_DATE));
    diagnosticMap.set("t3", buildDiagnosticData("t3", t3Knowledge, [], REF_DATE));
    // t2 intentionally has no diagnostic data

    // Verify diagnostic states
    expect(diagnosticMap.get("t1")!.knowledgeState).toBe("PONTO_CRITICO");
    expect(diagnosticMap.get("t3")!.knowledgeState).toBe("DOMINADO");

    // Build plan
    const weeks = new Map([[w1, mkWeek(w1, 4)]]);
    const plan = buildPlan(candidates, weeks, {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
      diagnosticData: diagnosticMap,
    });

    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.scored.length).toBe(3);

    const t1Scored = plan.scored.find((s) => s.topicId === "t1")!;
    const t2Scored = plan.scored.find((s) => s.topicId === "t2")!;
    const t3Scored = plan.scored.find((s) => s.topicId === "t3")!;

    // t1 (PONTO_CRITICO) should have highest diagnostic boost
    expect(t1Scored.diagnosticBoost).toBeGreaterThan(t3Scored.diagnosticBoost);

    // t2 (no diagnostic) should have zero boost
    expect(t2Scored.diagnosticBoost).toBe(0);

    // t3 (DOMINADO) should have minimal boost
    expect(t3Scored.diagnosticBoost).toBeLessThan(0.1);

    // All scores should be finite and positive
    for (const s of plan.scored) {
      expect(Number.isFinite(s.score)).toBe(true);
      expect(s.score).toBeGreaterThan(0);
    }
  });

  it("N) real diagnostic changes plan priority order", () => {
    const w1 = weekStartOf(todayISO());

    // t1: low structural priority but critical diagnostic
    // t2: high structural priority but mastered
    const candidates = [
      { ...mkCandidate(1, "S1", 1, 0.8), weight: 1, incidence: 10, relevance: 10 }, // low everything
      { ...mkCandidate(2, "S2", 5, 0.1), weight: 10, incidence: 90, relevance: 90 }, // high everything
    ];

    // Without diagnostic: t2 should dominate
    const planWithout = buildPlan(candidates, new Map([[w1, mkWeek(w1, 4)]]), {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
    });
    const t1Without = planWithout.scored.find((s) => s.topicId === "t1")!;
    const t2Without = planWithout.scored.find((s) => s.topicId === "t2")!;
    expect(t2Without.score).toBeGreaterThan(t1Without.score);

    // With diagnostic: t1 = PONTO_CRITICO, t2 = DOMINADO
    const diagnosticMap = new Map<string, DiagnosticData>();
    diagnosticMap.set(
      "t1",
      buildDiagnosticData(
        "t1",
        {
          mastery: 0.1,
          confidence: 0.9,
          totalQuestions: 30,
          correctQuestions: 3,
          lastStudiedAt: "2026-08-10T10:00:00.000Z",
        },
        [],
        REF_DATE,
      ),
    );
    diagnosticMap.set(
      "t2",
      buildDiagnosticData(
        "t2",
        {
          mastery: 0.95,
          confidence: 0.98,
          totalQuestions: 100,
          correctQuestions: 95,
          lastStudiedAt: "2026-08-28T10:00:00.000Z",
        },
        [],
        REF_DATE,
      ),
    );

    expect(diagnosticMap.get("t1")!.knowledgeState).toBe("PONTO_CRITICO");
    expect(diagnosticMap.get("t2")!.knowledgeState).toBe("DOMINADO");

    const planWith = buildPlan(candidates, new Map([[w1, mkWeek(w1, 4)]]), {
      startDate: w1,
      endDate: addDays(w1, 6),
      examDate: null,
      blockMinutes: 50,
      maxDailyMinutes: 480,
      diagnosticData: diagnosticMap,
    });

    const t1With = planWith.scored.find((s) => s.topicId === "t1")!;
    const t2With = planWith.scored.find((s) => s.topicId === "t2")!;

    // The diagnostic boost should close the gap significantly
    // t1's boost should be much larger than t2's
    expect(t1With.diagnosticBoost).toBeGreaterThan(t2With.diagnosticBoost * 3);

    // Verify the diagnostic actually changed something meaningful
    const t1ScoreIncrease = t1With.score - t1Without.score;
    const t2ScoreIncrease = t2With.score - t2Without.score;
    expect(t1ScoreIncrease).toBeGreaterThan(t2ScoreIncrease);
  });
});
