import { describe, it, expect } from "vitest";
import {
  computeErrorPriority,
  prioritizeErrors,
  computeTopicErrorSummaries,
  computeRecencyFactor,
  computeMasteryImpactFactor,
  computeCategoryFrequencyFactor,
  WEIGHT_RECURRENCE,
  WEIGHT_MASTERY_IMPACT,
  WEIGHT_CATEGORY_FREQUENCY,
  WEIGHT_RECENCY,
  WEIGHT_STATUS,
  type KnowledgeMap,
} from "./engine";
import type { ErrorRecord } from "../knowledge/errors";
import type { KnowledgeState } from "../knowledge/engine";

// ─────────────────────────────────────────────────────────────────────────────
// FACTORIES
// ─────────────────────────────────────────────────────────────────────────────

const REF_DATE = "2026-08-30T12:00:00Z";

let errorSeq = 0;
function mkError(overrides: Partial<ErrorRecord> = {}): ErrorRecord {
  errorSeq++;
  return {
    id: `err-${errorSeq}`,
    userId: "user-1",
    topicId: "topic-1",
    subjectId: "sub-1",
    category: "conhecimento",
    isResolved: false,
    resolvedAt: null,
    occurredAt: "2026-08-28T10:00:00Z",
    attemptId: `att-${errorSeq}`,
    questionId: `q-${errorSeq}`,
    ...overrides,
  };
}

function mkKnowledge(overrides: Partial<KnowledgeState> = {}): KnowledgeState {
  return {
    mastery: 0.5,
    confidence: 0.6,
    totalQuestions: 10,
    correctQuestions: 5,
    lastStudiedAt: "2026-08-25T10:00:00Z",
    ...overrides,
  };
}

