import { describe, it, expect } from "vitest";
import {
  computeDiagnosticBoost,
  STATE_BOOST,
  COMPONENT_WEIGHTS,
  ERROR_NORM,
  RECURRENCE_NORM,
  RECENCY_NORM_DAYS,
  RECENCY_UNKNOWN_DEFAULT,
  NO_DIAGNOSIS_STATE_BOOST,
  type IntelligenceInput,
} from "@/lib/planner/intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Cria um input padrão neutro. Cada teste sobrescreve o que precisar. */
function makeInput(overrides: Partial<IntelligenceInput> = {}): IntelligenceInput {
  return {
    baseScore: 5.0,
    knowledgeState: null,
    mastery: 0.5,
    confidence: 0.5,
    accuracy: 0.5,
    recentErrors: 0,
    unresolvedErrors: 0,
    recurringErrors: 0,
    daysSinceStudy: 7,
    daysSinceError: null,
    interventionScore: 0.3,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTES
// ─────────────────────────────────────────────────────────────────────────────

describe("intelligence — computeDiagnosticBoost", () => {
  // 1. Sem diagnóstico preserva comportamento base
  it("1. sem diagnóstico (knowledgeState null) produz boost neutro", () => {
    const input = makeInput({ knowledgeState: null });
    const result = computeDiagnosticBoost(input);
    // Boost deve existir mas ser moderado (sem estado = NO_DIAGNOSIS_STATE_BOOST)
    expect(result.diagnosticBoost).toBeGreaterThanOrEqual(0);
    expect(result.finalScore).toBe(input.baseScore + result.diagnosticBoost);
    expect(result.reason).toContain("Sem diagnóstico");
  });

  // 2. PONTO_CRITICO aumenta score
  it("2. PONTO_CRITICO produz o maior boost entre os estados", () => {
    const critical = computeDiagnosticBoost(
      makeInput({ knowledgeState: "PONTO_CRITICO", mastery: 0.2, interventionScore: 0.8 }),
    );
    const dominated = computeDiagnosticBoost(
      makeInput({ knowledgeState: "DOMINADO", mastery: 0.9, interventionScore: 0.1 }),
    );
    expect(critical.diagnosticBoost).toBeGreaterThan(dominated.diagnosticBoost);
    expect(critical.reason).toContain("Ponto crítico");
  });

  // 3. RISCO_ESQUECIMENTO aumenta score
  it("3. RISCO_ESQUECIMENTO produz boost alto", () => {
    const risco = computeDiagnosticBoost(
      makeInput({ knowledgeState: "RISCO_ESQUECIMENTO", daysSinceStudy: 30 }),
    );
    const neutro = computeDiagnosticBoost(makeInput({ knowledgeState: null }));
    expect(risco.diagnosticBoost).toBeGreaterThan(neutro.diagnosticBoost);
    expect(risco.reason).toContain("Risco de esquecimento");
  });

  // 4. INSTAVEL aumenta score
  it("4. INSTAVEL produz boost alto", () => {
    const instavel = computeDiagnosticBoost(makeInput({ knowledgeState: "INSTAVEL" }));
    const aprendizagem = computeDiagnosticBoost(makeInput({ knowledgeState: "APRENDIZAGEM" }));
    expect(instavel.diagnosticBoost).toBeGreaterThan(aprendizagem.diagnosticBoost);
    expect(instavel.reason).toContain("instável");
  });

  // 5. APRENDIZAGEM aumenta score moderadamente
  it("5. APRENDIZAGEM produz boost moderado", () => {
    const aprendizagem = computeDiagnosticBoost(makeInput({ knowledgeState: "APRENDIZAGEM" }));
    const dominado = computeDiagnosticBoost(
      makeInput({ knowledgeState: "DOMINADO", mastery: 0.9, interventionScore: 0.1 }),
    );
    expect(aprendizagem.diagnosticBoost).toBeGreaterThan(dominado.diagnosticBoost);
  });

  // 6. CONSOLIDANDO aumenta score moderadamente
  it("6. CONSOLIDANDO produz boost moderado", () => {
    const consolidando = computeDiagnosticBoost(makeInput({ knowledgeState: "CONSOLIDANDO" }));
    const dominado = computeDiagnosticBoost(
      makeInput({ knowledgeState: "DOMINADO", mastery: 0.9, interventionScore: 0.1 }),
    );
    expect(consolidando.diagnosticBoost).toBeGreaterThan(dominado.diagnosticBoost);
  });

  // 7. DOMINADO recebe boost baixo
  it("7. DOMINADO recebe o menor boost entre todos os estados", () => {
    const allStates = Object.keys(STATE_BOOST) as Array<keyof typeof STATE_BOOST>;
    const dominadoBoost = computeDiagnosticBoost(
      makeInput({
        knowledgeState: "DOMINADO",
        mastery: 0.9,
        confidence: 0.8,
        accuracy: 0.85,
        interventionScore: 0.05,
      }),
    ).diagnosticBoost;

    for (const state of allStates) {
      if (state === "DOMINADO") continue;
      const other = computeDiagnosticBoost(
        makeInput({ knowledgeState: state, mastery: 0.3, interventionScore: 0.6 }),
      ).diagnosticBoost;
      expect(other).toBeGreaterThan(dominadoBoost);
    }
  });

  // 8. Mastery baixo aumenta prioridade
  it("8. mastery baixo (0.1) produz boost maior que mastery alto (0.9)", () => {
    const lowMastery = computeDiagnosticBoost(
      makeInput({ knowledgeState: "APRENDIZAGEM", mastery: 0.1 }),
    );
    const highMastery = computeDiagnosticBoost(
      makeInput({ knowledgeState: "APRENDIZAGEM", mastery: 0.9 }),
    );
    expect(lowMastery.diagnosticBoost).toBeGreaterThan(highMastery.diagnosticBoost);
  });

  // 9. Erros recorrentes aumentam prioridade
  it("9. erros recorrentes aumentam o boost", () => {
    const withRecurring = computeDiagnosticBoost(
      makeInput({ knowledgeState: "APRENDIZAGEM", recurringErrors: 3 }),
    );
    const withoutRecurring = computeDiagnosticBoost(
      makeInput({ knowledgeState: "APRENDIZAGEM", recurringErrors: 0 }),
    );
    expect(withRecurring.diagnosticBoost).toBeGreaterThan(withoutRecurring.diagnosticBoost);
    expect(withRecurring.reason).toContain("recorrentes");
  });

  // 10. Erros não resolvidos aumentam prioridade
  it("10. erros não resolvidos aumentam o boost", () => {
    const withUnresolved = computeDiagnosticBoost(
      makeInput({ knowledgeState: "APRENDIZAGEM", unresolvedErrors: 5 }),
    );
    const withoutUnresolved = computeDiagnosticBoost(
      makeInput({ knowledgeState: "APRENDIZAGEM", unresolvedErrors: 0 }),
    );
    expect(withUnresolved.diagnosticBoost).toBeGreaterThan(withoutUnresolved.diagnosticBoost);
    expect(withUnresolved.reason).toContain("não resolvidos");
  });

  // 11. Intervention_score alto aumenta prioridade
  it("11. interventionScore alto aumenta o boost", () => {
    const highIntervention = computeDiagnosticBoost(
      makeInput({ knowledgeState: "APRENDIZAGEM", interventionScore: 0.9 }),
    );
    const lowIntervention = computeDiagnosticBoost(
      makeInput({ knowledgeState: "APRENDIZAGEM", interventionScore: 0.1 }),
    );
    expect(highIntervention.diagnosticBoost).toBeGreaterThan(lowIntervention.diagnosticBoost);
  });

  // 12. Tópico dominado + alta confiança + estudo recente NÃO recebe boost indevido
  it("12. DOMINADO + alta confiança + accuracy alta + estudo recente = boost mínimo", () => {
    const result = computeDiagnosticBoost(
      makeInput({
        knowledgeState: "DOMINADO",
        mastery: 0.95,
        confidence: 0.9,
        accuracy: 0.92,
        unresolvedErrors: 0,
        recurringErrors: 0,
        daysSinceStudy: 2,
        interventionScore: 0.02,
      }),
    );
    // O boost deve ser muito baixo — DOMINADO (0.05) * 0.4 = 0.02 para state,
    // mastery gap (0.05) * 0.2 = 0.01, intervention (0.02) * 0.15 ≈ 0.003,
    // errors = 0, recurrence = 0, recency (2/60) * 0.05 ≈ 0.0017
    // Total ≈ 0.034
    expect(result.diagnosticBoost).toBeLessThan(0.1);
    expect(result.reason).toContain("manutenção");
  });

  // 13. Resultado sempre finito
  it("13. resultado é sempre finito", () => {
    const extremeInputs: Partial<IntelligenceInput>[] = [
      { baseScore: 0 },
      { baseScore: 100 },
      { baseScore: -10 },
      { mastery: 0, confidence: 0, accuracy: 0 },
      { mastery: 1, confidence: 1, accuracy: 1 },
      { unresolvedErrors: 1000, recurringErrors: 1000, recentErrors: 1000 },
      { daysSinceStudy: 10000 },
      { daysSinceStudy: null },
      { interventionScore: 0 },
      { interventionScore: 1 },
    ];
    for (const overrides of extremeInputs) {
      const result = computeDiagnosticBoost(makeInput(overrides));
      expect(Number.isFinite(result.diagnosticBoost)).toBe(true);
      expect(Number.isFinite(result.finalScore)).toBe(true);
    }
  });

  // 14. Resultado nunca é NaN
  it("14. resultado nunca é NaN", () => {
    const nanInputs: Partial<IntelligenceInput>[] = [
      { baseScore: NaN },
      { mastery: NaN },
      { confidence: NaN },
      { accuracy: NaN },
      { interventionScore: NaN },
      { unresolvedErrors: NaN },
      { recurringErrors: NaN },
      { daysSinceStudy: NaN as unknown as number },
    ];
    for (const overrides of nanInputs) {
      const result = computeDiagnosticBoost(makeInput(overrides));
      expect(Number.isNaN(result.diagnosticBoost)).toBe(false);
      expect(Number.isNaN(result.finalScore)).toBe(false);
    }
  });

  // 15. Determinismo: mesmo input produz exatamente o mesmo output
  it("15. determinismo — mesmo input = mesmo output, 100 vezes", () => {
    const input = makeInput({
      knowledgeState: "PONTO_CRITICO",
      mastery: 0.15,
      confidence: 0.6,
      accuracy: 0.3,
      unresolvedErrors: 3,
      recurringErrors: 2,
      daysSinceStudy: 14,
      interventionScore: 0.75,
    });
    const first = computeDiagnosticBoost(input);
    for (let i = 0; i < 100; i++) {
      const result = computeDiagnosticBoost(input);
      expect(result.diagnosticBoost).toBe(first.diagnosticBoost);
      expect(result.finalScore).toBe(first.finalScore);
      expect(result.reason).toBe(first.reason);
    }
  });

  // 16. Sinais extremos não quebram a função
  it("16. sinais extremos não quebram a função", () => {
    const extremeCases: IntelligenceInput[] = [
      // Tudo no máximo
      makeInput({
        baseScore: 999,
        knowledgeState: "PONTO_CRITICO",
        mastery: 0,
        confidence: 0,
        accuracy: 0,
        recentErrors: 9999,
        unresolvedErrors: 9999,
        recurringErrors: 9999,
        daysSinceStudy: 99999,
        daysSinceError: 99999,
        interventionScore: 1,
      }),
      // Tudo no mínimo
      makeInput({
        baseScore: 0,
        knowledgeState: "DOMINADO",
        mastery: 1,
        confidence: 1,
        accuracy: 1,
        recentErrors: 0,
        unresolvedErrors: 0,
        recurringErrors: 0,
        daysSinceStudy: 0,
        daysSinceError: 0,
        interventionScore: 0,
      }),
      // Valores negativos (dados inválidos vindos de bug externo)
      makeInput({
        baseScore: -50,
        mastery: -1,
        confidence: -1,
        accuracy: -1,
        unresolvedErrors: -10,
        recurringErrors: -5,
        daysSinceStudy: -100,
        interventionScore: -1,
      }),
      // Infinity
      makeInput({
        baseScore: Infinity,
        mastery: Infinity,
        interventionScore: Infinity,
        unresolvedErrors: Infinity,
      }),
    ];

    for (const input of extremeCases) {
      const result = computeDiagnosticBoost(input);
      expect(Number.isNaN(result.diagnosticBoost)).toBe(false);
      expect(Number.isFinite(result.diagnosticBoost)).toBe(true);
      expect(result.diagnosticBoost).toBeGreaterThanOrEqual(0);
      expect(result.diagnosticBoost).toBeLessThanOrEqual(1.01); // max boost ≈ sum of weights = 1.0
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("intelligence — ordering pedagógico", () => {
  it("a hierarquia de estados respeita a prioridade pedagógica", () => {
    // Com sinais iguais, apenas o estado muda. O boost deve seguir a ordem.
    const base = makeInput({ mastery: 0.4, interventionScore: 0.5 });
    const order: Array<keyof typeof STATE_BOOST> = [
      "PONTO_CRITICO",
      "RISCO_ESQUECIMENTO",
      "INSTAVEL",
      "APRENDIZAGEM",
      "CONSOLIDANDO",
      "SEM_EVIDENCIA",
      "DOMINADO",
    ];

    const boosts = order.map(
      (state) => computeDiagnosticBoost({ ...base, knowledgeState: state }).diagnosticBoost,
    );

    for (let i = 0; i < boosts.length - 1; i++) {
      expect(boosts[i]).toBeGreaterThanOrEqual(boosts[i + 1]!);
    }
  });
});

describe("intelligence — constantes validadas", () => {
  it("a soma dos pesos dos componentes é 1.0", () => {
    const W = COMPONENT_WEIGHTS;
    const sum = W.STATE + W.INTERVENTION + W.MASTERY_GAP + W.ERROR + W.RECURRENCE + W.RECENCY;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("todos os STATE_BOOST estão entre 0 e 1", () => {
    for (const [, value] of Object.entries(STATE_BOOST)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("constantes de normalização são positivas", () => {
    expect(ERROR_NORM).toBeGreaterThan(0);
    expect(RECURRENCE_NORM).toBeGreaterThan(0);
    expect(RECENCY_NORM_DAYS).toBeGreaterThan(0);
  });
});
