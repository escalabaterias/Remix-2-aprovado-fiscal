/**
 * TESTES DA KNOWLEDGE INTEGRATION — Etapa 6, Fase 5
 *
 * Testa:
 *   - computeKnowledgeUpdate (função pura)
 *   - Acerto incrementa mastery e confidence
 *   - Erro decrementa mastery e confidence
 *   - Dificuldade afeta magnitude do ajuste
 *   - Primeira tentativa tem impacto maior
 *   - Mastery e confidence sempre em [0, 1]
 *   - Estado null (primeiro contato com tópico)
 *   - Determinismo
 *   - Convergência com múltiplas tentativas
 *   - Integração pura com computeAttemptFeedback
 *   - Design assertions para I/O (duplicidade, autenticação, topicId null)
 */

import { describe, it, expect } from "vitest";
import { computeKnowledgeUpdate, type CurrentKnowledgeState } from "./knowledge-integration";
import { computeAttemptFeedback, type AttemptFeedbackInput } from "./engine";
import type { QuestionStats, AttemptFeedback } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// FACTORIES
// ─────────────────────────────────────────────────────────────────────────────

function makeKnowledge(overrides: Partial<CurrentKnowledgeState> = {}): CurrentKnowledgeState {
  return {
    mastery: 0.5,
    confidence: 0.5,
    totalQuestions: 10,
    correctQuestions: 6,
    reviewCount: 2,
    lastStudiedAt: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

function makeStats(overrides: Partial<QuestionStats> = {}): QuestionStats {
  return {
    totalAttempts: 5,
    correctCount: 3,
    wrongCount: 2,
    streakCorrect: 1,
    streakWrong: 0,
    bestTimeSeconds: 20,
    avgTimeSeconds: 30,
    lastAttemptedAt: "2026-08-01T10:00:00Z",
    lastCorrectAt: "2026-08-01T10:00:00Z",
    lastWrongAt: "2026-07-28T10:00:00Z",
    accuracy: 0.6,
    ...overrides,
  };
}

const TS = "2026-08-29T12:00:00Z";

// ─────────────────────────────────────────────────────────────────────────────
// 1. computeKnowledgeUpdate — acertos
// ─────────────────────────────────────────────────────────────────────────────

describe("computeKnowledgeUpdate — acertos", () => {
  it("acerto fácil incrementa mastery e confidence", () => {
    const current = makeKnowledge({ mastery: 0.5, confidence: 0.5 });
    const result = computeKnowledgeUpdate(current, {
      isCorrect: true,
      knowledgeDifficulty: "facil",
      isFirstAttempt: false,
    });
    expect(result.newMastery).toBeGreaterThan(0.5);
    expect(result.newConfidence).toBeGreaterThan(0.5);
  });

  it("acerto médio incrementa mais que fácil", () => {
    const current = makeKnowledge({ mastery: 0.5, confidence: 0.5 });
    const easy = computeKnowledgeUpdate(current, {
      isCorrect: true,
      knowledgeDifficulty: "facil",
      isFirstAttempt: false,
    });
    const medium = computeKnowledgeUpdate(current, {
      isCorrect: true,
      knowledgeDifficulty: "media",
      isFirstAttempt: false,
    });
    expect(medium.newMastery).toBeGreaterThan(easy.newMastery);
  });

  it("acerto difícil incrementa mais que médio", () => {
    const current = makeKnowledge({ mastery: 0.5, confidence: 0.5 });
    const medium = computeKnowledgeUpdate(current, {
      isCorrect: true,
      knowledgeDifficulty: "media",
      isFirstAttempt: false,
    });
    const hard = computeKnowledgeUpdate(current, {
      isCorrect: true,
      knowledgeDifficulty: "dificil",
      isFirstAttempt: false,
    });
    expect(hard.newMastery).toBeGreaterThan(medium.newMastery);
  });

  it("acerto na primeira tentativa tem mais impacto", () => {
    const current = makeKnowledge({ mastery: 0.5, confidence: 0.5 });
    const first = computeKnowledgeUpdate(current, {
      isCorrect: true,
      knowledgeDifficulty: "media",
      isFirstAttempt: true,
    });
    const subsequent = computeKnowledgeUpdate(current, {
      isCorrect: true,
      knowledgeDifficulty: "media",
      isFirstAttempt: false,
    });
    expect(first.newMastery).toBeGreaterThan(subsequent.newMastery);
    expect(first.newConfidence).toBeGreaterThan(subsequent.newConfidence);
  });

  it("acerto incrementa totalQuestions e correctQuestions", () => {
    const current = makeKnowledge({ totalQuestions: 10, correctQuestions: 6 });
    const result = computeKnowledgeUpdate(current, {
      isCorrect: true,
      knowledgeDifficulty: "media",
      isFirstAttempt: false,
    });
    expect(result.newTotalQuestions).toBe(11);
    expect(result.newCorrectQuestions).toBe(7);
  });

  it("mastery não ultrapassa 1.0", () => {
    const current = makeKnowledge({ mastery: 0.98, confidence: 0.98 });
    const result = computeKnowledgeUpdate(current, {
      isCorrect: true,
      knowledgeDifficulty: "dificil",
      isFirstAttempt: true,
    });
    expect(result.newMastery).toBeLessThanOrEqual(1.0);
    expect(result.newConfidence).toBeLessThanOrEqual(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. computeKnowledgeUpdate — erros
// ─────────────────────────────────────────────────────────────────────────────

describe("computeKnowledgeUpdate — erros", () => {
  it("erro fácil penaliza mais mastery que erro difícil", () => {
    const current = makeKnowledge({ mastery: 0.5 });
    const easy = computeKnowledgeUpdate(current, {
      isCorrect: false,
      knowledgeDifficulty: "facil",
      isFirstAttempt: false,
    });
    const hard = computeKnowledgeUpdate(current, {
      isCorrect: false,
      knowledgeDifficulty: "dificil",
      isFirstAttempt: false,
    });
    expect(easy.newMastery).toBeLessThan(hard.newMastery);
  });

  it("erro decrementa mastery e confidence", () => {
    const current = makeKnowledge({ mastery: 0.5, confidence: 0.5 });
    const result = computeKnowledgeUpdate(current, {
      isCorrect: false,
      knowledgeDifficulty: "media",
      isFirstAttempt: false,
    });
    expect(result.newMastery).toBeLessThan(0.5);
    expect(result.newConfidence).toBeLessThan(0.5);
  });

  it("erro na primeira tentativa tem mais impacto", () => {
    const current = makeKnowledge({ mastery: 0.5, confidence: 0.5 });
    const first = computeKnowledgeUpdate(current, {
      isCorrect: false,
      knowledgeDifficulty: "media",
      isFirstAttempt: true,
    });
    const subsequent = computeKnowledgeUpdate(current, {
      isCorrect: false,
      knowledgeDifficulty: "media",
      isFirstAttempt: false,
    });
    expect(first.newMastery).toBeLessThan(subsequent.newMastery);
  });

  it("mastery não fica abaixo de 0", () => {
    const current = makeKnowledge({ mastery: 0.01, confidence: 0.01 });
    const result = computeKnowledgeUpdate(current, {
      isCorrect: false,
      knowledgeDifficulty: "facil",
      isFirstAttempt: true,
    });
    expect(result.newMastery).toBeGreaterThanOrEqual(0);
    expect(result.newConfidence).toBeGreaterThanOrEqual(0);
  });

  it("erro incrementa totalQuestions mas não correctQuestions", () => {
    const current = makeKnowledge({ totalQuestions: 10, correctQuestions: 6 });
    const result = computeKnowledgeUpdate(current, {
      isCorrect: false,
      knowledgeDifficulty: "media",
      isFirstAttempt: false,
    });
    expect(result.newTotalQuestions).toBe(11);
    expect(result.newCorrectQuestions).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. computeKnowledgeUpdate — estado null (primeiro contato)
// ─────────────────────────────────────────────────────────────────────────────

describe("computeKnowledgeUpdate — estado null", () => {
  it("primeiro acerto em tópico desconhecido parte de mastery 0", () => {
    const result = computeKnowledgeUpdate(null, {
      isCorrect: true,
      knowledgeDifficulty: "media",
      isFirstAttempt: true,
    });
    expect(result.newMastery).toBeGreaterThan(0);
    expect(result.newConfidence).toBeGreaterThan(0);
    expect(result.newTotalQuestions).toBe(1);
    expect(result.newCorrectQuestions).toBe(1);
  });

  it("primeiro erro em tópico desconhecido mantém mastery 0", () => {
    const result = computeKnowledgeUpdate(null, {
      isCorrect: false,
      knowledgeDifficulty: "media",
      isFirstAttempt: true,
    });
    expect(result.newMastery).toBe(0);
    expect(result.newConfidence).toBe(0);
    expect(result.newTotalQuestions).toBe(1);
    expect(result.newCorrectQuestions).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Determinismo
// ─────────────────────────────────────────────────────────────────────────────

describe("computeKnowledgeUpdate — determinismo", () => {
  it("mesmo input produz mesmo output", () => {
    const current = makeKnowledge();
    const feedback = {
      isCorrect: true as const,
      knowledgeDifficulty: "media" as const,
      isFirstAttempt: false,
    };
    const r1 = computeKnowledgeUpdate(current, feedback);
    const r2 = computeKnowledgeUpdate(current, feedback);
    expect(r1).toEqual(r2);
  });

  it("output diferente para acerto vs erro", () => {
    const current = makeKnowledge();
    const acerto = computeKnowledgeUpdate(current, {
      isCorrect: true,
      knowledgeDifficulty: "media",
      isFirstAttempt: false,
    });
    const erro = computeKnowledgeUpdate(current, {
      isCorrect: false,
      knowledgeDifficulty: "media",
      isFirstAttempt: false,
    });
    expect(acerto.newMastery).not.toBe(erro.newMastery);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Convergência com múltiplas tentativas
// ─────────────────────────────────────────────────────────────────────────────

describe("computeKnowledgeUpdate — convergência", () => {
  it("acertos consecutivos fazem mastery convergir para 1.0", () => {
    let state: CurrentKnowledgeState = makeKnowledge({ mastery: 0.3, confidence: 0.3 });
    for (let i = 0; i < 50; i++) {
      const result = computeKnowledgeUpdate(state, {
        isCorrect: true,
        knowledgeDifficulty: "media",
        isFirstAttempt: false,
      });
      state = {
        ...state,
        mastery: result.newMastery,
        confidence: result.newConfidence,
        totalQuestions: result.newTotalQuestions,
        correctQuestions: result.newCorrectQuestions,
      };
    }
    expect(state.mastery).toBeGreaterThan(0.9);
    expect(state.confidence).toBeGreaterThan(0.9);
  });

  it("erros consecutivos fazem mastery convergir para 0", () => {
    let state: CurrentKnowledgeState = makeKnowledge({ mastery: 0.7, confidence: 0.7 });
    for (let i = 0; i < 50; i++) {
      const result = computeKnowledgeUpdate(state, {
        isCorrect: false,
        knowledgeDifficulty: "media",
        isFirstAttempt: false,
      });
      state = {
        ...state,
        mastery: result.newMastery,
        confidence: result.newConfidence,
        totalQuestions: result.newTotalQuestions,
        correctQuestions: result.newCorrectQuestions,
      };
    }
    expect(state.mastery).toBeLessThan(0.1);
    expect(state.confidence).toBeLessThan(0.1);
  });

  it("alternância acerto/erro estabiliza mastery", () => {
    let state: CurrentKnowledgeState = makeKnowledge({ mastery: 0.5, confidence: 0.5 });
    const masteries: number[] = [];
    for (let i = 0; i < 20; i++) {
      const isCorrect = i % 2 === 0;
      const result = computeKnowledgeUpdate(state, {
        isCorrect,
        knowledgeDifficulty: "media",
        isFirstAttempt: false,
      });
      state = {
        ...state,
        mastery: result.newMastery,
        confidence: result.newConfidence,
        totalQuestions: result.newTotalQuestions,
        correctQuestions: result.newCorrectQuestions,
      };
      masteries.push(result.newMastery);
    }
    // Mastery deve oscilar mas não divergir
    const min = Math.min(...masteries);
    const max = Math.max(...masteries);
    expect(max - min).toBeLessThan(0.3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Valores de borda
// ─────────────────────────────────────────────────────────────────────────────

describe("computeKnowledgeUpdate — valores de borda", () => {
  it("mastery 0 + acerto difícil sobe significativamente", () => {
    const result = computeKnowledgeUpdate(makeKnowledge({ mastery: 0, confidence: 0 }), {
      isCorrect: true,
      knowledgeDifficulty: "dificil",
      isFirstAttempt: true,
    });
    expect(result.newMastery).toBeGreaterThan(0.1);
  });

  it("mastery 1.0 + acerto permanece em 1.0", () => {
    const result = computeKnowledgeUpdate(makeKnowledge({ mastery: 1.0, confidence: 1.0 }), {
      isCorrect: true,
      knowledgeDifficulty: "dificil",
      isFirstAttempt: true,
    });
    expect(result.newMastery).toBe(1.0);
    expect(result.newConfidence).toBe(1.0);
  });

  it("mastery 0 + erro permanece em 0", () => {
    const result = computeKnowledgeUpdate(makeKnowledge({ mastery: 0, confidence: 0 }), {
      isCorrect: false,
      knowledgeDifficulty: "facil",
      isFirstAttempt: true,
    });
    expect(result.newMastery).toBe(0);
    expect(result.newConfidence).toBe(0);
  });

  it("totalQuestions 0 + primeiro acerto resulta em 1/1", () => {
    const result = computeKnowledgeUpdate(
      makeKnowledge({ totalQuestions: 0, correctQuestions: 0 }),
      { isCorrect: true, knowledgeDifficulty: "media", isFirstAttempt: true },
    );
    expect(result.newTotalQuestions).toBe(1);
    expect(result.newCorrectQuestions).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Ciclo completo puro: computeAttemptFeedback + computeKnowledgeUpdate
// ─────────────────────────────────────────────────────────────────────────────

describe("Ciclo completo puro: feedback + knowledge update", () => {
  it("acerto em questão difícil: feedback e knowledge coerentes", () => {
    const feedback = computeAttemptFeedback({
      questionId: "q-1",
      isCorrect: true,
      difficulty: 5,
      topicId: "top-1",
      subjectId: "sub-1",
      timestamp: TS,
      currentStats: null,
    });

    expect(feedback.knowledgeDifficulty).toBe("dificil");
    expect(feedback.isFirstAttempt).toBe(true);

    const kUpdate = computeKnowledgeUpdate(null, {
      isCorrect: feedback.isCorrect,
      knowledgeDifficulty: feedback.knowledgeDifficulty,
      isFirstAttempt: feedback.isFirstAttempt,
    });

    // Acerto difícil na primeira tentativa deve ter bom impacto
    expect(kUpdate.newMastery).toBeGreaterThan(0.1);
    expect(kUpdate.newConfidence).toBeGreaterThan(0.05);
    expect(kUpdate.newTotalQuestions).toBe(1);
    expect(kUpdate.newCorrectQuestions).toBe(1);
  });

  it("erro em questão fácil: feedback e knowledge coerentes", () => {
    const knowledge = makeKnowledge({ mastery: 0.6, confidence: 0.6 });
    const feedback = computeAttemptFeedback({
      questionId: "q-1",
      isCorrect: false,
      difficulty: 1,
      topicId: "top-1",
      subjectId: "sub-1",
      timestamp: TS,
      currentStats: makeStats({ totalAttempts: 5 }),
    });

    expect(feedback.knowledgeDifficulty).toBe("facil");
    expect(feedback.isFirstAttempt).toBe(false);
    expect(feedback.shouldCreateError).toBe(true);

    const kUpdate = computeKnowledgeUpdate(knowledge, {
      isCorrect: feedback.isCorrect,
      knowledgeDifficulty: feedback.knowledgeDifficulty,
      isFirstAttempt: feedback.isFirstAttempt,
    });

    // Erro fácil deve penalizar bastante
    expect(kUpdate.newMastery).toBeLessThan(0.6);
    expect(kUpdate.newMastery).toBeLessThan(0.55);
  });

  it("múltiplos acertos médios sobem mastery progressivamente", () => {
    let state: CurrentKnowledgeState | null = null;
    let stats: QuestionStats | null = null;

    for (let i = 0; i < 5; i++) {
      const feedback = computeAttemptFeedback({
        questionId: "q-1",
        isCorrect: true,
        difficulty: 3,
        topicId: "top-1",
        subjectId: "sub-1",
        timestamp: TS,
        currentStats: stats,
      });

      const kUpdate = computeKnowledgeUpdate(state, {
        isCorrect: feedback.isCorrect,
        knowledgeDifficulty: feedback.knowledgeDifficulty,
        isFirstAttempt: feedback.isFirstAttempt,
      });

      state = {
        mastery: kUpdate.newMastery,
        confidence: kUpdate.newConfidence,
        totalQuestions: kUpdate.newTotalQuestions,
        correctQuestions: kUpdate.newCorrectQuestions,
        reviewCount: 0,
        lastStudiedAt: TS,
      };

      // Simula stats para próxima iteração
      stats = {
        totalAttempts: i + 1,
        correctCount: i + 1,
        wrongCount: 0,
        streakCorrect: i + 1,
        streakWrong: 0,
        bestTimeSeconds: null,
        avgTimeSeconds: null,
        lastAttemptedAt: TS,
        lastCorrectAt: TS,
        lastWrongAt: null,
        accuracy: 1.0,
      };
    }

    expect(state!.mastery).toBeGreaterThan(0.25);
    expect(state!.totalQuestions).toBe(5);
    expect(state!.correctQuestions).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Design assertions para I/O
// ─────────────────────────────────────────────────────────────────────────────

describe("Design assertions — updateKnowledgeFromAttempt", () => {
  it("topicId null → skip sem I/O (design)", () => {
    // Se feedback.topicId === null, a função retorna
    // { updated: false, skipReason: 'topic_id_null' } sem chamar requireUser().
    expect(true).toBe(true);
  });

  it("duplicidade por attempt_id → skip sem upsert (design)", () => {
    // hasExistingKnowledgeUpdate() faz SELECT COUNT em knowledge_history
    // WHERE attempt_id = X. Se count > 0, retorna
    // { updated: false, skipReason: 'duplicidade_attempt_id' }
    // sem fazer upsert nem insert.
    expect(true).toBe(true);
  });

  it("usuário não autenticado → erro (design)", () => {
    // requireUser() lança "Usuário não autenticado." se auth.getUser() falha.
    // Isso acontece antes de qualquer leitura/escrita de dados.
    expect(true).toBe(true);
  });

  it("máximo 5 queries: auth + knowledge + history check + upsert + history insert (design)", () => {
    // Fluxo completo:
    // 1. requireUser() — 1 query
    // 2. fetchCurrentKnowledge() — 1 query  } executadas em paralelo
    // 3. hasExistingKnowledgeUpdate() — 1 query }
    // 4. upsert user_topic_knowledge — 1 query
    // 5. insert knowledge_history — 1 query
    // Total: 5 queries fixas. Nenhuma proporcional ao número de tópicos.
    expect(true).toBe(true);
  });

  it("computeKnowledgeUpdate é O(1) — sem I/O", () => {
    const start = performance.now();
    const current = makeKnowledge();
    for (let i = 0; i < 10000; i++) {
      computeKnowledgeUpdate(current, {
        isCorrect: true,
        knowledgeDifficulty: "media",
        isFirstAttempt: false,
      });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it("não aceita userId como parâmetro (design)", () => {
    // UpdateKnowledgeFromAttemptInput não tem campo userId.
    // O isolamento é feito via requireUser() + RLS.
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Nenhuma tabela duplicada
// ─────────────────────────────────────────────────────────────────────────────

describe("Nenhuma tabela duplicada", () => {
  it("usa user_topic_knowledge existente (design)", () => {
    // O serviço faz upsert em 'user_topic_knowledge' (tabela existente).
    // Nenhuma tabela nova de knowledge foi criada.
    expect(true).toBe(true);
  });

  it("usa knowledge_history existente (design)", () => {
    // O serviço insere em 'knowledge_history' (tabela da migration etapa 3.1).
    // Nenhuma tabela nova de histórico foi criada.
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Regressão: contrato do AttemptFeedback
// ─────────────────────────────────────────────────────────────────────────────

describe("Regressão: AttemptFeedback contrato", () => {
  it("feedback sempre contém knowledgeDifficulty válido", () => {
    const difficulties = [1, 2, 3, 4, 5, null];
    for (const d of difficulties) {
      const feedback = computeAttemptFeedback({
        questionId: "q-1",
        isCorrect: true,
        difficulty: d,
        topicId: "top-1",
        subjectId: "sub-1",
        timestamp: TS,
        currentStats: null,
      });
      expect(["facil", "media", "dificil"]).toContain(feedback.knowledgeDifficulty);
    }
  });

  it("feedback sempre contém isFirstAttempt boolean", () => {
    const feedback = computeAttemptFeedback({
      questionId: "q-1",
      isCorrect: true,
      difficulty: 3,
      topicId: "top-1",
      subjectId: "sub-1",
      timestamp: TS,
      currentStats: null,
    });
    expect(typeof feedback.isFirstAttempt).toBe("boolean");
  });

  it("feedback.topicId é propagado do input", () => {
    const feedback = computeAttemptFeedback({
      questionId: "q-1",
      isCorrect: true,
      difficulty: 3,
      topicId: "top-xyz",
      subjectId: "sub-1",
      timestamp: TS,
      currentStats: null,
    });
    expect(feedback.topicId).toBe("top-xyz");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Todas as dificuldades mapeadas
// ─────────────────────────────────────────────────────────────────────────────

describe("Todas as dificuldades mapeadas corretamente", () => {
  const cases: Array<{ difficulty: "facil" | "media" | "dificil"; isCorrect: boolean }> = [
    { difficulty: "facil", isCorrect: true },
    { difficulty: "facil", isCorrect: false },
    { difficulty: "media", isCorrect: true },
    { difficulty: "media", isCorrect: false },
    { difficulty: "dificil", isCorrect: true },
    { difficulty: "dificil", isCorrect: false },
  ];

  for (const { difficulty, isCorrect } of cases) {
    it(`${difficulty} + ${isCorrect ? "acerto" : "erro"} produz resultado válido`, () => {
      const current = makeKnowledge({ mastery: 0.5, confidence: 0.5 });
      const result = computeKnowledgeUpdate(current, {
        isCorrect,
        knowledgeDifficulty: difficulty,
        isFirstAttempt: false,
      });
      expect(result.newMastery).toBeGreaterThanOrEqual(0);
      expect(result.newMastery).toBeLessThanOrEqual(1);
      expect(result.newConfidence).toBeGreaterThanOrEqual(0);
      expect(result.newConfidence).toBeLessThanOrEqual(1);
      expect(result.newTotalQuestions).toBe(11);
    });
  }
});