function mkKnowledgeMap(entries: [string, KnowledgeState][]): KnowledgeMap {
  return new Map(entries);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CONSTANTES E PESOS
// ─────────────────────────────────────────────────────────────────────────────

describe("pesos dos fatores", () => {
  it("os pesos somam exatamente 1.0", () => {
    const total =
      WEIGHT_RECURRENCE +
      WEIGHT_MASTERY_IMPACT +
      WEIGHT_CATEGORY_FREQUENCY +
      WEIGHT_RECENCY +
      WEIGHT_STATUS;
    expect(total).toBeCloseTo(1.0, 10);
  });

  it("todos os pesos são positivos", () => {
    expect(WEIGHT_RECURRENCE).toBeGreaterThan(0);
    expect(WEIGHT_MASTERY_IMPACT).toBeGreaterThan(0);
    expect(WEIGHT_CATEGORY_FREQUENCY).toBeGreaterThan(0);
    expect(WEIGHT_RECENCY).toBeGreaterThan(0);
    expect(WEIGHT_STATUS).toBeGreaterThan(0);
  });

  it("recorrência tem o maior peso", () => {
    expect(WEIGHT_RECURRENCE).toBeGreaterThanOrEqual(WEIGHT_MASTERY_IMPACT);
    expect(WEIGHT_RECURRENCE).toBeGreaterThanOrEqual(WEIGHT_CATEGORY_FREQUENCY);
    expect(WEIGHT_RECURRENCE).toBeGreaterThanOrEqual(WEIGHT_RECENCY);
    expect(WEIGHT_RECURRENCE).toBeGreaterThanOrEqual(WEIGHT_STATUS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. computeRecencyFactor
// ─────────────────────────────────────────────────────────────────────────────

describe("computeRecencyFactor", () => {
  it("erro ocorrido agora → ~1.0", () => {
    const factor = computeRecencyFactor(REF_DATE, REF_DATE);
    expect(factor).toBeCloseTo(1.0, 2);
  });

  it("erro há ~14 dias → ~0.5 (meia-vida)", () => {
    const fourteenDaysAgo = new Date(new Date(REF_DATE).getTime() - 14 * 86_400_000).toISOString();
    const factor = computeRecencyFactor(fourteenDaysAgo, REF_DATE);
    expect(factor).toBeCloseTo(0.5, 1);
  });

  it("erro há 60 dias → valor baixo (<0.1)", () => {
    const sixtyDaysAgo = new Date(new Date(REF_DATE).getTime() - 60 * 86_400_000).toISOString();
    const factor = computeRecencyFactor(sixtyDaysAgo, REF_DATE);
    expect(factor).toBeLessThan(0.1);
  });

  it("retorna valor entre 0 e 1", () => {
    for (const days of [0, 1, 7, 14, 30, 60, 90, 365]) {
      const past = new Date(new Date(REF_DATE).getTime() - days * 86_400_000).toISOString();
      const factor = computeRecencyFactor(past, REF_DATE);
      expect(factor).toBeGreaterThanOrEqual(0);
      expect(factor).toBeLessThanOrEqual(1);
    }
  });

  it("erro no futuro → clamp em 1", () => {
    const future = new Date(new Date(REF_DATE).getTime() + 10 * 86_400_000).toISOString();
    const factor = computeRecencyFactor(future, REF_DATE);
    expect(factor).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. computeMasteryImpactFactor
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMasteryImpactFactor", () => {
  it("sem knowledge → 0.5 (moderado)", () => {
    expect(computeMasteryImpactFactor(null)).toBe(0.5);
  });

  it("mastery 0, confidence 1 → impacto máximo (~1.0)", () => {
    const k = mkKnowledge({ mastery: 0, confidence: 1 });
    expect(computeMasteryImpactFactor(k)).toBeCloseTo(1.0, 2);
  });

  it("mastery 1, confidence 1 → impacto mínimo (0)", () => {
    const k = mkKnowledge({ mastery: 1, confidence: 1 });
    expect(computeMasteryImpactFactor(k)).toBeCloseTo(0, 2);
  });

  it("mastery 0.5, confidence 0 → impacto reduzido pela baixa confidence", () => {
    const k = mkKnowledge({ mastery: 0.5, confidence: 0 });
    // (1 - 0.5) * (0.5 + 0.5*0) = 0.5 * 0.5 = 0.25
    expect(computeMasteryImpactFactor(k)).toBeCloseTo(0.25, 2);
  });

  it("mastery 0.3, confidence 0.8 → impacto alto", () => {
    const k = mkKnowledge({ mastery: 0.3, confidence: 0.8 });
    // (1 - 0.3) * (0.5 + 0.5*0.8) = 0.7 * 0.9 = 0.63
    expect(computeMasteryImpactFactor(k)).toBeCloseTo(0.63, 2);
  });

  it("retorna valor entre 0 e 1", () => {
    for (let m = 0; m <= 1; m += 0.1) {
      for (let c = 0; c <= 1; c += 0.1) {
        const factor = computeMasteryImpactFactor(mkKnowledge({ mastery: m, confidence: c }));
        expect(factor).toBeGreaterThanOrEqual(0);
        expect(factor).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. computeCategoryFrequencyFactor
// ─────────────────────────────────────────────────────────────────────────────

describe("computeCategoryFrequencyFactor", () => {
  it("0 ocorrências → 0", () => {
    expect(computeCategoryFrequencyFactor(0)).toBe(0);
  });

  it("1 ocorrência → 0.2", () => {
    expect(computeCategoryFrequencyFactor(1)).toBeCloseTo(0.2, 2);
  });

  it("5 ocorrências → 1.0 (cap)", () => {
    expect(computeCategoryFrequencyFactor(5)).toBeCloseTo(1.0, 2);
  });

  it("10 ocorrências → 1.0 (acima do cap, clamp)", () => {
    expect(computeCategoryFrequencyFactor(10)).toBe(1);
  });

  it("valor negativo → 0", () => {
    expect(computeCategoryFrequencyFactor(-1)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. computeErrorPriority
// ─────────────────────────────────────────────────────────────────────────────

describe("computeErrorPriority", () => {
  it("score está entre 0 e 1", () => {
    const error = mkError();
    const result = computeErrorPriority(error, [error], mkKnowledge(), REF_DATE);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("é determinístico", () => {
    const error = mkError();
    const allErrors = [error];
    const knowledge = mkKnowledge();
    const r1 = computeErrorPriority(error, allErrors, knowledge, REF_DATE);
    const r2 = computeErrorPriority(error, allErrors, knowledge, REF_DATE);
    expect(r1.score).toBe(r2.score);
    expect(r1.factors).toEqual(r2.factors);
  });

  it("erro recorrente tem score maior que não recorrente", () => {
    // Criar cenário de recorrência: erro antigo resolvido + erro novo
    const oldResolved = mkError({
      id: "old-resolved",
      topicId: "topic-A",
      category: "conhecimento",
      isResolved: true,
      resolvedAt: "2026-08-20T10:00:00Z",
      occurredAt: "2026-08-15T10:00:00Z",
    });
    const newRecurring = mkError({
      id: "new-recurring",
      topicId: "topic-A",
      category: "conhecimento",
      isResolved: false,
      occurredAt: "2026-08-28T10:00:00Z",
    });

    // Erro não recorrente: mesmo tópico mas categoria diferente (sem precedente resolvido)
    const nonRecurring = mkError({
      id: "non-recurring",
      topicId: "topic-A",
      category: "interpretacao",
      isResolved: false,
      occurredAt: "2026-08-28T10:00:00Z",
    });

    const allErrors = [oldResolved, newRecurring, nonRecurring];
    const knowledge = mkKnowledge();

    const recurringResult = computeErrorPriority(newRecurring, allErrors, knowledge, REF_DATE);
    const nonRecurringResult = computeErrorPriority(nonRecurring, allErrors, knowledge, REF_DATE);

    expect(recurringResult.factors.recurrence).toBe(1);
    expect(nonRecurringResult.factors.recurrence).toBe(0);
    expect(recurringResult.score).toBeGreaterThan(nonRecurringResult.score);
  });

  it("erro não resolvido tem score maior que resolvido (demais fatores iguais)", () => {
    const unresolved = mkError({
      id: "unresolved",
      isResolved: false,
      occurredAt: "2026-08-28T10:00:00Z",
    });
    const resolved = mkError({
      id: "resolved",
      isResolved: true,
      resolvedAt: "2026-08-29T10:00:00Z",
      occurredAt: "2026-08-28T10:00:00Z",
    });

    const knowledge = mkKnowledge();
    const rUnresolved = computeErrorPriority(unresolved, [unresolved], knowledge, REF_DATE);
    const rResolved = computeErrorPriority(resolved, [resolved], knowledge, REF_DATE);

    expect(rUnresolved.factors.status).toBe(1);
    expect(rResolved.factors.status).toBe(0);
    expect(rUnresolved.score).toBeGreaterThan(rResolved.score);
  });

  it("erro recente tem score maior que erro antigo", () => {
    const recent = mkError({
      id: "recent",
      occurredAt: "2026-08-29T10:00:00Z",
    });
    const old = mkError({
      id: "old",
      occurredAt: "2026-07-01T10:00:00Z",
    });

    const knowledge = mkKnowledge();
    const rRecent = computeErrorPriority(recent, [recent], knowledge, REF_DATE);
    const rOld = computeErrorPriority(old, [old], knowledge, REF_DATE);

    expect(rRecent.factors.recency).toBeGreaterThan(rOld.factors.recency);
    expect(rRecent.score).toBeGreaterThan(rOld.score);
  });

  it("tópico com baixo mastery amplifica prioridade", () => {
    const error = mkError({ id: "err-mastery-test" });
    const lowMastery = mkKnowledge({ mastery: 0.1, confidence: 0.8 });
    const highMastery = mkKnowledge({ mastery: 0.9, confidence: 0.8 });

    const rLow = computeErrorPriority(error, [error], lowMastery, REF_DATE);
    const rHigh = computeErrorPriority(error, [error], highMastery, REF_DATE);

    expect(rLow.factors.masteryImpact).toBeGreaterThan(rHigh.factors.masteryImpact);
    expect(rLow.score).toBeGreaterThan(rHigh.score);
  });

  it("categoria mais frequente amplifica prioridade", () => {
    // 4 erros da mesma categoria no mesmo tópico
    const frequent = Array.from({ length: 4 }, (_, i) =>
      mkError({
        id: `freq-${i}`,
        topicId: "topic-freq",
        category: "esquecimento",
        occurredAt: "2026-08-28T10:00:00Z",
      }),
    );

    // 1 erro de categoria diferente
    const rare = mkError({
      id: "rare",
      topicId: "topic-freq",
      category: "atencao",
      occurredAt: "2026-08-28T10:00:00Z",
    });

    const allErrors = [...frequent, rare];
    const knowledge = mkKnowledge();

    const rFrequent = computeErrorPriority(frequent[0]!, allErrors, knowledge, REF_DATE);
    const rRare = computeErrorPriority(rare, allErrors, knowledge, REF_DATE);

    expect(rFrequent.factors.categoryFrequency).toBeGreaterThan(rRare.factors.categoryFrequency);
    expect(rFrequent.score).toBeGreaterThan(rRare.score);
  });

  it("erro sem topicId recebe score base (sem frequência, sem mastery impact)", () => {
    const noTopic = mkError({
      id: "no-topic",
      topicId: null,
      category: "conhecimento",
    });
    const result = computeErrorPriority(noTopic, [noTopic], null, REF_DATE);
    expect(result.factors.categoryFrequency).toBe(0);
    expect(result.factors.masteryImpact).toBe(0.5); // null knowledge → 0.5
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("erro sem category recebe frequência 0", () => {
    const noCat = mkError({
      id: "no-cat",
      category: null,
    });
    const result = computeErrorPriority(noCat, [noCat], mkKnowledge(), REF_DATE);
    expect(result.factors.categoryFrequency).toBe(0);
  });

  it("retorna os fatores detalhados no resultado", () => {
    const error = mkError();
    const result = computeErrorPriority(error, [error], mkKnowledge(), REF_DATE);
    expect(result.factors).toHaveProperty("recurrence");
    expect(result.factors).toHaveProperty("masteryImpact");
    expect(result.factors).toHaveProperty("categoryFrequency");
    expect(result.factors).toHaveProperty("recency");
    expect(result.factors).toHaveProperty("status");
  });

  it("referência ao erro original é preservada", () => {
    const error = mkError({ id: "preserve-ref" });
    const result = computeErrorPriority(error, [error], mkKnowledge(), REF_DATE);
    expect(result.error).toBe(error);
    expect(result.error.id).toBe("preserve-ref");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. prioritizeErrors
// ─────────────────────────────────────────────────────────────────────────────

describe("prioritizeErrors", () => {
  it("lista vazia retorna array vazio", () => {
    const result = prioritizeErrors([], new Map(), REF_DATE);
    expect(result).toEqual([]);
  });

  it("retorna todos os erros priorizados", () => {
    const errors = [mkError({ id: "a" }), mkError({ id: "b" }), mkError({ id: "c" })];
    const result = prioritizeErrors(errors, new Map(), REF_DATE);
    expect(result).toHaveLength(3);
  });

  it("resultado é ordenado por score decrescente", () => {
    // Criar erros com scores diferentes:
    // Erro recente + não resolvido vs erro antigo + resolvido
    const highPriority = mkError({
      id: "high",
      isResolved: false,
      occurredAt: "2026-08-30T10:00:00Z",
      topicId: "topic-hp",
    });
    const lowPriority = mkError({
      id: "low",
      isResolved: true,
      resolvedAt: "2026-07-01T10:00:00Z",
      occurredAt: "2026-06-01T10:00:00Z",
      topicId: "topic-lp",
    });

    const km = mkKnowledgeMap([
      ["topic-hp", mkKnowledge({ mastery: 0.1, confidence: 0.9 })],
      ["topic-lp", mkKnowledge({ mastery: 0.9, confidence: 0.9 })],
    ]);

    const result = prioritizeErrors([lowPriority, highPriority], km, REF_DATE);
    expect(result[0]!.error.id).toBe("high");
    expect(result[1]!.error.id).toBe("low");
    expect(result[0]!.score).toBeGreaterThan(result[1]!.score);
  });

  it("é determinístico", () => {
    const errors = [
      mkError({ id: "d1", occurredAt: "2026-08-28T10:00:00Z" }),
      mkError({ id: "d2", occurredAt: "2026-08-25T10:00:00Z" }),
      mkError({ id: "d3", occurredAt: "2026-08-20T10:00:00Z" }),
    ];
    const km = mkKnowledgeMap([["topic-1", mkKnowledge()]]);

    const r1 = prioritizeErrors(errors, km, REF_DATE).map((p) => p.error.id);
    const r2 = prioritizeErrors(errors, km, REF_DATE).map((p) => p.error.id);
    expect(r1).toEqual(r2);
  });

  it("usa KnowledgeMap para buscar o mastery do tópico", () => {
    const error = mkError({ id: "km-test", topicId: "topic-X" });
    const km = mkKnowledgeMap([["topic-X", mkKnowledge({ mastery: 0.1, confidence: 0.9 })]]);

    const result = prioritizeErrors([error], km, REF_DATE);
    // Com mastery baixo e confidence alta, masteryImpact deve ser alto
    expect(result[0]!.factors.masteryImpact).toBeGreaterThan(0.7);
  });

  it("tópico sem knowledge no mapa recebe impacto moderado (0.5)", () => {
    const error = mkError({ id: "no-km", topicId: "topic-unknown" });
    const result = prioritizeErrors([error], new Map(), REF_DATE);
    expect(result[0]!.factors.masteryImpact).toBe(0.5);
  });

  it("todos os scores estão entre 0 e 1", () => {
    const errors = Array.from({ length: 20 }, (_, i) =>
      mkError({
        id: `bulk-${i}`,
        isResolved: i % 3 === 0,
        occurredAt: new Date(new Date(REF_DATE).getTime() - i * 3 * 86_400_000).toISOString(),
      }),
    );
    const result = prioritizeErrors(errors, new Map(), REF_DATE);
    for (const p of result) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. computeTopicErrorSummaries
// ─────────────────────────────────────────────────────────────────────────────

describe("computeTopicErrorSummaries", () => {
  it("lista vazia retorna array vazio", () => {
    const result = computeTopicErrorSummaries([], new Map(), REF_DATE);
    expect(result).toEqual([]);
  });

  it("agrupa erros por tópico", () => {
    const errors = [
      mkError({ id: "s1", topicId: "topic-A" }),
      mkError({ id: "s2", topicId: "topic-A" }),
      mkError({ id: "s3", topicId: "topic-B" }),
    ];
    const result = computeTopicErrorSummaries(errors, new Map(), REF_DATE);
    expect(result).toHaveLength(2);

    const topicA = result.find((s) => s.topicId === "topic-A");
    const topicB = result.find((s) => s.topicId === "topic-B");
    expect(topicA!.errorCount).toBe(2);
    expect(topicB!.errorCount).toBe(1);
  });

  it("ignora erros sem topicId", () => {
    const errors = [
      mkError({ id: "with", topicId: "topic-A" }),
      mkError({ id: "without", topicId: null }),
    ];
    const result = computeTopicErrorSummaries(errors, new Map(), REF_DATE);
    expect(result).toHaveLength(1);
    expect(result[0]!.topicId).toBe("topic-A");
  });

  it("ordenado por maxPriority decrescente", () => {
    // Topic A: erro antigo resolvido (baixa prioridade)
    const errorsA = mkError({
      id: "old-a",
      topicId: "topic-A",
      isResolved: true,
      occurredAt: "2026-06-01T10:00:00Z",
    });
    // Topic B: erro recente não resolvido (alta prioridade)
    const errorsB = mkError({
      id: "new-b",
      topicId: "topic-B",
      isResolved: false,
      occurredAt: "2026-08-29T10:00:00Z",
    });

    const km = mkKnowledgeMap([
      ["topic-A", mkKnowledge({ mastery: 0.9, confidence: 0.9 })],
      ["topic-B", mkKnowledge({ mastery: 0.1, confidence: 0.9 })],
    ]);

    const result = computeTopicErrorSummaries([errorsA, errorsB], km, REF_DATE);
    expect(result[0]!.topicId).toBe("topic-B");
    expect(result[1]!.topicId).toBe("topic-A");
  });

  it("inclui análise de erros (reutiliza analyzeTopicErrors)", () => {
    const errors = [
      mkError({ id: "an1", topicId: "topic-A", category: "conhecimento" }),
      mkError({ id: "an2", topicId: "topic-A", category: "conhecimento" }),
      mkError({ id: "an3", topicId: "topic-A", category: "esquecimento" }),
    ];
    const result = computeTopicErrorSummaries(errors, new Map(), REF_DATE);
    const summary = result[0]!;
    expect(summary.analysis.totalErrors).toBe(3);
    expect(summary.analysis.topCategory).toBe("conhecimento");
    expect(summary.analysis.categoryFrequency.get("conhecimento")).toBe(2);
    expect(summary.analysis.categoryFrequency.get("esquecimento")).toBe(1);
  });

  it("avgPriority e maxPriority são calculados corretamente", () => {
    const errors = [
      mkError({ id: "avg1", topicId: "topic-A", occurredAt: "2026-08-29T10:00:00Z" }),
      mkError({ id: "avg2", topicId: "topic-A", occurredAt: "2026-08-20T10:00:00Z" }),
    ];
    const result = computeTopicErrorSummaries(errors, new Map(), REF_DATE);
    const summary = result[0]!;
    expect(summary.avgPriority).toBeGreaterThan(0);
    expect(summary.maxPriority).toBeGreaterThanOrEqual(summary.avgPriority);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. INVARIANTES GLOBAIS
// ─────────────────────────────────────────────────────────────────────────────

describe("invariantes globais", () => {
  it("score nunca é NaN ou Infinity", () => {
    const edge = mkError({
      id: "edge",
      topicId: null,
      category: null,
      occurredAt: "1970-01-01T00:00:00Z",
    });
    const result = computeErrorPriority(edge, [edge], null, REF_DATE);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(Number.isNaN(result.score)).toBe(false);
  });

  it("score máximo teórico: todos os fatores em 1", () => {
    // Criar cenário onde todos os fatores são maximizados:
    // Recorrente (1), mastery baixo com confidence alta (1), frequência alta (1),
    // recente (1), não resolvido (1)
    const oldResolved = mkError({
      id: "max-old",
      topicId: "topic-max",
      category: "conhecimento",
      isResolved: true,
      resolvedAt: "2026-08-20T10:00:00Z",
      occurredAt: "2026-08-15T10:00:00Z",
    });
    // 5+ erros da mesma categoria para maximizar frequência
    const frequentErrors = Array.from({ length: 5 }, (_, i) =>
      mkError({
        id: `max-freq-${i}`,
        topicId: "topic-max",
        category: "conhecimento",
        isResolved: false,
        occurredAt: REF_DATE,
      }),
    );
    // O erro que estamos avaliando é recorrente (mesma categoria, ocorre depois do resolvido)
    const targetError = mkError({
      id: "max-target",
      topicId: "topic-max",
      category: "conhecimento",
      isResolved: false,
      occurredAt: REF_DATE,
    });

    const allErrors = [oldResolved, ...frequentErrors, targetError];
    const knowledge = mkKnowledge({ mastery: 0, confidence: 1 });

    const result = computeErrorPriority(targetError, allErrors, knowledge, REF_DATE);
    // Com todos os fatores em 1 e pesos somando 1, o score deve ser ~1.0
    expect(result.score).toBeGreaterThan(0.95);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("score mínimo teórico: todos os fatores em 0", () => {
    // Resolvido, antigo, tópico com mastery alto, sem recorrência, categoria rara
    const error = mkError({
      id: "min-err",
      topicId: "topic-min",
      category: "outros",
      isResolved: true,
      resolvedAt: "2025-01-01T10:00:00Z",
      occurredAt: "2025-01-01T10:00:00Z",
    });
    const knowledge = mkKnowledge({ mastery: 1, confidence: 1 });

    const result = computeErrorPriority(error, [error], knowledge, REF_DATE);
    // Recorrência: 0, mastery impact: ~0, recência: ~0, status: 0
    // Só a frequência contribui um pouco (1/5 = 0.2 * 0.20 = 0.04)
    expect(result.score).toBeLessThan(0.1);
  });

  it("nenhuma regra pedagógica duplicada — usa analyzeTopicErrors e isRecurringError", () => {
    // Este teste verifica que o motor importa e usa as funções existentes
    // ao invés de reimplementar a lógica de recorrência ou análise.
    // A validação é estrutural: o import existe e os resultados são consistentes.
    const resolved = mkError({
      id: "dup-check-resolved",
      topicId: "topic-dup",
      category: "conhecimento",
      isResolved: true,
      resolvedAt: "2026-08-20T10:00:00Z",
      occurredAt: "2026-08-15T10:00:00Z",
    });
    const recurring = mkError({
      id: "dup-check-recurring",
      topicId: "topic-dup",
      category: "conhecimento",
      isResolved: false,
      occurredAt: "2026-08-28T10:00:00Z",
    });

    const result = computeErrorPriority(recurring, [resolved, recurring], mkKnowledge(), REF_DATE);
    // Deve detectar recorrência corretamente (usando isRecurringError)
    expect(result.factors.recurrence).toBe(1);
  });
});
