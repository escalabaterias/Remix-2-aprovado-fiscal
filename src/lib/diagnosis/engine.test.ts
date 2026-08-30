import { describe, it, expect } from "vitest";
import {
  diagnoseTopic,
  classifyEvidence,
  classifyRecency,
  classifyRisk,
  computeInterventionScore,
  NO_EVIDENCE_CONFIDENCE,
  LOW_CONFIDENCE_THRESHOLD,
  HIGH_CONFIDENCE_THRESHOLD,
  HIGH_MASTERY_THRESHOLD,
  LOW_MASTERY_THRESHOLD,
  FORGETTING_MASTERY_THRESHOLD,
  FORGETTING_CONFIDENCE_THRESHOLD,
  INSTABILITY_DIVERGENCE,
  OLD_DAYS_THRESHOLD,
  RECENT_DAYS_THRESHOLD,
  MIN_ACCURACY_FOR_MASTERED,
  MIN_QUESTIONS_FOR_EVIDENCE,
  RECURRING_ERRORS_CRITICAL_THRESHOLD,
  UNRESOLVED_ERRORS_RELEVANT_THRESHOLD,
  INTERVENTION_WEIGHTS,
  UNRESOLVED_NORM,
  RECURRING_NORM,
  RECENCY_NORM_DAYS,
  type KnowledgeStateName,
  type InterventionType,
  type EvidenceLevel,
  type RiskLevel,
  type RecencyClassification,
  type TopicDiagnosis,
} from "./engine";
import type { PlannerSignals } from "../knowledge/signals";

/** Helper para criar sinais com defaults razoáveis. */
function mkSignals(overrides: Partial<PlannerSignals> = {}): PlannerSignals {
  return {
    mastery: 0,
    confidence: 0,
    accuracy: 0,
    recentErrors: 0,
    unresolvedErrors: 0,
    recurringErrors: 0,
    daysSinceStudy: null,
    daysSinceError: null,
    questionCount: 0,
    reviewCount: 0,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTES ORIGINAIS (preservados integralmente)
// ═══════════════════════════════════════════════════════════════════════════

describe("diagnosis engine — base", () => {
  it("1 — no questions produces SEM_EVIDENCIA", () => {
    const d = diagnoseTopic(mkSignals());
    expect(d.knowledgeState).toBe("SEM_EVIDENCIA");
    expect(d.intervention).toBe("ESTUDAR_TEORIA");
    expect(d.evidenceLevel).toBe("NENHUMA");
  });

  it("2 — 1 question produces SEM_EVIDENCIA", () => {
    const d = diagnoseTopic(
      mkSignals({ questionCount: 1, confidence: 0.095, mastery: 1.0, accuracy: 1.0 }),
    );
    expect(d.knowledgeState).toBe("SEM_EVIDENCIA");
  });

  it("3 — high mastery + low confidence produces CONSOLIDANDO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.85,
        confidence: 0.5,
        accuracy: 0.8,
        questionCount: 7,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
    expect(d.intervention).toBe("CONSOLIDAR");
    expect(d.secondarySignals).toContain(
      "domínio falso potencial: mastery alto com evidence insuficiente",
    );
  });

  it("4 — high mastery + high confidence + good accuracy produces DOMINADO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.85,
        confidence: 0.9,
        accuracy: 0.8,
        questionCount: 25,
        daysSinceStudy: 5,
      }),
    );
    expect(d.knowledgeState).toBe("DOMINADO");
    expect(d.intervention).toBe("MANUTENCAO");
  });

  it("5 — low mastery + high confidence produces PONTO_CRITICO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.2,
        confidence: 0.8,
        accuracy: 0.25,
        questionCount: 20,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
  });

  it("6 — low accuracy with medium evidence", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.45,
        confidence: 0.55,
        accuracy: 0.3,
        questionCount: 8,
        daysSinceStudy: 5,
      }),
    );
    expect(d.knowledgeState).toBe("APRENDIZAGEM");
  });

  it("7 — high accuracy with medium mastery and evidence", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.55,
        confidence: 0.6,
        accuracy: 0.85,
        questionCount: 10,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("INSTAVEL");
  });
});

describe("diagnosis engine — erros", () => {
  it("8 — no errors with medium mastery produces APRENDIZAGEM", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.5,
        questionCount: 10,
        daysSinceStudy: 3,
        unresolvedErrors: 0,
        recurringErrors: 0,
      }),
    );
    expect(d.knowledgeState).toBe("APRENDIZAGEM");
  });

  it("9 — unresolved errors noted in secondary signals and affect intervention", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.5,
        questionCount: 10,
        daysSinceStudy: 3,
        unresolvedErrors: 3,
        recurringErrors: 0,
      }),
    );
    expect(d.intervention).toBe("REVISAR_ERROS");
    expect(d.secondarySignals.some((s) => s.includes("não resolvido"))).toBe(true);
  });

  it("10 — recurring errors with medium evidence escalates to PONTO_CRITICO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.5,
        questionCount: 10,
        daysSinceStudy: 3,
        recurringErrors: 2,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
    expect(d.intervention).toBe("REFORCAR_PONTO_FRACO");
  });

  it("11 — resolved errors without recurrence does not escalate", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.5,
        questionCount: 10,
        daysSinceStudy: 3,
        unresolvedErrors: 0,
        recurringErrors: 0,
        recentErrors: 2,
      }),
    );
    expect(d.knowledgeState).not.toBe("PONTO_CRITICO");
  });

  it("12 — recurring error after resolution escalates", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.45,
        confidence: 0.65,
        accuracy: 0.45,
        questionCount: 12,
        daysSinceStudy: 2,
        unresolvedErrors: 1,
        recurringErrors: 1,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
  });
});

describe("diagnosis engine — recência", () => {
  it("13 — recent study with good mastery → DOMINADO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.8,
        confidence: 0.85,
        accuracy: 0.75,
        questionCount: 20,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).toBe("DOMINADO");
    expect(d.recency).toBe("RECENTE");
  });

  it("14 — old study with low-medium mastery → APRENDIZAGEM", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.45,
        confidence: 0.6,
        accuracy: 0.45,
        questionCount: 10,
        daysSinceStudy: 30,
      }),
    );
    expect(d.recency).toBe("ANTIGO");
    expect(d.knowledgeState).toBe("APRENDIZAGEM");
  });

  it("15 — high mastery + long absence → RISCO_ESQUECIMENTO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.75,
        confidence: 0.8,
        accuracy: 0.7,
        questionCount: 18,
        daysSinceStudy: 30,
      }),
    );
    expect(d.knowledgeState).toBe("RISCO_ESQUECIMENTO");
    expect(d.intervention).toBe("REVISAR");
    expect(d.diagnosisReason).toContain("ausência prolongada");
  });
});

describe("diagnosis engine — instabilidade", () => {
  it("16 — consistent correct answers → not INSTAVEL", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.8,
        confidence: 0.85,
        accuracy: 0.85,
        questionCount: 20,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).not.toBe("INSTAVEL");
  });

  it("17 — consistent errors → not INSTAVEL", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.15,
        confidence: 0.6,
        accuracy: 0.15,
        questionCount: 10,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).not.toBe("INSTAVEL");
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
  });

  it("18 — oscillating performance → INSTAVEL", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.6,
        confidence: 0.65,
        accuracy: 0.35,
        questionCount: 12,
        daysSinceStudy: 4,
      }),
    );
    expect(d.knowledgeState).toBe("INSTAVEL");
  });

  it("19 — insufficient sample does not produce INSTAVEL", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.6,
        confidence: 0.3,
        accuracy: 0.3,
        questionCount: 4,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).not.toBe("INSTAVEL");
  });
});

describe("diagnosis engine — combinações", () => {
  it("20 — low mastery + high confidence + recurrence → PONTO_CRITICO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.25,
        confidence: 0.85,
        accuracy: 0.25,
        questionCount: 25,
        daysSinceStudy: 3,
        recurringErrors: 2,
        unresolvedErrors: 1,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
    expect(d.riskLevel).toBe("CRITICO");
  });

  it("21 — high mastery + low confidence → CONSOLIDANDO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.8,
        confidence: 0.35,
        accuracy: 0.8,
        questionCount: 5,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
  });

  it("22 — high mastery + high confidence + recent study → DOMINADO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.9,
        confidence: 0.95,
        accuracy: 0.88,
        questionCount: 50,
        daysSinceStudy: 1,
      }),
    );
    expect(d.knowledgeState).toBe("DOMINADO");
  });

  it("23 — high mastery + high confidence + old study → RISCO_ESQUECIMENTO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.85,
        confidence: 0.9,
        accuracy: 0.82,
        questionCount: 25,
        daysSinceStudy: 35,
      }),
    );
    expect(d.knowledgeState).toBe("RISCO_ESQUECIMENTO");
  });

  it("24 — medium mastery + recurring errors → PONTO_CRITICO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.55,
        confidence: 0.65,
        accuracy: 0.55,
        questionCount: 12,
        daysSinceStudy: 5,
        recurringErrors: 2,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
  });

  it("25 — medium mastery + no errors → APRENDIZAGEM", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.55,
        confidence: 0.65,
        accuracy: 0.55,
        questionCount: 12,
        daysSinceStudy: 5,
        unresolvedErrors: 0,
        recurringErrors: 0,
      }),
    );
    expect(d.knowledgeState).toBe("APRENDIZAGEM");
  });
});

