import { describe, it, expect } from "vitest";
import {
  computeReviewDecision,
  computeReviewInterval,
  computeReviewUrgency,
  computeNeedsReview,
  classifyReviewType,
  classifyReviewIntensity,
  buildReviewReason,
  BASE_INTERVALS,
  DEFAULT_INTERVAL_NO_DIAGNOSIS,
  REVIEW_RESULT_FACTORS,
  URGENCY_THRESHOLD,
} from "./engine";
import type { TopicReviewInput, TopicReviewDecision } from "./types";
import type { KnowledgeStateName } from "../diagnosis/engine";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const REF_DATE = "2026-08-29";

function mkInput(overrides: Partial<TopicReviewInput> = {}): TopicReviewInput {
  return {
    topicId: "t1",
    mastery: 0.5,
    confidence: 0.5,
    accuracy: 0.5,
    knowledgeState: "APRENDIZAGEM",
    interventionScore: 0.5,
    daysSinceStudy: 5,
    unresolvedErrors: 0,
    recurringErrors: 0,
    lastReviewDate: null,
    reviewCount: 0,
    lastReviewResult: null,
    referenceDate: REF_DATE,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CENÁRIOS OBRIGATÓRIOS (1–35)
// ═══════════════════════════════════════════════════════════════════════════

describe("review engine — cenários obrigatórios", () => {
  // 1. DOMINADO recente → não revisar
  it("1 — DOMINADO recente não precisa de revisão", () => {
    const d = computeReviewDecision(
      mkInput({
        knowledgeState: "DOMINADO",
        mastery: 0.9,
        confidence: 0.9,
        accuracy: 0.85,
        daysSinceStudy: 2,
        reviewCount: 3,
        lastReviewResult: "success",
        lastReviewDate: "2026-08-27",
      }),
    );
    expect(d.needsReview).toBe(false);
  });

  // 2. DOMINADO antigo → manutenção
  it("2 — DOMINADO antigo gera revisão de manutenção", () => {
    const d = computeReviewDecision(
      mkInput({
        knowledgeState: "DOMINADO",
        mastery: 0.85,
        confidence: 0.85,
        accuracy: 0.8,
        daysSinceStudy: 30,
        reviewCount: 2,
        lastReviewResult: "success",
        lastReviewDate: "2026-07-30",
      }),
    );
    expect(d.needsReview).toBe(true);
    expect(d.reviewType).toBe("manutencao");
  });

  // 3. CONSOLIDANDO → consolidação
  it("3 — CONSOLIDANDO gera revisão de consolidação", () => {
    const d = computeReviewDecision(
      mkInput({
        knowledgeState: "CONSOLIDANDO",
        mastery: 0.75,
        confidence: 0.5,
        accuracy: 0.7,
        daysSinceStudy: 12,
      }),
    );
    expect(d.reviewType).toBe("consolidacao");
  });

  // 4. APRENDIZAGEM → intervalo curto
  it("4 — APRENDIZAGEM tem intervalo curto", () => {
    const d = computeReviewDecision(
      mkInput({
        knowledgeState: "APRENDIZAGEM",
        mastery: 0.4,
        confidence: 0.5,
        accuracy: 0.4,
        daysSinceStudy: 7,
      }),
    );
    expect(d.reviewInterval).toBeLessThanOrEqual(10);
    expect(d.reviewInterval).toBeGreaterThanOrEqual(1);
  });

  // 5. INSTAVEL → intervalo curto
  it("5 — INSTAVEL tem intervalo curto", () => {
    const d = computeReviewDecision(
      mkInput({
        knowledgeState: "INSTAVEL",
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.3,
        daysSinceStudy: 8,
      }),
    );
    expect(d.reviewInterval).toBeLessThanOrEqual(10);
  });

  // 6. PONTO_CRITICO → recuperação
  it("6 — PONTO_CRITICO gera revisão de recuperação", () => {
    const d = computeReviewDecision(
      mkInput({
        knowledgeState: "PONTO_CRITICO",
        mastery: 0.2,
        confidence: 0.8,
        accuracy: 0.2,
        daysSinceStudy: 5,
      }),
    );
    expect(d.needsReview).toBe(true);
    expect(d.reviewType).toBe("recuperacao");
  });

  // 7. RISCO_ESQUECIMENTO → urgência alta
  it("7 — RISCO_ESQUECIMENTO tem urgência alta", () => {
    const d = computeReviewDecision(
      mkInput({
        knowledgeState: "RISCO_ESQUECIMENTO",
        mastery: 0.7,
        confidence: 0.8,
        accuracy: 0.7,
        daysSinceStudy: 30,
      }),
    );
    expect(d.needsReview).toBe(true);
    expect(d.reviewUrgency).toBeGreaterThan(0.5);
  });

  // 8. SEM_EVIDENCIA → não criar revisão artificial
  it("8 — SEM_EVIDENCIA não gera revisão", () => {
    const d = computeReviewDecision(
      mkInput({
        knowledgeState: "SEM_EVIDENCIA",
        mastery: 0,
        confidence: 0,
        accuracy: 0,
        daysSinceStudy: null,
      }),
    );
    expect(d.needsReview).toBe(false);
    expect(d.reviewUrgency).toBe(0);
  });

  // 9. Sucesso aumenta intervalo
  it("9 — sucesso na revisão aumenta intervalo", () => {
    const base = mkInput({
      knowledgeState: "APRENDIZAGEM",
      mastery: 0.5,
      confidence: 0.5,
      daysSinceStudy: 10,
    });
    const withSuccess = computeReviewInterval({ ...base, lastReviewResult: "success" });
    const withNone = computeReviewInterval({ ...base, lastReviewResult: null });
    expect(withSuccess).toBeGreaterThanOrEqual(withNone);
  });

  // 10. Falha reduz intervalo
  it("10 — falha na revisão reduz intervalo", () => {
    const base = mkInput({
      knowledgeState: "APRENDIZAGEM",
      mastery: 0.5,
      confidence: 0.5,
      daysSinceStudy: 10,
    });
    const withFail = computeReviewInterval({ ...base, lastReviewResult: "fail" });
    const withNone = computeReviewInterval({ ...base, lastReviewResult: null });
    expect(withFail).toBeLessThanOrEqual(withNone);
  });

  // 11. Resultado partial é intermediário
  it("11 — resultado partial fica entre sucesso e falha", () => {
    const base = mkInput({
      knowledgeState: "CONSOLIDANDO",
      mastery: 0.7,
      confidence: 0.6,
      daysSinceStudy: 10,
    });
    const fail = computeReviewInterval({ ...base, lastReviewResult: "fail" });
    const partial = computeReviewInterval({ ...base, lastReviewResult: "partial" });
    const success = computeReviewInterval({ ...base, lastReviewResult: "success" });
    expect(partial).toBeGreaterThanOrEqual(fail);
    expect(partial).toBeLessThanOrEqual(success);
  });

  // 12. Erros recorrentes reduzem intervalo
  it("12 — erros recorrentes reduzem intervalo", () => {
    const base = mkInput({
      knowledgeState: "APRENDIZAGEM",
      mastery: 0.5,
      confidence: 0.5,
    });
    const noErrors = computeReviewInterval({ ...base, recurringErrors: 0 });
    const withErrors = computeReviewInterval({ ...base, recurringErrors: 3 });
    expect(withErrors).toBeLessThanOrEqual(noErrors);
  });

  // 13. Erros não resolvidos reduzem intervalo
  it("13 — erros não resolvidos reduzem intervalo", () => {
    const base = mkInput({
      knowledgeState: "APRENDIZAGEM",
      mastery: 0.5,
      confidence: 0.5,
    });
    const noErrors = computeReviewInterval({ ...base, unresolvedErrors: 0 });
    const withErrors = computeReviewInterval({ ...base, unresolvedErrors: 3 });
    expect(withErrors).toBeLessThanOrEqual(noErrors);
  });

  // 14. Maior atraso aumenta urgência
  it("14 — maior atraso aumenta urgência", () => {
    const base = mkInput({
      knowledgeState: "APRENDIZAGEM",
      mastery: 0.5,
      confidence: 0.5,
    });
    const interval = computeReviewInterval(base);
    const urgNear = computeReviewUrgency({ ...base, daysSinceStudy: 2 }, interval);
    const urgFar = computeReviewUrgency({ ...base, daysSinceStudy: 20 }, interval);
    expect(urgFar).toBeGreaterThanOrEqual(urgNear);
  });

  // 15. Domínio maior permite intervalos maiores
  it("15 — maior mastery permite intervalos maiores", () => {
    const low = computeReviewInterval(
      mkInput({ knowledgeState: "APRENDIZAGEM", mastery: 0.3, confidence: 0.5 }),
    );
    const high = computeReviewInterval(
      mkInput({ knowledgeState: "APRENDIZAGEM", mastery: 0.6, confidence: 0.5 }),
    );
    expect(high).toBeGreaterThanOrEqual(low);
  });

  // 16. Confiança maior permite intervalos maiores
  it("16 — maior confidence permite intervalos maiores", () => {
    const low = computeReviewInterval(mkInput({ knowledgeState: "APRENDIZAGEM", confidence: 0.2 }));
    const high = computeReviewInterval(
      mkInput({ knowledgeState: "APRENDIZAGEM", confidence: 0.8 }),
    );
    expect(high).toBeGreaterThanOrEqual(low);
  });

  // 17. Primeira revisão funciona sem histórico
  it("17 — primeira revisão sem histórico funciona", () => {
    const d = computeReviewDecision(
      mkInput({
        knowledgeState: "APRENDIZAGEM",
        lastReviewDate: null,
        reviewCount: 0,
        lastReviewResult: null,
        daysSinceStudy: 10,
      }),
    );
    expect(d.reviewInterval).toBeGreaterThanOrEqual(1);
    expect(d.suggestedReviewDate).toBeTruthy();
  });

  // 18. Múltiplas revisões funcionam
  it("18 — múltiplas revisões acumuladas funcionam", () => {
    const d = computeReviewDecision(
      mkInput({
        knowledgeState: "CONSOLIDANDO",
        mastery: 0.7,
        confidence: 0.6,
        reviewCount: 5,
        lastReviewResult: "success",
        lastReviewDate: "2026-08-20",
        daysSinceStudy: 9,
      }),
    );
    expect(d.reviewInterval).toBeGreaterThanOrEqual(1);
  });

  // 19. referenceDate determina completamente o resultado
  it("19 — referenceDate diferente produz decisão diferente quando relevante", () => {
    const base = mkInput({
      knowledgeState: "APRENDIZAGEM",
      daysSinceStudy: 10,
      lastReviewDate: "2026-08-15",
    });
    const d1 = computeReviewDecision({ ...base, referenceDate: "2026-08-25" });
    const d2 = computeReviewDecision({ ...base, referenceDate: "2026-09-15" });
    // Urgência deve ser diferente porque diasDesdeRevisão difere
    expect(d1.reviewUrgency).not.toBe(d2.reviewUrgency);
  });

  // 20. Ausência de Date.now()
  it("20 — motor não usa Date.now()", () => {
    const originalNow = Date.now;
    let called = false;
    Date.now = () => {
      called = true;
      return originalNow();
    };
    try {
      computeReviewDecision(mkInput());
      expect(called).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  // 21. Determinismo com 50 execuções
  it("21 — determinismo: 50 execuções idênticas", () => {
    const input = mkInput({
      knowledgeState: "CONSOLIDANDO",
      mastery: 0.65,
      confidence: 0.6,
      daysSinceStudy: 8,
      unresolvedErrors: 1,
      recurringErrors: 1,
      lastReviewResult: "partial",
      lastReviewDate: "2026-08-21",
      reviewCount: 2,
    });
    const first = computeReviewDecision(input);
    for (let i = 0; i < 50; i++) {
      const d = computeReviewDecision(input);
      expect(d).toEqual(first);
    }
  });

  // 22–24. Proteção contra valores inválidos
  it("22 — NaN no mastery é tratado", () => {
    const d = computeReviewDecision(mkInput({ mastery: NaN }));
    expect(Number.isFinite(d.reviewUrgency)).toBe(true);
    expect(Number.isFinite(d.reviewInterval)).toBe(true);
    expect(d.reviewInterval).toBeGreaterThanOrEqual(0);
  });

  it("23 — Infinity no confidence é tratado", () => {
    const d = computeReviewDecision(mkInput({ confidence: Infinity }));
    expect(Number.isFinite(d.reviewUrgency)).toBe(true);
    expect(Number.isFinite(d.reviewInterval)).toBe(true);
  });

  it("24 — valores negativos são tratados", () => {
    const d = computeReviewDecision(
      mkInput({ mastery: -0.5, confidence: -1, accuracy: -2, recurringErrors: -3 }),
    );
    expect(d.reviewUrgency).toBeGreaterThanOrEqual(0);
    expect(d.reviewInterval).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(d.reviewUrgency)).toBe(true);
  });

  // 25. Valores acima de 1
  it("25 — valores acima de 1 são clampados", () => {
    const d = computeReviewDecision(mkInput({ mastery: 2, confidence: 3, accuracy: 5 }));
    expect(d.reviewUrgency).toBeLessThanOrEqual(1);
    expect(Number.isFinite(d.reviewInterval)).toBe(true);
  });

  // 26. reviewCount extremo
  it("26 — reviewCount extremo funciona", () => {
    const d = computeReviewDecision(
      mkInput({ reviewCount: 1000, lastReviewResult: "success", lastReviewDate: "2026-08-28" }),
    );
    expect(Number.isFinite(d.reviewInterval)).toBe(true);
    expect(d.reviewInterval).toBeGreaterThanOrEqual(1);
  });

  // 27. Todos os reviewTypes possíveis
  it("27 — todos os reviewTypes são produzidos", () => {
    const types = new Set<TopicReviewDecision["reviewType"]>();

    // manutencao
    types.add(
      computeReviewDecision(
        mkInput({ knowledgeState: "DOMINADO", mastery: 0.9, confidence: 0.9, daysSinceStudy: 30 }),
      ).reviewType,
    );
    // consolidacao
    types.add(
      computeReviewDecision(mkInput({ knowledgeState: "CONSOLIDANDO", daysSinceStudy: 15 }))
        .reviewType,
    );
    // recuperacao
    types.add(
      computeReviewDecision(
        mkInput({ knowledgeState: "PONTO_CRITICO", mastery: 0.2, confidence: 0.8 }),
      ).reviewType,
    );
    // erro_direcionado
    types.add(
      computeReviewDecision(
        mkInput({
          knowledgeState: "APRENDIZAGEM",
          mastery: 0.3,
          unresolvedErrors: 3,
          recurringErrors: 2,
        }),
      ).reviewType,
    );

    expect(types.has("manutencao")).toBe(true);
    expect(types.has("consolidacao")).toBe(true);
    expect(types.has("recuperacao")).toBe(true);
    expect(types.has("erro_direcionado")).toBe(true);
  });

  // 28. Todas as intensidades possíveis
  it("28 — todas as intensidades são produzidas", () => {
    const intensities = new Set<TopicReviewDecision["reviewIntensity"]>();

    // leve: DOMINADO recente
    intensities.add(
      computeReviewDecision(
        mkInput({
          knowledgeState: "DOMINADO",
          mastery: 0.9,
          confidence: 0.9,
          daysSinceStudy: 5,
          lastReviewDate: "2026-08-24",
          lastReviewResult: "success",
        }),
      ).reviewIntensity,
    );
    // moderada: APRENDIZAGEM com urgência média
    intensities.add(
      computeReviewDecision(
        mkInput({
          knowledgeState: "APRENDIZAGEM",
          mastery: 0.5,
          confidence: 0.5,
          daysSinceStudy: 5,
        }),
      ).reviewIntensity,
    );
    // intensiva: PONTO_CRITICO
    intensities.add(
      computeReviewDecision(
        mkInput({ knowledgeState: "PONTO_CRITICO", mastery: 0.2, confidence: 0.8 }),
      ).reviewIntensity,
    );

    expect(intensities.has("leve")).toBe(true);
    expect(intensities.has("moderada")).toBe(true);
    expect(intensities.has("intensiva")).toBe(true);
  });

  // 29. suggestedReviewDate válida
  it("29 — suggestedReviewDate é string ISO válida", () => {
    const d = computeReviewDecision(
      mkInput({ knowledgeState: "APRENDIZAGEM", daysSinceStudy: 10 }),
    );
    expect(d.suggestedReviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(d.suggestedReviewDate))).toBe(false);
  });

  // 30. reviewInterval sempre válido
  it("30 — reviewInterval sempre >= 0 e finito", () => {
    const states: (KnowledgeStateName | null)[] = [
      "SEM_EVIDENCIA",
      "APRENDIZAGEM",
      "INSTAVEL",
      "CONSOLIDANDO",
      "DOMINADO",
      "RISCO_ESQUECIMENTO",
      "PONTO_CRITICO",
      null,
    ];
    for (const state of states) {
      const d = computeReviewDecision(mkInput({ knowledgeState: state }));
      expect(d.reviewInterval).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(d.reviewInterval)).toBe(true);
    }
  });

  // 31. Nenhum resultado contém NaN/Infinity
  it("31 — nenhum campo numérico contém NaN ou Infinity", () => {
    const edgeCases: Partial<TopicReviewInput>[] = [
      { mastery: NaN, confidence: NaN },
      { mastery: Infinity, confidence: -Infinity },
      { unresolvedErrors: NaN, recurringErrors: Infinity },
      { daysSinceStudy: NaN },
      { reviewCount: Infinity },
      {},
    ];
    for (const overrides of edgeCases) {
      const d = computeReviewDecision(mkInput(overrides));
      expect(Number.isFinite(d.reviewUrgency)).toBe(true);
      expect(Number.isFinite(d.reviewInterval)).toBe(true);
      expect(Number.isNaN(d.reviewUrgency)).toBe(false);
      expect(Number.isNaN(d.reviewInterval)).toBe(false);
    }
  });

  // 32. DOMINADO não recebe urgência artificial
  it("32 — DOMINADO recente tem urgência baixa", () => {
    const d = computeReviewDecision(
      mkInput({
        knowledgeState: "DOMINADO",
        mastery: 0.9,
        confidence: 0.9,
        daysSinceStudy: 3,
        lastReviewDate: "2026-08-26",
        lastReviewResult: "success",
      }),
    );
    expect(d.reviewUrgency).toBeLessThan(0.5);
  });

  // 33. PONTO_CRITICO supera DOMINADO em urgência
  it("33 — PONTO_CRITICO tem maior urgência que DOMINADO em condições equivalentes", () => {
    const shared = {
      mastery: 0.5,
      confidence: 0.6,
      accuracy: 0.5,
      daysSinceStudy: 10,
      unresolvedErrors: 0,
      recurringErrors: 0,
      lastReviewDate: null as string | null,
      reviewCount: 1,
      lastReviewResult: null as "success" | "partial" | "fail" | null,
    };
    const critico = computeReviewDecision(mkInput({ ...shared, knowledgeState: "PONTO_CRITICO" }));
    const dominado = computeReviewDecision(mkInput({ ...shared, knowledgeState: "DOMINADO" }));
    expect(critico.reviewUrgency).toBeGreaterThan(dominado.reviewUrgency);
  });

  // 34. RISCO_ESQUECIMENTO supera DOMINADO em urgência
  it("34 — RISCO_ESQUECIMENTO tem maior urgência que DOMINADO", () => {
    const shared = {
      mastery: 0.7,
      confidence: 0.7,
      daysSinceStudy: 10,
      lastReviewDate: null as string | null,
      reviewCount: 1,
      lastReviewResult: null as "success" | "partial" | "fail" | null,
    };
    const risco = computeReviewDecision(
      mkInput({ ...shared, knowledgeState: "RISCO_ESQUECIMENTO" }),
    );
    const dominado = computeReviewDecision(mkInput({ ...shared, knowledgeState: "DOMINADO" }));
    expect(risco.reviewUrgency).toBeGreaterThan(dominado.reviewUrgency);
  });

  // 35. Erro recorrente aumenta necessidade de revisão
  it("35 — erro recorrente diminui intervalo e potencializa revisão", () => {
    const base = mkInput({ knowledgeState: "APRENDIZAGEM", mastery: 0.5, confidence: 0.5 });
    const intervalNoError = computeReviewInterval({ ...base, recurringErrors: 0 });
    const intervalWithError = computeReviewInterval({ ...base, recurringErrors: 5 });
    expect(intervalWithError).toBeLessThan(intervalNoError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. TESTES DE MONOTONICIDADE
// ═══════════════════════════════════════════════════════════════════════════

describe("review engine — monotonicidade", () => {
  it("aumentar atraso não reduz urgência", () => {
    const base = mkInput({
      knowledgeState: "APRENDIZAGEM",
      mastery: 0.5,
      confidence: 0.5,
    });
    const interval = computeReviewInterval(base);
    const urgencies: number[] = [];
    for (const days of [1, 3, 5, 10, 15, 20, 30]) {
      urgencies.push(computeReviewUrgency({ ...base, daysSinceStudy: days }, interval));
    }
    for (let i = 1; i < urgencies.length; i++) {
      expect(urgencies[i]!).toBeGreaterThanOrEqual(urgencies[i - 1]! - 0.001);
    }
  });

  it("aumentar erros recorrentes não aumenta intervalo", () => {
    const intervals: number[] = [];
    for (const errors of [0, 1, 2, 3, 5, 10]) {
      intervals.push(
        computeReviewInterval(
          mkInput({ knowledgeState: "APRENDIZAGEM", mastery: 0.5, recurringErrors: errors }),
        ),
      );
    }
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]!).toBeLessThanOrEqual(intervals[i - 1]!);
    }
  });

  it("falha não aumenta intervalo em relação a sucesso", () => {
    const states: KnowledgeStateName[] = [
      "APRENDIZAGEM",
      "CONSOLIDANDO",
      "DOMINADO",
      "INSTAVEL",
      "PONTO_CRITICO",
      "RISCO_ESQUECIMENTO",
    ];
    for (const state of states) {
      const base = mkInput({ knowledgeState: state, mastery: 0.5, confidence: 0.5 });
      const fail = computeReviewInterval({ ...base, lastReviewResult: "fail" });
      const success = computeReviewInterval({ ...base, lastReviewResult: "success" });
      expect(fail).toBeLessThanOrEqual(success);
    }
  });

  it("aumentar confidence não aumenta urgência (mantendo demais constantes)", () => {
    const base = mkInput({
      knowledgeState: "APRENDIZAGEM",
      mastery: 0.5,
      daysSinceStudy: 8,
    });
    const urgencies: number[] = [];
    for (const conf of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const input = { ...base, confidence: conf };
      const interval = computeReviewInterval(input);
      urgencies.push(computeReviewUrgency(input, interval));
    }
    for (let i = 1; i < urgencies.length; i++) {
      expect(urgencies[i]!).toBeLessThanOrEqual(urgencies[i - 1]! + 0.001);
    }
  });

  /**
   * NOTA: A monotonicidade confidence → urgência funciona porque:
   * maior confidence → maior intervalo (confidenceFactor) → mais dias
   * restantes → menor urgência. A relação é válida desde que o atraso
   * (daysSinceStudy) permaneça constante.
   */

  it("aumentar erros não resolvidos não aumenta intervalo", () => {
    const intervals: number[] = [];
    for (const errors of [0, 1, 2, 5, 10]) {
      intervals.push(
        computeReviewInterval(
          mkInput({ knowledgeState: "CONSOLIDANDO", mastery: 0.6, unresolvedErrors: errors }),
        ),
      );
    }
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]!).toBeLessThanOrEqual(intervals[i - 1]!);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. CONSTANTES E INVARIANTES
// ═══════════════════════════════════════════════════════════════════════════

describe("review engine — constantes", () => {
  it("BASE_INTERVALS contém todos os 7 estados", () => {
    const states: KnowledgeStateName[] = [
      "SEM_EVIDENCIA",
      "APRENDIZAGEM",
      "INSTAVEL",
      "CONSOLIDANDO",
      "DOMINADO",
      "RISCO_ESQUECIMENTO",
      "PONTO_CRITICO",
    ];
    for (const s of states) {
      expect(BASE_INTERVALS[s]).toBeDefined();
      expect(typeof BASE_INTERVALS[s]).toBe("number");
    }
  });

  it("SEM_EVIDENCIA tem intervalo 0", () => {
    expect(BASE_INTERVALS.SEM_EVIDENCIA).toBe(0);
  });

  it("DOMINADO tem o maior intervalo base", () => {
    for (const [state, val] of Object.entries(BASE_INTERVALS)) {
      if (state !== "DOMINADO") {
        expect(BASE_INTERVALS.DOMINADO).toBeGreaterThanOrEqual(val);
      }
    }
  });

  it("RISCO_ESQUECIMENTO e PONTO_CRITICO têm intervalos menores que DOMINADO", () => {
    expect(BASE_INTERVALS.RISCO_ESQUECIMENTO).toBeLessThan(BASE_INTERVALS.DOMINADO);
    expect(BASE_INTERVALS.PONTO_CRITICO).toBeLessThan(BASE_INTERVALS.DOMINADO);
  });

  it("REVIEW_RESULT_FACTORS: success > partial > fail", () => {
    expect(REVIEW_RESULT_FACTORS["success"]!).toBeGreaterThan(REVIEW_RESULT_FACTORS["partial"]!);
    expect(REVIEW_RESULT_FACTORS["partial"]!).toBeGreaterThan(REVIEW_RESULT_FACTORS["fail"]!);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PROPRIEDADES GLOBAIS
// ═══════════════════════════════════════════════════════════════════════════

describe("review engine — propriedades globais", () => {
  it("reviewUrgency sempre entre 0 e 1 para qualquer estado", () => {
    const states: (KnowledgeStateName | null)[] = [
      "SEM_EVIDENCIA",
      "APRENDIZAGEM",
      "INSTAVEL",
      "CONSOLIDANDO",
      "DOMINADO",
      "RISCO_ESQUECIMENTO",
      "PONTO_CRITICO",
      null,
    ];
    for (const state of states) {
      for (const days of [0, 1, 5, 10, 30, 100, null]) {
        const d = computeReviewDecision(mkInput({ knowledgeState: state, daysSinceStudy: days }));
        expect(d.reviewUrgency).toBeGreaterThanOrEqual(0);
        expect(d.reviewUrgency).toBeLessThanOrEqual(1);
      }
    }
  });

  it("reviewInterval > 0 quando revisão é agendada (não SEM_EVIDENCIA)", () => {
    const states: KnowledgeStateName[] = [
      "APRENDIZAGEM",
      "INSTAVEL",
      "CONSOLIDANDO",
      "DOMINADO",
      "RISCO_ESQUECIMENTO",
      "PONTO_CRITICO",
    ];
    for (const state of states) {
      const d = computeReviewDecision(mkInput({ knowledgeState: state }));
      expect(d.reviewInterval).toBeGreaterThan(0);
    }
  });

  it("suggestedReviewDate nunca é anterior a referenceDate", () => {
    const states: (KnowledgeStateName | null)[] = [
      "SEM_EVIDENCIA",
      "APRENDIZAGEM",
      "INSTAVEL",
      "CONSOLIDANDO",
      "DOMINADO",
      "RISCO_ESQUECIMENTO",
      "PONTO_CRITICO",
      null,
    ];
    for (const state of states) {
      const d = computeReviewDecision(
        mkInput({ knowledgeState: state, daysSinceStudy: 50, referenceDate: REF_DATE }),
      );
      expect(d.suggestedReviewDate >= REF_DATE).toBe(true);
    }
  });

  it("reason é string não vazia", () => {
    const states: (KnowledgeStateName | null)[] = [
      "SEM_EVIDENCIA",
      "APRENDIZAGEM",
      "DOMINADO",
      "PONTO_CRITICO",
      null,
    ];
    for (const state of states) {
      const d = computeReviewDecision(mkInput({ knowledgeState: state }));
      expect(d.reviewReason.length).toBeGreaterThan(0);
    }
  });
});