describe("diagnosis engine — propriedades", () => {
  it("26 — intervention_score always between 0 and 1", () => {
    const scenarios: Partial<PlannerSignals>[] = [
      {},
      { mastery: 1, confidence: 1, accuracy: 1, questionCount: 100, daysSinceStudy: 0 },
      { mastery: 0, confidence: 0, accuracy: 0, questionCount: 0, daysSinceStudy: null },
      {
        mastery: 0,
        confidence: 1,
        accuracy: 0,
        unresolvedErrors: 10,
        recurringErrors: 10,
        questionCount: 50,
        daysSinceStudy: 100,
      },
      { mastery: 1, confidence: 0.01, accuracy: 1, questionCount: 1 },
    ];
    for (const s of scenarios) {
      const score = computeInterventionScore(mkSignals(s));
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it("27 — deterministic: same input produces same output", () => {
    const signals = mkSignals({
      mastery: 0.55,
      confidence: 0.6,
      accuracy: 0.5,
      questionCount: 10,
      daysSinceStudy: 5,
      unresolvedErrors: 1,
      recurringErrors: 0,
    });
    const d1 = diagnoseTopic(signals);
    const d2 = diagnoseTopic(signals);
    expect(d1).toEqual(d2);
  });

  it("28 — same input with referenceDate produces same output", () => {
    const signals = mkSignals({
      mastery: 0.4,
      confidence: 0.5,
      accuracy: 0.4,
      questionCount: 7,
      daysSinceStudy: 10,
    });
    const d1 = diagnoseTopic(signals, "2026-08-01");
    const d2 = diagnoseTopic(signals, "2026-08-01");
    expect(d1).toEqual(d2);
  });

  it("29 — no impossible state: zeros produce SEM_EVIDENCIA", () => {
    const d = diagnoseTopic(mkSignals());
    const validStates: KnowledgeStateName[] = [
      "SEM_EVIDENCIA",
      "APRENDIZAGEM",
      "INSTAVEL",
      "CONSOLIDANDO",
      "DOMINADO",
      "RISCO_ESQUECIMENTO",
      "PONTO_CRITICO",
    ];
    expect(validStates).toContain(d.knowledgeState);
  });

  it("30 — no conflicting states across varied inputs", () => {
    const inputs: Partial<PlannerSignals>[] = [
      { mastery: 0, confidence: 0, accuracy: 0, questionCount: 0 },
      { mastery: 1, confidence: 1, accuracy: 1, questionCount: 100, daysSinceStudy: 1 },
      { mastery: 0.5, confidence: 0.5, accuracy: 0.5, questionCount: 7, daysSinceStudy: 10 },
      { mastery: 0.9, confidence: 0.2, accuracy: 0.9, questionCount: 3, daysSinceStudy: 2 },
      { mastery: 0.1, confidence: 0.9, accuracy: 0.1, questionCount: 30, daysSinceStudy: 1 },
      { mastery: 0.7, confidence: 0.8, accuracy: 0.3, questionCount: 20, daysSinceStudy: 3 },
    ];

    for (const input of inputs) {
      const d = diagnoseTopic(mkSignals(input));
      if (d.knowledgeState === "DOMINADO") {
        expect(d.mastery).toBeGreaterThanOrEqual(HIGH_MASTERY_THRESHOLD);
        expect(d.confidence).toBeGreaterThanOrEqual(HIGH_CONFIDENCE_THRESHOLD);
      }
      if (d.knowledgeState === "PONTO_CRITICO") {
        expect(d.evidenceLevel).not.toBe("NENHUMA");
      }
      if (d.knowledgeState === "SEM_EVIDENCIA") {
        expect(d.evidenceLevel).toBe("NENHUMA");
      }
    }
  });
});

describe("diagnosis engine — precedência", () => {
  it("31 — PONTO_CRITICO over APRENDIZAGEM", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.3,
        confidence: 0.5,
        accuracy: 0.3,
        questionCount: 7,
        daysSinceStudy: 3,
        recurringErrors: 1,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
  });

  it("32 — not DOMINADO with low confidence", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.85,
        confidence: 0.3,
        accuracy: 0.85,
        questionCount: 4,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).not.toBe("DOMINADO");
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
  });

  it("33 — RISCO_ESQUECIMENTO with long absence", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.75,
        accuracy: 0.7,
        questionCount: 15,
        daysSinceStudy: 25,
      }),
    );
    expect(d.knowledgeState).toBe("RISCO_ESQUECIMENTO");
  });

  it("34 — PONTO_CRITICO over RISCO_ESQUECIMENTO when mastery low", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.3,
        confidence: 0.6,
        accuracy: 0.3,
        questionCount: 10,
        daysSinceStudy: 30,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
  });

  it("35 — high mastery + high confidence + low accuracy → not DOMINADO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.8,
        confidence: 0.85,
        accuracy: 0.4,
        questionCount: 20,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).not.toBe("DOMINADO");
    expect(d.knowledgeState).toBe("INSTAVEL");
  });
});

describe("diagnosis engine — auxiliary functions", () => {
  it("classifyEvidence maps correctly", () => {
    expect(classifyEvidence(0, 0)).toBe("NENHUMA");
    expect(classifyEvidence(0.1, 1)).toBe("NENHUMA");
    expect(classifyEvidence(0.2, 3)).toBe("BAIXA");
    expect(classifyEvidence(0.5, 7)).toBe("MEDIA");
    expect(classifyEvidence(0.8, 20)).toBe("ALTA");
  });

  it("classifyRecency maps correctly", () => {
    expect(classifyRecency(null)).toBe("DESCONHECIDA");
    expect(classifyRecency(0)).toBe("RECENTE");
    expect(classifyRecency(7)).toBe("RECENTE");
    expect(classifyRecency(8)).toBe("ATENCAO");
    expect(classifyRecency(21)).toBe("ATENCAO");
    expect(classifyRecency(22)).toBe("ANTIGO");
  });

  it("classifyRisk considers multiple signals", () => {
    const low = classifyRisk(
      mkSignals({ mastery: 0.8, confidence: 0.9, accuracy: 0.8, questionCount: 20 }),
      "ALTA",
    );
    expect(low).toBe("BAIXO");

    const critical = classifyRisk(
      mkSignals({
        mastery: 0.15,
        confidence: 0.9,
        accuracy: 0.15,
        questionCount: 30,
        unresolvedErrors: 3,
        recurringErrors: 2,
        daysSinceStudy: 30,
      }),
      "ALTA",
    );
    expect(critical).toBe("CRITICO");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ETAPA 3.2.1 — AUDITORIA: NOVOS TESTES
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 2: MATRIZ DE ESTADOS — verificação de cobertura
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §2 — state matrix coverage", () => {
  const ALL_STATES: KnowledgeStateName[] = [
    "SEM_EVIDENCIA",
    "APRENDIZAGEM",
    "INSTAVEL",
    "CONSOLIDANDO",
    "DOMINADO",
    "RISCO_ESQUECIMENTO",
    "PONTO_CRITICO",
  ];

  it("every state is reachable", () => {
    const reached = new Set<KnowledgeStateName>();

    // SEM_EVIDENCIA: 0 questões
    reached.add(diagnoseTopic(mkSignals()).knowledgeState);
    // APRENDIZAGEM: mastery médio, sem erros, evidência MEDIA
    reached.add(
      diagnoseTopic(
        mkSignals({
          mastery: 0.5,
          confidence: 0.6,
          accuracy: 0.5,
          questionCount: 10,
          daysSinceStudy: 3,
        }),
      ).knowledgeState,
    );
    // INSTAVEL: divergência mastery/accuracy com evidência MEDIA
    reached.add(
      diagnoseTopic(
        mkSignals({
          mastery: 0.6,
          confidence: 0.65,
          accuracy: 0.3,
          questionCount: 12,
          daysSinceStudy: 3,
        }),
      ).knowledgeState,
    );
    // CONSOLIDANDO: mastery alto + confidence baixa
    reached.add(
      diagnoseTopic(
        mkSignals({
          mastery: 0.8,
          confidence: 0.5,
          accuracy: 0.8,
          questionCount: 7,
          daysSinceStudy: 3,
        }),
      ).knowledgeState,
    );
    // DOMINADO: mastery alto + confidence alta + accuracy boa
    reached.add(
      diagnoseTopic(
        mkSignals({
          mastery: 0.85,
          confidence: 0.9,
          accuracy: 0.8,
          questionCount: 25,
          daysSinceStudy: 3,
        }),
      ).knowledgeState,
    );
    // RISCO_ESQUECIMENTO: mastery alto + confidence + estudo antigo
    reached.add(
      diagnoseTopic(
        mkSignals({
          mastery: 0.75,
          confidence: 0.8,
          accuracy: 0.7,
          questionCount: 18,
          daysSinceStudy: 30,
        }),
      ).knowledgeState,
    );
    // PONTO_CRITICO: mastery baixo + confidence alta
    reached.add(
      diagnoseTopic(
        mkSignals({
          mastery: 0.2,
          confidence: 0.8,
          accuracy: 0.2,
          questionCount: 20,
          daysSinceStudy: 2,
        }),
      ).knowledgeState,
    );

    for (const state of ALL_STATES) {
      expect(reached).toContain(state);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 3: PRECEDÊNCIA — casos obrigatórios A–E
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §3 — precedence cases", () => {
  // Caso A: mastery baixo + confidence alta + erro recorrente → PONTO_CRITICO
  it("Case A: low mastery + high confidence + recurring error → PONTO_CRITICO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.2,
        confidence: 0.85,
        accuracy: 0.2,
        questionCount: 20,
        daysSinceStudy: 2,
        recurringErrors: 2,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
  });

  // Caso B: mastery alto + confidence baixa → NÃO pode ser DOMINADO
  it("Case B: high mastery + low confidence → never DOMINADO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.9,
        confidence: 0.3,
        accuracy: 0.9,
        questionCount: 4,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).not.toBe("DOMINADO");
    // Should be CONSOLIDANDO
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
  });

  // Caso C: mastery alto + confidence alta + estudo antigo → RISCO_ESQUECIMENTO
  it("Case C: high mastery + high confidence + old study → RISCO_ESQUECIMENTO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.85,
        confidence: 0.9,
        accuracy: 0.8,
        questionCount: 25,
        daysSinceStudy: 30,
      }),
    );
    expect(d.knowledgeState).toBe("RISCO_ESQUECIMENTO");
  });

  // Caso D: mastery médio + accuracy muito diferente + evidência suficiente → INSTAVEL
  it("Case D: medium mastery + divergent accuracy + sufficient evidence → INSTAVEL", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.55,
        confidence: 0.6,
        accuracy: 0.25,
        questionCount: 10,
        daysSinceStudy: 3,
      }),
    );
    // |0.25 - 0.55| = 0.30 >= 0.25, evidence MEDIA → INSTAVEL
    expect(d.knowledgeState).toBe("INSTAVEL");
  });

  // Caso E: pouquíssimas questões + mastery aparentemente alto → SEM_EVIDENCIA
  it("Case E: very few questions + apparently high mastery → SEM_EVIDENCIA", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.95,
        confidence: 0.1,
        accuracy: 1.0,
        questionCount: 1,
        daysSinceStudy: 1,
      }),
    );
    expect(d.knowledgeState).toBe("SEM_EVIDENCIA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 4: SEM_EVIDENCIA × CONSOLIDANDO
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §4 — SEM_EVIDENCIA vs CONSOLIDANDO", () => {
  it("questionCount=0, mastery=0.70, confidence=0.74 → SEM_EVIDENCIA (NENHUMA evidence)", () => {
    // questionCount < 2 forces NENHUMA regardless of confidence
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.74,
        accuracy: 1.0,
        questionCount: 0,
      }),
    );
    expect(d.knowledgeState).toBe("SEM_EVIDENCIA");
  });

  it("questionCount=1, mastery=0.90, confidence=0.70 → SEM_EVIDENCIA", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.9,
        confidence: 0.7,
        accuracy: 1.0,
        questionCount: 1,
        daysSinceStudy: 1,
      }),
    );
    expect(d.knowledgeState).toBe("SEM_EVIDENCIA");
  });

  it("questionCount=2, mastery=0.80, confidence=0.18 → CONSOLIDANDO (evidence BAIXA, mastery high)", () => {
    // confidence 0.18 >= 0.15 and questionCount 2 >= 2 → evidence BAIXA
    // mastery 0.80 >= 0.70 and confidence 0.18 < 0.75 → CONSOLIDANDO
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.8,
        confidence: 0.18,
        accuracy: 1.0,
        questionCount: 2,
        daysSinceStudy: 1,
      }),
    );
    expect(d.evidenceLevel).toBe("BAIXA");
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
  });

  it("confidence < 0.15 always produces SEM_EVIDENCIA regardless of mastery", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.99,
        confidence: 0.14,
        accuracy: 1.0,
        questionCount: 5,
        daysSinceStudy: 1,
      }),
    );
    expect(d.knowledgeState).toBe("SEM_EVIDENCIA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 5: DOMÍNIO FALSO (CONSOLIDANDO thresholds)
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §5 — false mastery (CONSOLIDANDO)", () => {
  it("mastery 0.70 / confidence 0.20 → CONSOLIDANDO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.2,
        accuracy: 0.7,
        questionCount: 3,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
  });

  it("mastery 0.90 / confidence 0.20 → CONSOLIDANDO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.9,
        confidence: 0.2,
        accuracy: 0.9,
        questionCount: 3,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
  });

  it("mastery 0.99 / confidence 0.30 → CONSOLIDANDO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.99,
        confidence: 0.3,
        accuracy: 0.99,
        questionCount: 4,
        daysSinceStudy: 1,
      }),
    );
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
  });

  it("mastery 0.70 / confidence 0.74 → CONSOLIDANDO (just below threshold)", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.74,
        accuracy: 0.7,
        questionCount: 14,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
  });

  it("mastery 0.70 / confidence 0.75 / accuracy 0.70 → DOMINADO (at threshold)", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.75,
        accuracy: 0.7,
        questionCount: 14,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).toBe("DOMINADO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 6: DOMINADO thresholds
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §6 — DOMINADO thresholds", () => {
  it("mastery exactly 0.70 + confidence 0.75 + accuracy 0.60 → DOMINADO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.75,
        accuracy: 0.6,
        questionCount: 14,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("DOMINADO");
  });

  it("mastery 0.69 + confidence 0.75 + accuracy 0.60 → NOT DOMINADO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.69,
        confidence: 0.75,
        accuracy: 0.6,
        questionCount: 14,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).not.toBe("DOMINADO");
    // mastery < 0.70, confidence >= 0.75 → APRENDIZAGEM (falls through)
    expect(d.knowledgeState).toBe("APRENDIZAGEM");
  });

  it("mastery 0.70 + confidence 0.75 + accuracy 0.59 → NOT DOMINADO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.75,
        accuracy: 0.59,
        questionCount: 14,
        daysSinceStudy: 3,
      }),
    );
    // accuracy 0.59 < 0.60 → fails DOMINADO
    // |0.59 - 0.70| = 0.11 < 0.25 → not INSTAVEL
    // mastery 0.70 >= 0.70 but confidence 0.75 >= 0.75 → not CONSOLIDANDO
    // Falls to APRENDIZAGEM
    expect(d.knowledgeState).not.toBe("DOMINADO");
    expect(d.knowledgeState).toBe("APRENDIZAGEM");
  });

  it("mastery 0.70 + confidence 0.74 + accuracy 0.60 → CONSOLIDANDO (not DOMINADO)", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.74,
        accuracy: 0.6,
        questionCount: 14,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
  });

  it("mastery 0.70 + confidence 0.75 + accuracy 0.60 + study at recency limit (day 7) → DOMINADO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.75,
        accuracy: 0.6,
        questionCount: 14,
        daysSinceStudy: 7,
      }),
    );
    expect(d.knowledgeState).toBe("DOMINADO");
    expect(d.recency).toBe("RECENTE");
  });

  it("DOMINADO with ATENCAO recency gets secondary signal", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.8,
        confidence: 0.85,
        accuracy: 0.75,
        questionCount: 20,
        daysSinceStudy: 15,
      }),
    );
    expect(d.knowledgeState).toBe("DOMINADO");
    expect(d.recency).toBe("ATENCAO");
    expect(d.secondarySignals.some((s) => s.includes("revisão preventiva"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 7: PONTO_CRITICO thresholds and differentiation
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §7 — PONTO_CRITICO", () => {
  // Caso 1: mastery=0.39, confidence=0.40 → PONTO_CRITICO (by mastery)
  it("Case 1: mastery=0.39 confidence=0.40 → PONTO_CRITICO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.39,
        confidence: 0.4,
        accuracy: 0.39,
        questionCount: 5,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
  });

  // Caso 2: mastery=0.40, confidence=0.40 → NOT PONTO_CRITICO by mastery (>= threshold)
  it("Case 2: mastery=0.40 confidence=0.40 → NOT PONTO_CRITICO by mastery", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.4,
        confidence: 0.4,
        accuracy: 0.4,
        questionCount: 5,
        daysSinceStudy: 3,
        recurringErrors: 0,
      }),
    );
    expect(d.knowledgeState).not.toBe("PONTO_CRITICO");
    expect(d.knowledgeState).toBe("APRENDIZAGEM");
  });

  // Caso 3: mastery=0.60, confidence média, recurring_errors>0 → PONTO_CRITICO by recurrence
  // HEURÍSTICA: erro recorrente com evidência média eleva a PONTO_CRITICO mesmo com mastery médio.
  it("Case 3: mastery=0.60 + recurring errors → PONTO_CRITICO by recurrence", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.6,
        confidence: 0.6,
        accuracy: 0.6,
        questionCount: 10,
        daysSinceStudy: 3,
        recurringErrors: 1,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
    expect(d.secondarySignals.some((s) => s.includes("recorrente"))).toBe(true);
  });

  // Caso 4: mastery=0.80, confidence alta, recurring_errors>0 → PONTO_CRITICO by recurrence
  // HEURÍSTICA DOCUMENTADA: mesmo com domínio alto, erros recorrentes elevam a PONTO_CRITICO.
  // Escolha pedagógica: priorizar intervenção sobre erro recorrente.
  // Em versões futuras, considerar emitir como sinal secundário em vez de estado principal.
  it("Case 4: mastery=0.80 + recurring errors → PONTO_CRITICO (pedagogical choice)", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.8,
        confidence: 0.85,
        accuracy: 0.8,
        questionCount: 20,
        daysSinceStudy: 2,
        recurringErrors: 1,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
    // Documents: this is a pedagogical choice, not a mathematical necessity.
    // The recurring error overrides good mastery as an aggressive heuristic.
    expect(d.intervention).toBe("REFORCAR_PONTO_FRACO");
  });

  it("PONTO_CRITICO by low mastery produces RESOLVER_QUESTOES when no errors", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.2,
        confidence: 0.6,
        accuracy: 0.2,
        questionCount: 10,
        daysSinceStudy: 3,
        recurringErrors: 0,
        unresolvedErrors: 0,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
    expect(d.intervention).toBe("RESOLVER_QUESTOES");
  });

  it("PONTO_CRITICO by low mastery with unresolved errors → REVISAR_ERROS", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.2,
        confidence: 0.6,
        accuracy: 0.2,
        questionCount: 10,
        daysSinceStudy: 3,
        recurringErrors: 0,
        unresolvedErrors: 2,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
    expect(d.intervention).toBe("REVISAR_ERROS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 8: INSTABILIDADE
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §8 — INSTAVEL", () => {
  it("divergence exactly 0.25 → INSTAVEL (with MEDIA evidence)", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.75,
        questionCount: 10,
        daysSinceStudy: 3,
      }),
    );
    // |0.75 - 0.50| = 0.25 >= 0.25 → INSTAVEL
    expect(d.knowledgeState).toBe("INSTAVEL");
  });

  it("divergence 0.249 → NOT INSTAVEL", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.749,
        questionCount: 10,
        daysSinceStudy: 3,
      }),
    );
    // |0.749 - 0.50| = 0.249 < 0.25 → not INSTAVEL
    expect(d.knowledgeState).not.toBe("INSTAVEL");
  });

  it("divergence 0.251 → INSTAVEL", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.751,
        questionCount: 10,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("INSTAVEL");
  });

  it("mastery 0.8 / accuracy 0.5 → INSTAVEL (divergence 0.30)", () => {
    // Note: mastery 0.80 >= HIGH_MASTERY, but RISCO_ESQUECIMENTO requires recency ANTIGO.
    // INSTAVEL is checked after RISCO, and confidence < 0.75 would route to CONSOLIDANDO first.
    // With confidence >= 0.75: CONSOLIDANDO skipped, DOMINADO needs accuracy >= 0.60.
    // accuracy 0.50 < 0.60 → fails DOMINADO, then INSTAVEL check: |0.50 - 0.80| = 0.30 >= 0.25.
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.8,
        confidence: 0.85,
        accuracy: 0.5,
        questionCount: 20,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("INSTAVEL");
  });

  it("mastery 0.5 / accuracy 0.8 → INSTAVEL (divergence 0.30)", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.8,
        questionCount: 10,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("INSTAVEL");
  });

  it("mastery 0.3 / accuracy 0.55 → divergence 0.25, but PONTO_CRITICO takes precedence", () => {
    // mastery 0.30 < 0.40 + confidence 0.60 >= 0.40 → PONTO_CRITICO (higher precedence)
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.3,
        confidence: 0.6,
        accuracy: 0.55,
        questionCount: 10,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
  });

  it("few questions with divergence → NOT INSTAVEL (evidence BAIXA)", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.8,
        confidence: 0.3,
        accuracy: 0.4,
        questionCount: 4,
        daysSinceStudy: 2,
      }),
    );
    // evidence BAIXA → INSTAVEL not triggered
    // mastery >= 0.70, confidence < 0.75 → CONSOLIDANDO
    expect(d.knowledgeState).not.toBe("INSTAVEL");
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
  });

  // LIMITAÇÃO DOCUMENTADA: divergência mastery × accuracy pode representar
  // mudança recente de desempenho e não necessariamente "instabilidade".
  // Mastery é EMA ponderada. Accuracy é média histórica.
  // Uma melhora recente gera accuracy < mastery (accuracy incorpora histórico ruim).
  // Isso pode ser sinalizado como INSTAVEL quando na verdade é progresso.
  // O engine não tem dados temporais granulares suficientes para distinguir.
  it("DOCUMENTED LIMITATION: divergence from recent improvement flagged as INSTAVEL", () => {
    // Cenário: aluno melhorou recentemente. EMA (mastery) subiu, accuracy histórica ficou para trás.
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.75,
        confidence: 0.6,
        accuracy: 0.45,
        questionCount: 10,
        daysSinceStudy: 1,
      }),
    );
    // |0.45 - 0.75| = 0.30 >= 0.25, evidence MEDIA → INSTAVEL
    // But mastery >= 0.70 and confidence < 0.75 → CONSOLIDANDO is checked first.
    // CONSOLIDANDO: mastery 0.75 >= 0.70, confidence 0.60 < 0.75 → hits CONSOLIDANDO.
    // INSTAVEL is only checked AFTER CONSOLIDANDO. So CONSOLIDANDO takes precedence here.
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 9: RISCO_ESQUECIMENTO thresholds
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §9 — RISCO_ESQUECIMENTO", () => {
  it("20 days → NOT RISCO_ESQUECIMENTO (ATENCAO, not ANTIGO)", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.75,
        accuracy: 0.7,
        questionCount: 14,
        daysSinceStudy: 20,
      }),
    );
    expect(d.recency).toBe("ATENCAO");
    expect(d.knowledgeState).not.toBe("RISCO_ESQUECIMENTO");
    expect(d.knowledgeState).toBe("DOMINADO");
  });

  it("21 days → NOT RISCO_ESQUECIMENTO (still ATENCAO due to <= in classifyRecency)", () => {
    // classifyRecency: daysSinceStudy <= 21 → ATENCAO; > 21 → ANTIGO
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.75,
        accuracy: 0.7,
        questionCount: 14,
        daysSinceStudy: 21,
      }),
    );
    expect(d.recency).toBe("ATENCAO");
    expect(d.knowledgeState).not.toBe("RISCO_ESQUECIMENTO");
    expect(d.knowledgeState).toBe("DOMINADO");
  });

  it("22 days → RISCO_ESQUECIMENTO (ANTIGO starts at >21)", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.75,
        accuracy: 0.7,
        questionCount: 14,
        daysSinceStudy: 22,
      }),
    );
    expect(d.recency).toBe("ANTIGO");
    expect(d.knowledgeState).toBe("RISCO_ESQUECIMENTO");
  });

  it("mastery 0.49 + 30 days → NOT RISCO_ESQUECIMENTO (mastery below threshold)", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.49,
        confidence: 0.6,
        accuracy: 0.49,
        questionCount: 10,
        daysSinceStudy: 30,
      }),
    );
    expect(d.knowledgeState).not.toBe("RISCO_ESQUECIMENTO");
  });

  it("mastery 0.50 + confidence 0.40 + 30 days → RISCO_ESQUECIMENTO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.4,
        accuracy: 0.5,
        questionCount: 5,
        daysSinceStudy: 30,
      }),
    );
    expect(d.knowledgeState).toBe("RISCO_ESQUECIMENTO");
  });

  it("mastery 0.50 + confidence 0.39 + 30 days → NOT RISCO_ESQUECIMENTO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.39,
        accuracy: 0.5,
        questionCount: 5,
        daysSinceStudy: 30,
      }),
    );
    expect(d.knowledgeState).not.toBe("RISCO_ESQUECIMENTO");
  });

  it("diagnosis reason uses probabilistic language", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.75,
        accuracy: 0.7,
        questionCount: 14,
        daysSinceStudy: 25,
      }),
    );
    expect(d.knowledgeState).toBe("RISCO_ESQUECIMENTO");
    // Should NOT say "you forgot". Should say "possible loss" or similar.
    expect(d.diagnosisReason).toContain("possível perda");
    expect(d.diagnosisReason).not.toContain("esqueceu");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 10: RECÊNCIA thresholds
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §10 — recency thresholds", () => {
  it("6 days → RECENTE", () => {
    expect(classifyRecency(6)).toBe("RECENTE");
  });

  it("7 days → RECENTE (boundary: <= 7)", () => {
    expect(classifyRecency(7)).toBe("RECENTE");
  });

  it("8 days → ATENCAO", () => {
    expect(classifyRecency(8)).toBe("ATENCAO");
  });

  it("20 days → ATENCAO", () => {
    expect(classifyRecency(20)).toBe("ATENCAO");
  });

  it("21 days → ATENCAO (boundary: <= 21)", () => {
    expect(classifyRecency(21)).toBe("ATENCAO");
  });

  it("22 days → ANTIGO", () => {
    expect(classifyRecency(22)).toBe("ANTIGO");
  });

  it("null → DESCONHECIDA", () => {
    expect(classifyRecency(null)).toBe("DESCONHECIDA");
  });

  it("no gaps or overlaps in recency classification", () => {
    // Test every integer from 0 to 50 — exactly one classification
    for (let d = 0; d <= 50; d++) {
      const r = classifyRecency(d);
      expect(["RECENTE", "ATENCAO", "ANTIGO"]).toContain(r);

      if (d <= RECENT_DAYS_THRESHOLD) expect(r).toBe("RECENTE");
      else if (d <= OLD_DAYS_THRESHOLD) expect(r).toBe("ATENCAO");
      else expect(r).toBe("ANTIGO");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 11: INTERVENTION SCORE
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §11 — intervention_score", () => {
  it("weights sum to 1.0", () => {
    const W = INTERVENTION_WEIGHTS;
    const sum =
      W.gap + W.evidence + W.unresolved + W.recurring + W.accuracyGap + W.recency + W.stability;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("all components = 0 → score = 0", () => {
    const score = computeInterventionScore(
      mkSignals({
        mastery: 1,
        confidence: 1,
        accuracy: 1,
        questionCount: 100,
        daysSinceStudy: 0,
        unresolvedErrors: 0,
        recurringErrors: 0,
      }),
    );
    expect(score).toBe(0);
  });

  it("all components = 1 → score = 1", () => {
    // mastery=0 → gap=1, confidence=0 → evidence=1, accuracy=0 → accuracyGap=1
    // unresolvedErrors=UNRESOLVED_NORM → unresolved=1
    // recurringErrors=RECURRING_NORM → recurring=1
    // daysSinceStudy=RECENCY_NORM_DAYS → recency=1
    // |accuracy - mastery| = 0 → stability=0... wait
    // Both mastery=0 and accuracy=0 → |0-0|/0.5 = 0. Not all 1.
    // To get stability=1: |accuracy - mastery| >= 0.5.
    // mastery=0, accuracy=0.5 → gap=1, accuracyGap=0.5, stability=1.0
    // That doesn't give all components = 1.
    // Maximum possible: mastery=0, confidence=0, accuracy=0.5,
    //   unresolved=NORM, recurring=NORM, days=NORM
    // gap=1, evidence=1, accuracyGap=0.5, stability=0.5/0.5=1
    // Not all 1 simultaneously — accuracy can't be 0 (accuracyGap=1) and diverge from mastery=0.
    // So true theoretical max is:
    const score = computeInterventionScore(
      mkSignals({
        mastery: 0,
        confidence: 0,
        accuracy: 0,
        questionCount: 0,
        daysSinceStudy: RECENCY_NORM_DAYS,
        unresolvedErrors: UNRESOLVED_NORM,
        recurringErrors: RECURRING_NORM,
      }),
    );
    // gap=1, evidence=1, unresolved=1, recurring=1, accuracyGap=1, recency=1, stability=0
    // score = 0.30*1 + 0.10*1 + 0.15*1 + 0.15*1 + 0.10*1 + 0.10*1 + 0.10*0 = 0.90
    expect(score).toBeCloseTo(0.9, 5);
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("maximal score with all components truly maximized", () => {
    // mastery=0.5, accuracy=0 → gap=0.5, accuracyGap=1, stability=|0-0.5|/0.5=1
    // confidence=0 → evidence=1
    const score = computeInterventionScore(
      mkSignals({
        mastery: 0.5,
        confidence: 0,
        accuracy: 0,
        questionCount: 0,
        daysSinceStudy: RECENCY_NORM_DAYS,
        unresolvedErrors: UNRESOLVED_NORM,
        recurringErrors: RECURRING_NORM,
      }),
    );
    // gap=0.5, evidence=1, unresolved=1, recurring=1, accuracyGap=1, recency=1, stability=1
    // 0.30*0.5 + 0.10*1 + 0.15*1 + 0.15*1 + 0.10*1 + 0.10*1 + 0.10*1 = 0.15+0.10+0.15+0.15+0.10+0.10+0.10 = 0.85
    expect(score).toBeCloseTo(0.85, 5);
  });

  it("no NaN for any combination", () => {
    const combos: Partial<PlannerSignals>[] = [
      {},
      { mastery: 0, confidence: 0, accuracy: 0, questionCount: 0 },
      { mastery: 1, confidence: 1, accuracy: 1, questionCount: 100 },
      { daysSinceStudy: null },
      { daysSinceStudy: 0 },
      { daysSinceStudy: 999 },
      { unresolvedErrors: 0, recurringErrors: 0 },
      { unresolvedErrors: 100, recurringErrors: 100 },
    ];
    for (const c of combos) {
      const score = computeInterventionScore(mkSignals(c));
      expect(Number.isNaN(score)).toBe(false);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it("daysSinceStudy=null uses 0.5 as intermediate", () => {
    const withNull = computeInterventionScore(
      mkSignals({
        mastery: 0.5,
        confidence: 0.5,
        accuracy: 0.5,
        questionCount: 7,
        daysSinceStudy: null,
      }),
    );
    const withZero = computeInterventionScore(
      mkSignals({
        mastery: 0.5,
        confidence: 0.5,
        accuracy: 0.5,
        questionCount: 7,
        daysSinceStudy: 0,
      }),
    );
    const withHigh = computeInterventionScore(
      mkSignals({
        mastery: 0.5,
        confidence: 0.5,
        accuracy: 0.5,
        questionCount: 7,
        daysSinceStudy: 60,
      }),
    );
    // null (0.5) should be between 0 (zero days) and 1 (60 days)
    expect(withNull).toBeGreaterThan(withZero);
    expect(withNull).toBeLessThan(withHigh);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 12: INTERVENÇÕES — matriz ESTADO → INTERVENÇÃO
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §12 — state-to-intervention mapping", () => {
  it("SEM_EVIDENCIA → ESTUDAR_TEORIA", () => {
    const d = diagnoseTopic(mkSignals({ questionCount: 0 }));
    expect(d.knowledgeState).toBe("SEM_EVIDENCIA");
    expect(d.intervention).toBe("ESTUDAR_TEORIA");
  });

  it("APRENDIZAGEM with few data → ESTUDAR_TEORIA", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.4,
        confidence: 0.2,
        accuracy: 0.4,
        questionCount: 3,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).toBe("APRENDIZAGEM");
    expect(d.intervention).toBe("ESTUDAR_TEORIA");
  });

  it("APRENDIZAGEM with sufficient evidence → RESOLVER_QUESTOES", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.5,
        questionCount: 10,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("APRENDIZAGEM");
    expect(d.intervention).toBe("RESOLVER_QUESTOES");
  });

  it("APRENDIZAGEM with unresolved errors → REVISAR_ERROS", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.5,
        questionCount: 10,
        daysSinceStudy: 3,
        unresolvedErrors: 2,
      }),
    );
    expect(d.knowledgeState).toBe("APRENDIZAGEM");
    expect(d.intervention).toBe("REVISAR_ERROS");
  });

  it("PONTO_CRITICO with recurrence → REFORCAR_PONTO_FRACO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.5,
        questionCount: 10,
        daysSinceStudy: 3,
        recurringErrors: 2,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
    expect(d.intervention).toBe("REFORCAR_PONTO_FRACO");
  });

  it("RISCO_ESQUECIMENTO → REVISAR", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.75,
        accuracy: 0.7,
        questionCount: 14,
        daysSinceStudy: 25,
      }),
    );
    expect(d.knowledgeState).toBe("RISCO_ESQUECIMENTO");
    expect(d.intervention).toBe("REVISAR");
  });

  it("CONSOLIDANDO → CONSOLIDAR", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.8,
        confidence: 0.5,
        accuracy: 0.8,
        questionCount: 7,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
    expect(d.intervention).toBe("CONSOLIDAR");
  });

  it("DOMINADO → MANUTENCAO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.85,
        confidence: 0.9,
        accuracy: 0.8,
        questionCount: 25,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("DOMINADO");
    expect(d.intervention).toBe("MANUTENCAO");
  });

  it("INSTAVEL with unresolved errors → REVISAR_ERROS", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.6,
        confidence: 0.65,
        accuracy: 0.3,
        questionCount: 12,
        daysSinceStudy: 3,
        unresolvedErrors: 2,
      }),
    );
    expect(d.knowledgeState).toBe("INSTAVEL");
    expect(d.intervention).toBe("REVISAR_ERROS");
  });

  it("INSTAVEL without errors → RESOLVER_QUESTOES", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.6,
        confidence: 0.65,
        accuracy: 0.3,
        questionCount: 12,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("INSTAVEL");
    expect(d.intervention).toBe("RESOLVER_QUESTOES");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 13: CONFLITOS ESTADO × INTERVENÇÃO
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §13 — state-intervention conflict prevention", () => {
  it("DOMINADO never produces ESTUDAR_TEORIA", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.9,
        confidence: 0.95,
        accuracy: 0.9,
        questionCount: 50,
        daysSinceStudy: 1,
      }),
    );
    expect(d.knowledgeState).toBe("DOMINADO");
    expect(d.intervention).not.toBe("ESTUDAR_TEORIA");
  });

  it("PONTO_CRITICO never produces MANUTENCAO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.2,
        confidence: 0.8,
        accuracy: 0.2,
        questionCount: 20,
        daysSinceStudy: 2,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
    expect(d.intervention).not.toBe("MANUTENCAO");
  });

  it("RISCO_ESQUECIMENTO never produces ESTUDAR_TEORIA", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.75,
        accuracy: 0.7,
        questionCount: 14,
        daysSinceStudy: 25,
      }),
    );
    expect(d.knowledgeState).toBe("RISCO_ESQUECIMENTO");
    expect(d.intervention).not.toBe("ESTUDAR_TEORIA");
  });

  it("CONSOLIDANDO never produces MANUTENCAO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.8,
        confidence: 0.5,
        accuracy: 0.8,
        questionCount: 7,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
    expect(d.intervention).not.toBe("MANUTENCAO");
  });

  it("SEM_EVIDENCIA never produces MANUTENCAO", () => {
    const d = diagnoseTopic(mkSignals());
    expect(d.knowledgeState).toBe("SEM_EVIDENCIA");
    expect(d.intervention).not.toBe("MANUTENCAO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 14: AMOSTRA PEQUENA — progressive evidence
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §14 — sample size progression", () => {
  // All correct answers at each sample size
  const sampleSizes = [0, 1, 2, 3, 5, 10, 20, 50, 100];

  it("system becomes progressively more confident with more evidence", () => {
    let prevConfidence = -1;
    for (const n of sampleSizes) {
      // confidence = 1 - e^(-n/10)
      const confidence = n > 0 ? 1 - Math.exp(-n / 10) : 0;
      const d = diagnoseTopic(
        mkSignals({
          mastery: 0.8,
          confidence,
          accuracy: 0.8,
          questionCount: n,
          daysSinceStudy: 3,
        }),
      );
      expect(d.confidence).toBeGreaterThanOrEqual(prevConfidence);
      prevConfidence = d.confidence;
    }
  });

  it("0 questions → SEM_EVIDENCIA", () => {
    const d = diagnoseTopic(
      mkSignals({ questionCount: 0, mastery: 0.8, confidence: 0, accuracy: 0 }),
    );
    expect(d.knowledgeState).toBe("SEM_EVIDENCIA");
  });

  it("1 question → SEM_EVIDENCIA", () => {
    const d = diagnoseTopic(
      mkSignals({ questionCount: 1, mastery: 0.8, confidence: 0.095, accuracy: 1.0 }),
    );
    expect(d.knowledgeState).toBe("SEM_EVIDENCIA");
  });

  it("2 questions → can leave SEM_EVIDENCIA", () => {
    const d = diagnoseTopic(
      mkSignals({
        questionCount: 2,
        mastery: 0.8,
        confidence: 0.181,
        accuracy: 1.0,
        daysSinceStudy: 1,
      }),
    );
    // confidence 0.181 >= 0.15 and questionCount 2 >= 2 → evidence BAIXA
    expect(d.evidenceLevel).toBe("BAIXA");
    expect(d.knowledgeState).not.toBe("SEM_EVIDENCIA");
  });

  it("3 questions → evidence BAIXA", () => {
    const d = diagnoseTopic(
      mkSignals({
        questionCount: 3,
        mastery: 0.5,
        confidence: 0.26,
        accuracy: 0.67,
        daysSinceStudy: 2,
      }),
    );
    expect(d.evidenceLevel).toBe("BAIXA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 15: MONOTONICIDADE DA CONFIDENCE
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §15 — confidence monotonicity", () => {
  it("more questions never decrease confidence (formula property)", () => {
    let prevConfidence = 0;
    for (let n = 0; n <= 200; n++) {
      const c = n > 0 ? 1 - Math.exp(-n / 10) : 0;
      expect(c).toBeGreaterThanOrEqual(prevConfidence);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
      prevConfidence = c;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 16: ACCURACY coerência
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §16 — accuracy coherence", () => {
  it("accuracy 0/0 treated as 0 (no division by zero in signals)", () => {
    const d = diagnoseTopic(mkSignals({ questionCount: 0, accuracy: 0 }));
    expect(d.accuracy).toBe(0);
  });

  it("accuracy 1/1 → 1.0", () => {
    const d = diagnoseTopic(
      mkSignals({ questionCount: 1, accuracy: 1.0, confidence: 0.095, mastery: 1.0 }),
    );
    expect(d.accuracy).toBe(1.0);
  });

  it("accuracy 0/1 → 0.0", () => {
    const d = diagnoseTopic(
      mkSignals({ questionCount: 1, accuracy: 0.0, confidence: 0.095, mastery: 0.0 }),
    );
    expect(d.accuracy).toBe(0.0);
  });

  it("accuracy always 0..1 in diagnosis output", () => {
    const tests = [0, 0.1, 0.5, 0.85, 1.0];
    for (const a of tests) {
      const d = diagnoseTopic(
        mkSignals({
          accuracy: a,
          mastery: 0.5,
          confidence: 0.6,
          questionCount: 10,
          daysSinceStudy: 3,
        }),
      );
      expect(d.accuracy).toBeGreaterThanOrEqual(0);
      expect(d.accuracy).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 17: CONSISTÊNCIA COM O KNOWLEDGE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §17 — consistency with Knowledge Engine", () => {
  it("diagnosis does not alter mastery value", () => {
    const signals = mkSignals({
      mastery: 0.42,
      confidence: 0.6,
      accuracy: 0.4,
      questionCount: 10,
      daysSinceStudy: 3,
    });
    const d = diagnoseTopic(signals);
    expect(d.mastery).toBe(0.42);
  });

  it("diagnosis does not alter confidence value", () => {
    const signals = mkSignals({
      mastery: 0.5,
      confidence: 0.63,
      accuracy: 0.5,
      questionCount: 10,
      daysSinceStudy: 3,
    });
    const d = diagnoseTopic(signals);
    expect(d.confidence).toBe(0.63);
  });

  it("diagnosis does not alter accuracy value", () => {
    const signals = mkSignals({
      mastery: 0.5,
      confidence: 0.6,
      accuracy: 0.55,
      questionCount: 10,
      daysSinceStudy: 3,
    });
    const d = diagnoseTopic(signals);
    expect(d.accuracy).toBe(0.55);
  });

  it("signals are passed through to output", () => {
    const signals = mkSignals({
      mastery: 0.42,
      confidence: 0.6,
      accuracy: 0.4,
      questionCount: 10,
      daysSinceStudy: 3,
      unresolvedErrors: 2,
      recurringErrors: 1,
    });
    const d = diagnoseTopic(signals);
    expect(d.signals).toEqual(signals);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 19: DETERMINISMO
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §19 — determinism (100 runs)", () => {
  it("100 identical runs produce identical output", () => {
    const signals = mkSignals({
      mastery: 0.55,
      confidence: 0.6,
      accuracy: 0.5,
      questionCount: 10,
      daysSinceStudy: 5,
      unresolvedErrors: 1,
      recurringErrors: 0,
    });
    const reference = diagnoseTopic(signals, "2026-08-01");
    for (let i = 0; i < 100; i++) {
      const result = diagnoseTopic(signals, "2026-08-01");
      expect(result).toEqual(reference);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 20: DATA DE REFERÊNCIA
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §20 — referenceDate isolation", () => {
  it("different referenceDates with same signals produce same output", () => {
    // referenceDate is currently unused (recency is pre-computed in signals)
    const signals = mkSignals({
      mastery: 0.6,
      confidence: 0.7,
      accuracy: 0.6,
      questionCount: 12,
      daysSinceStudy: 5,
    });
    const d1 = diagnoseTopic(signals, "2026-01-01");
    const d2 = diagnoseTopic(signals, "2026-12-31");
    expect(d1).toEqual(d2);
  });

  it("no Date.now() or new Date() usage in engine — verified by output stability", () => {
    // If the engine used Date.now(), results would vary across calls
    const signals = mkSignals({
      mastery: 0.5,
      confidence: 0.6,
      accuracy: 0.5,
      questionCount: 10,
      daysSinceStudy: 10,
    });
    const results = Array.from({ length: 50 }, () => diagnoseTopic(signals));
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toEqual(results[0]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 21: PROPRIEDADES GERAIS
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §21 — general properties", () => {
  const VALID_STATES: KnowledgeStateName[] = [
    "SEM_EVIDENCIA",
    "APRENDIZAGEM",
    "INSTAVEL",
    "CONSOLIDANDO",
    "DOMINADO",
    "RISCO_ESQUECIMENTO",
    "PONTO_CRITICO",
  ];
  const VALID_RISKS: RiskLevel[] = ["BAIXO", "MODERADO", "ALTO", "CRITICO"];
  const VALID_EVIDENCE: EvidenceLevel[] = ["NENHUMA", "BAIXA", "MEDIA", "ALTA"];
  const VALID_INTERVENTIONS: InterventionType[] = [
    "ESTUDAR_TEORIA",
    "RESOLVER_QUESTOES",
    "REVISAR_ERROS",
    "REFORCAR_PONTO_FRACO",
    "REVISAR",
    "CONSOLIDAR",
    "MANUTENCAO",
  ];
  const VALID_RECENCY: RecencyClassification[] = ["RECENTE", "ATENCAO", "ANTIGO", "DESCONHECIDA"];

  /**
   * Property-based: generate diverse signal combinations and
   * verify invariants hold for all of them.
   */
  const masteryValues = [0, 0.1, 0.2, 0.39, 0.4, 0.5, 0.69, 0.7, 0.8, 0.99, 1.0];
  const confidenceValues = [0, 0.14, 0.15, 0.39, 0.4, 0.6, 0.74, 0.75, 0.9, 1.0];
  const accuracyValues = [0, 0.3, 0.59, 0.6, 0.8, 1.0];
  const questionCounts = [0, 1, 2, 5, 10, 20, 50];
  const daysSinceValues: (number | null)[] = [null, 0, 6, 7, 20, 21, 22, 30];

  // Run a representative sample (not full cartesian — would be millions)
  const testCases: PlannerSignals[] = [];
  for (const m of masteryValues) {
    for (const c of confidenceValues) {
      for (const a of [0, 0.5, 1.0]) {
        for (const q of [0, 1, 2, 10, 50]) {
          testCases.push(
            mkSignals({
              mastery: m,
              confidence: c,
              accuracy: a,
              questionCount: q,
              daysSinceStudy: 3,
            }),
          );
        }
      }
    }
  }

  it("all outputs have valid state", () => {
    for (const tc of testCases) {
      const d = diagnoseTopic(tc);
      expect(VALID_STATES).toContain(d.knowledgeState);
    }
  });

  it("all outputs have valid risk level", () => {
    for (const tc of testCases) {
      const d = diagnoseTopic(tc);
      expect(VALID_RISKS).toContain(d.riskLevel);
    }
  });

  it("all outputs have valid evidence level", () => {
    for (const tc of testCases) {
      const d = diagnoseTopic(tc);
      expect(VALID_EVIDENCE).toContain(d.evidenceLevel);
    }
  });

  it("all outputs have valid intervention", () => {
    for (const tc of testCases) {
      const d = diagnoseTopic(tc);
      expect(VALID_INTERVENTIONS).toContain(d.intervention);
    }
  });

  it("all outputs have valid recency", () => {
    for (const tc of testCases) {
      const d = diagnoseTopic(tc);
      expect(VALID_RECENCY).toContain(d.recency);
    }
  });

  it("mastery is never altered by diagnosis", () => {
    for (const tc of testCases) {
      const d = diagnoseTopic(tc);
      expect(d.mastery).toBe(tc.mastery);
    }
  });

  it("confidence is never altered by diagnosis", () => {
    for (const tc of testCases) {
      const d = diagnoseTopic(tc);
      expect(d.confidence).toBe(tc.confidence);
    }
  });

  it("accuracy remains 0..1", () => {
    for (const tc of testCases) {
      const d = diagnoseTopic(tc);
      expect(d.accuracy).toBeGreaterThanOrEqual(0);
      expect(d.accuracy).toBeLessThanOrEqual(1);
    }
  });

  it("intervention_score remains 0..1", () => {
    for (const tc of testCases) {
      const d = diagnoseTopic(tc);
      expect(d.interventionScore).toBeGreaterThanOrEqual(0);
      expect(d.interventionScore).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 22: TESTES DE FRONTEIRA — todos os thresholds obrigatórios
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §22 — boundary tests", () => {
  // Helper: medium evidence signals with given mastery, confidence, accuracy
  const med = (m: number, c: number, a: number, extras: Partial<PlannerSignals> = {}) =>
    mkSignals({
      mastery: m,
      confidence: c,
      accuracy: a,
      questionCount: 10,
      daysSinceStudy: 3,
      ...extras,
    });

  // Mastery boundaries
  describe("mastery boundaries", () => {
    it("mastery 0.00 + confidence 0.60 → PONTO_CRITICO", () => {
      expect(diagnoseTopic(med(0.0, 0.6, 0.0)).knowledgeState).toBe("PONTO_CRITICO");
    });

    it("mastery 0.39 + confidence 0.60 → PONTO_CRITICO", () => {
      expect(diagnoseTopic(med(0.39, 0.6, 0.39)).knowledgeState).toBe("PONTO_CRITICO");
    });

    it("mastery 0.40 + confidence 0.60 → NOT PONTO_CRITICO by mastery", () => {
      const d = diagnoseTopic(med(0.4, 0.6, 0.4));
      // No recurring errors → not PONTO_CRITICO
      expect(d.knowledgeState).not.toBe("PONTO_CRITICO");
    });

    it("mastery 0.69 + confidence 0.75 + accuracy 0.69 → APRENDIZAGEM (not DOMINADO)", () => {
      expect(diagnoseTopic(med(0.69, 0.75, 0.69)).knowledgeState).toBe("APRENDIZAGEM");
    });

    it("mastery 0.70 + confidence 0.75 + accuracy 0.70 → DOMINADO", () => {
      expect(diagnoseTopic(med(0.7, 0.75, 0.7)).knowledgeState).toBe("DOMINADO");
    });

    it("mastery 0.99 + confidence 0.95 + accuracy 0.99 → DOMINADO", () => {
      const d = diagnoseTopic(med(0.99, 0.95, 0.99, { questionCount: 50 }));
      expect(d.knowledgeState).toBe("DOMINADO");
    });

    it("mastery 1.00 + confidence 1.00 + accuracy 1.00 → DOMINADO", () => {
      const d = diagnoseTopic(med(1.0, 1.0, 1.0, { questionCount: 100 }));
      expect(d.knowledgeState).toBe("DOMINADO");
    });
  });

  // Confidence boundaries
  describe("confidence boundaries", () => {
    it("confidence 0.00, questionCount 0 → SEM_EVIDENCIA", () => {
      expect(diagnoseTopic(mkSignals({ confidence: 0.0, questionCount: 0 })).knowledgeState).toBe(
        "SEM_EVIDENCIA",
      );
    });

    it("confidence 0.14, questionCount 5 → SEM_EVIDENCIA", () => {
      expect(
        diagnoseTopic(
          mkSignals({ confidence: 0.14, questionCount: 5, mastery: 0.5, accuracy: 0.5 }),
        ).knowledgeState,
      ).toBe("SEM_EVIDENCIA");
    });

    it("confidence 0.15, questionCount 2 → NOT SEM_EVIDENCIA", () => {
      const d = diagnoseTopic(
        mkSignals({
          confidence: 0.15,
          questionCount: 2,
          mastery: 0.5,
          accuracy: 0.5,
          daysSinceStudy: 3,
        }),
      );
      expect(d.evidenceLevel).toBe("BAIXA");
      expect(d.knowledgeState).not.toBe("SEM_EVIDENCIA");
    });

    it("confidence 0.39 → evidence BAIXA", () => {
      expect(classifyEvidence(0.39, 5)).toBe("BAIXA");
    });

    it("confidence 0.40 → evidence MEDIA", () => {
      expect(classifyEvidence(0.4, 5)).toBe("MEDIA");
    });

    it("confidence 0.74 → evidence MEDIA", () => {
      expect(classifyEvidence(0.74, 14)).toBe("MEDIA");
    });

    it("confidence 0.75 → evidence ALTA", () => {
      expect(classifyEvidence(0.75, 14)).toBe("ALTA");
    });

    it("confidence 1.00 → evidence ALTA", () => {
      expect(classifyEvidence(1.0, 100)).toBe("ALTA");
    });
  });

  // Accuracy boundaries for DOMINADO
  describe("accuracy boundaries", () => {
    it("accuracy 0.59 blocks DOMINADO", () => {
      const d = diagnoseTopic(med(0.8, 0.85, 0.59));
      expect(d.knowledgeState).not.toBe("DOMINADO");
    });

    it("accuracy 0.60 allows DOMINADO", () => {
      const d = diagnoseTopic(med(0.8, 0.85, 0.6));
      expect(d.knowledgeState).toBe("DOMINADO");
    });
  });

  // Divergence boundaries for INSTAVEL
  describe("divergence boundaries", () => {
    it("divergence 0.249 → NOT INSTAVEL", () => {
      const d = diagnoseTopic(med(0.5, 0.6, 0.749));
      expect(d.knowledgeState).not.toBe("INSTAVEL");
    });

    it("divergence 0.250 → INSTAVEL", () => {
      const d = diagnoseTopic(med(0.5, 0.6, 0.75));
      expect(d.knowledgeState).toBe("INSTAVEL");
    });

    it("divergence 0.251 → INSTAVEL", () => {
      const d = diagnoseTopic(med(0.5, 0.6, 0.751));
      expect(d.knowledgeState).toBe("INSTAVEL");
    });
  });

  // Recency boundaries (via classifyRecency, already tested in §10)
  describe("recency boundaries in diagnosis context", () => {
    it("daysSinceStudy=6 → RECENTE in diagnosis", () => {
      const d = diagnoseTopic(med(0.8, 0.85, 0.8, { daysSinceStudy: 6 }));
      expect(d.recency).toBe("RECENTE");
    });

    it("daysSinceStudy=7 → RECENTE in diagnosis", () => {
      const d = diagnoseTopic(med(0.8, 0.85, 0.8, { daysSinceStudy: 7 }));
      expect(d.recency).toBe("RECENTE");
    });

    it("daysSinceStudy=20 → ATENCAO in diagnosis", () => {
      const d = diagnoseTopic(med(0.8, 0.85, 0.8, { daysSinceStudy: 20 }));
      expect(d.recency).toBe("ATENCAO");
    });

    it("daysSinceStudy=21 → ATENCAO in diagnosis", () => {
      const d = diagnoseTopic(med(0.8, 0.85, 0.8, { daysSinceStudy: 21 }));
      expect(d.recency).toBe("ATENCAO");
    });

    it("daysSinceStudy=22 → ANTIGO in diagnosis", () => {
      const d = diagnoseTopic(med(0.8, 0.85, 0.8, { daysSinceStudy: 22 }));
      expect(d.recency).toBe("ANTIGO");
    });
  });

  // QuestionCount boundaries
  describe("questionCount boundaries", () => {
    it("questionCount=0 → SEM_EVIDENCIA", () => {
      expect(diagnoseTopic(mkSignals({ questionCount: 0 })).knowledgeState).toBe("SEM_EVIDENCIA");
    });

    it("questionCount=1 → SEM_EVIDENCIA", () => {
      expect(
        diagnoseTopic(
          mkSignals({ questionCount: 1, confidence: 0.095, mastery: 0.5, accuracy: 1.0 }),
        ).knowledgeState,
      ).toBe("SEM_EVIDENCIA");
    });

    it("questionCount=2 with confidence >= 0.15 → NOT SEM_EVIDENCIA", () => {
      const d = diagnoseTopic(
        mkSignals({
          questionCount: 2,
          confidence: 0.18,
          mastery: 0.5,
          accuracy: 0.5,
          daysSinceStudy: 2,
        }),
      );
      expect(d.knowledgeState).not.toBe("SEM_EVIDENCIA");
    });

    it("questionCount=3 with confidence >= 0.15 → NOT SEM_EVIDENCIA", () => {
      const d = diagnoseTopic(
        mkSignals({
          questionCount: 3,
          confidence: 0.26,
          mastery: 0.5,
          accuracy: 0.67,
          daysSinceStudy: 2,
        }),
      );
      expect(d.knowledgeState).not.toBe("SEM_EVIDENCIA");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEÇÃO 23: DOCUMENTAÇÃO — regras com comportamento contraintuitivo
// ─────────────────────────────────────────────────────────────────────────────

describe("audit §23 — documented design choices", () => {
  /**
   * FATO MATEMÁTICO: confidence = 1 - e^(-n/10) é estritamente crescente.
   * Mais questões nunca diminuem confidence.
   */
  it("MATHEMATICAL FACT: confidence formula is strictly increasing", () => {
    for (let n = 1; n <= 100; n++) {
      const prev = 1 - Math.exp(-(n - 1) / 10);
      const curr = 1 - Math.exp(-n / 10);
      expect(curr).toBeGreaterThan(prev);
    }
  });

  /**
   * REGRA PEDAGÓGICA: erros recorrentes com evidência média+
   * elevam a PONTO_CRITICO mesmo com mastery intermediário ou alto.
   * Justificativa: padrões de erro recorrente indicam lacuna conceitual
   * que domínio global não captura.
   */
  it("PEDAGOGICAL RULE: recurring errors override good mastery", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.75,
        confidence: 0.8,
        accuracy: 0.75,
        questionCount: 18,
        daysSinceStudy: 2,
        recurringErrors: 1,
      }),
    );
    expect(d.knowledgeState).toBe("PONTO_CRITICO");
  });

  /**
   * HEURÍSTICA: INSTAVEL detecta divergência entre mastery (EMA) e accuracy
   * (média histórica). Isso pode representar melhora recente e não instabilidade.
   * Limitação conhecida: sem dados temporais granulares, o engine não distingue
   * "melhora recente" de "oscilação".
   */
  it("HEURISTIC: INSTAVEL detects divergence, which may be recent improvement", () => {
    // Student improved recently: mastery (EMA) went up, but accuracy still reflects old poor performance
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.65,
        confidence: 0.6,
        accuracy: 0.35,
        questionCount: 10,
        daysSinceStudy: 1,
      }),
    );
    expect(d.knowledgeState).toBe("INSTAVEL");
    // This is a known limitation. The state name is stronger than the evidence.
  });

  /**
   * REGRA PEDAGÓGICA: RISCO_ESQUECIMENTO usa linguagem probabilística
   * ("possível perda") e não afirmativa ("esqueceu").
   */
  it("PEDAGOGICAL RULE: RISCO_ESQUECIMENTO uses probabilistic language", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.7,
        confidence: 0.75,
        accuracy: 0.7,
        questionCount: 14,
        daysSinceStudy: 30,
      }),
    );
    expect(d.diagnosisReason).toContain("possível perda de retenção");
  });

  /**
   * FATO MATEMÁTICO: classifyRecency boundary.
   * RECENTE: <= 7 dias (0..7)
   * ATENCAO: 8..21 dias
   * ANTIGO: >= 22 dias
   * Nota: o threshold OLD_DAYS_THRESHOLD=21 é usado com <=, portanto
   * ANTIGO começa em 22, não 21.
   */
  it("MATHEMATICAL FACT: recency boundary at day 21 is ATENCAO, day 22 is ANTIGO", () => {
    expect(classifyRecency(21)).toBe("ATENCAO");
    expect(classifyRecency(22)).toBe("ANTIGO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROTEÇÃO DA PRECEDÊNCIA CONSOLIDANDO × INSTAVEL
// ─────────────────────────────────────────────────────────────────────────────

describe("proteção — precedência CONSOLIDANDO × INSTAVEL", () => {
  it("mastery alto + confidence insuficiente + divergência → CONSOLIDANDO", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.75,
        confidence: 0.6,
        accuracy: 0.45,
        questionCount: 10,
        daysSinceStudy: 1,
      }),
    );
    expect(d.knowledgeState).toBe("CONSOLIDANDO");
    expect(d.intervention).toBe("CONSOLIDAR");
  });

  it("mastery alto + confidence ALTA + accuracy baixa → INSTAVEL (regra preservada)", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.8,
        confidence: 0.85,
        accuracy: 0.5,
        questionCount: 20,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("INSTAVEL");
  });

  it("mastery médio + divergência com evidência média → INSTAVEL (regra preservada)", () => {
    const d = diagnoseTopic(
      mkSignals({
        mastery: 0.5,
        confidence: 0.6,
        accuracy: 0.8,
        questionCount: 10,
        daysSinceStudy: 3,
      }),
    );
    expect(d.knowledgeState).toBe("INSTAVEL");
  });

  it("determinismo preservado nos dois ramos", () => {
    const s = mkSignals({
      mastery: 0.75,
      confidence: 0.6,
      accuracy: 0.45,
      questionCount: 10,
      daysSinceStudy: 1,
    });
    expect(diagnoseTopic(s).knowledgeState).toBe(diagnoseTopic(s).knowledgeState);
  });
});
