/**
 * TESTES DO MOTOR DO BANCO DE QUESTÕES — Etapa 6, Fase 1
 *
 * Cobertura completa das funções puras:
 *   - computeQuestionStats
 *   - filterQuestions
 *   - rankQuestionsForStudy
 *   - mapDifficultyToKnowledge
 *   - computeAttemptFeedback
 *   - computeBankSummary
 */

import { describe, it, expect } from "vitest";
import {
  computeQuestionStats,
  filterQuestions,
  rankQuestionsForStudy,
  mapDifficultyToKnowledge,
  computeAttemptFeedback,
  computeBankSummary,
  normalizeTrueFalseAnswer,
  type AttemptRecord,
  type AttemptFeedbackInput,
} from "./engine";
import type { QuestionBankItem, QuestionStats, QuestionFilter } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// FACTORIES
// ─────────────────────────────────────────────────────────────────────────────

function makeAttempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    attemptId: "att-1",
    questionId: "q-1",
    isCorrect: true,
    timeSpentSeconds: 30,
    answeredAt: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<QuestionBankItem> = {}): QuestionBankItem {
  return {
    questionId: "q-1",
    statement: "Qual é a capital do Brasil?",
    alternatives: ["A", "B", "C", "D"],
    correctAnswer: "A",
    isTrueFalse: false,
    examBoard: "CESPE",
    contestName: null,
    contestId: null,
    year: 2024,
    subjectId: "sub-1",
    topicId: "top-1",
    difficulty: 3,
    origin: "prova_oficial" as const,
    novelty: null,
    tags: [],
    explanation: null,
    isPublic: false,
    stats: null,
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

// ─────────────────────────────────────────────────────────────────────────────
// computeQuestionStats
// ─────────────────────────────────────────────────────────────────────────────

describe("computeQuestionStats", () => {
  it("retorna stats zeradas para array vazio", () => {
    const result = computeQuestionStats([]);
    expect(result.totalAttempts).toBe(0);
    expect(result.correctCount).toBe(0);
    expect(result.wrongCount).toBe(0);
    expect(result.accuracy).toBe(0);
    expect(result.lastAttemptedAt).toBeNull();
    expect(result.bestTimeSeconds).toBeNull();
    expect(result.avgTimeSeconds).toBeNull();
  });

  it("calcula stats corretas para uma tentativa", () => {
    const result = computeQuestionStats([makeAttempt({ isCorrect: true, timeSpentSeconds: 25 })]);
    expect(result.totalAttempts).toBe(1);
    expect(result.correctCount).toBe(1);
    expect(result.wrongCount).toBe(0);
    expect(result.accuracy).toBe(1);
    expect(result.streakCorrect).toBe(1);
    expect(result.streakWrong).toBe(0);
    expect(result.bestTimeSeconds).toBe(25);
    expect(result.avgTimeSeconds).toBe(25);
  });

  it("calcula stats para múltiplas tentativas com acertos e erros", () => {
    const result = computeQuestionStats([
      makeAttempt({
        attemptId: "a1",
        isCorrect: true,
        answeredAt: "2026-08-01T10:00:00Z",
        timeSpentSeconds: 30,
      }),
      makeAttempt({
        attemptId: "a2",
        isCorrect: false,
        answeredAt: "2026-08-02T10:00:00Z",
        timeSpentSeconds: 45,
      }),
      makeAttempt({
        attemptId: "a3",
        isCorrect: true,
        answeredAt: "2026-08-03T10:00:00Z",
        timeSpentSeconds: 20,
      }),
    ]);
    expect(result.totalAttempts).toBe(3);
    expect(result.correctCount).toBe(2);
    expect(result.wrongCount).toBe(1);
    expect(result.accuracy).toBeCloseTo(2 / 3, 4);
    expect(result.streakCorrect).toBe(1); // última é acerto
    expect(result.streakWrong).toBe(0);
    expect(result.bestTimeSeconds).toBe(20);
    expect(result.lastAttemptedAt).toBe("2026-08-03T10:00:00Z");
    expect(result.lastCorrectAt).toBe("2026-08-03T10:00:00Z");
    expect(result.lastWrongAt).toBe("2026-08-02T10:00:00Z");
  });

  it("calcula streak de erros consecutivos no final", () => {
    const result = computeQuestionStats([
      makeAttempt({ attemptId: "a1", isCorrect: true, answeredAt: "2026-08-01T10:00:00Z" }),
      makeAttempt({ attemptId: "a2", isCorrect: false, answeredAt: "2026-08-02T10:00:00Z" }),
      makeAttempt({ attemptId: "a3", isCorrect: false, answeredAt: "2026-08-03T10:00:00Z" }),
    ]);
    expect(result.streakCorrect).toBe(0);
    expect(result.streakWrong).toBe(2);
  });

  it("trata timeSpentSeconds null/0 corretamente", () => {
    const result = computeQuestionStats([
      makeAttempt({ attemptId: "a1", timeSpentSeconds: null }),
      makeAttempt({ attemptId: "a2", timeSpentSeconds: 0 }),
      makeAttempt({ attemptId: "a3", timeSpentSeconds: 40 }),
    ]);
    expect(result.bestTimeSeconds).toBe(40);
    expect(result.avgTimeSeconds).toBe(40); // só 1 valor válido
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// filterQuestions
// ─────────────────────────────────────────────────────────────────────────────

describe("filterQuestions", () => {
  const questions: QuestionBankItem[] = [
    makeQuestion({
      questionId: "q-1",
      subjectId: "sub-1",
      topicId: "top-1",
      examBoard: "CESPE",
      year: 2024,
      difficulty: 3,
      tags: ["constitucional"],
    }),
    makeQuestion({
      questionId: "q-2",
      subjectId: "sub-2",
      topicId: "top-2",
      examBoard: "FCC",
      year: 2022,
      difficulty: 5,
      tags: ["penal"],
      isTrueFalse: true,
    }),
    makeQuestion({
      questionId: "q-3",
      subjectId: "sub-1",
      topicId: "top-3",
      examBoard: "CESPE",
      year: 2020,
      difficulty: 1,
      tags: ["constitucional", "penal"],
      stats: makeStats(),
    }),
    makeQuestion({
      questionId: "q-4",
      subjectId: "sub-3",
      topicId: null,
      examBoard: null,
      year: null,
      difficulty: null,
      origin: "manual" as const,
    }),
  ];

  it("retorna tudo sem filtros", () => {
    expect(filterQuestions(questions, {})).toHaveLength(4);
  });

  it("filtra por subjectId", () => {
    const result = filterQuestions(questions, { subjectId: "sub-1" });
    expect(result).toHaveLength(2);
    expect(result.map((q) => q.questionId)).toEqual(["q-1", "q-3"]);
  });

  it("filtra por examBoard", () => {
    const result = filterQuestions(questions, { examBoard: "FCC" });
    expect(result).toHaveLength(1);
    expect(result[0]!.questionId).toBe("q-2");
  });

  it("filtra por yearMin e yearMax", () => {
    const result = filterQuestions(questions, { yearMin: 2022, yearMax: 2024 });
    expect(result).toHaveLength(2); // q-1 (2024) e q-2 (2022)
  });

  it("filtra por difficultyMin e difficultyMax", () => {
    const result = filterQuestions(questions, { difficultyMin: 3, difficultyMax: 5 });
    expect(result).toHaveLength(2); // q-1 (3) e q-2 (5)
  });

  it("filtra por tags (any match)", () => {
    const result = filterQuestions(questions, { tags: ["penal"] });
    expect(result).toHaveLength(2); // q-2 e q-3
  });

  it("filtra por isTrueFalse", () => {
    const result = filterQuestions(questions, { isTrueFalse: true });
    expect(result).toHaveLength(1);
    expect(result[0]!.questionId).toBe("q-2");
  });

  it("filtra por neverAttempted", () => {
    const result = filterQuestions(questions, { neverAttempted: true });
    expect(result).toHaveLength(3); // todos menos q-3 que tem stats
  });

  it("filtra por lastAttemptWrong", () => {
    const qWithWrong = makeQuestion({
      questionId: "q-5",
      stats: makeStats({ streakWrong: 2, streakCorrect: 0 }),
    });
    const all = [...questions, qWithWrong];
    const result = filterQuestions(all, { lastAttemptWrong: true });
    expect(result).toHaveLength(1);
    expect(result[0]!.questionId).toBe("q-5");
  });

  it("filtra por searchText", () => {
    const result = filterQuestions(questions, { searchText: "capital" });
    expect(result).toHaveLength(4); // todos têm "capital" no statement padrão
  });

  it("combina múltiplos filtros (AND)", () => {
    const result = filterQuestions(questions, {
      subjectId: "sub-1",
      examBoard: "CESPE",
      yearMin: 2024,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.questionId).toBe("q-1");
  });

  it("exclui questões com null em campo numérico quando min/max é definido", () => {
    // q-4 tem year=null, difficulty=null
    const result = filterQuestions(questions, { yearMin: 2000 });
    expect(result.find((q) => q.questionId === "q-4")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rankQuestionsForStudy
// ─────────────────────────────────────────────────────────────────────────────

describe("rankQuestionsForStudy", () => {
  const refDate = "2026-08-29";

  it("prioriza questões nunca tentadas", () => {
    const questions = [
      makeQuestion({
        questionId: "q-with-stats",
        stats: makeStats({ accuracy: 0.8, streakCorrect: 2, streakWrong: 0 }),
      }),
      makeQuestion({ questionId: "q-never", stats: null }),
    ];
    const result = rankQuestionsForStudy(questions, refDate);
    expect(result[0]!.questionId).toBe("q-never");
  });

  it("prioriza questões com última tentativa errada sobre acerto", () => {
    const questions = [
      makeQuestion({
        questionId: "q-acerto",
        stats: makeStats({ accuracy: 0.9, streakCorrect: 3, streakWrong: 0 }),
      }),
      makeQuestion({
        questionId: "q-erro",
        stats: makeStats({ accuracy: 0.4, streakCorrect: 0, streakWrong: 2 }),
      }),
    ];
    const result = rankQuestionsForStudy(questions, refDate);
    expect(result[0]!.questionId).toBe("q-erro");
  });

  it("é determinístico (desempate por questionId)", () => {
    const questions = [
      makeQuestion({ questionId: "q-b", stats: null }),
      makeQuestion({ questionId: "q-a", stats: null }),
    ];
    const result1 = rankQuestionsForStudy(questions, refDate);
    const result2 = rankQuestionsForStudy([...questions].reverse(), refDate);
    expect(result1.map((q) => q.questionId)).toEqual(result2.map((q) => q.questionId));
  });

  it("não muta o array original", () => {
    const questions = [makeQuestion({ questionId: "q-2" }), makeQuestion({ questionId: "q-1" })];
    const copy = [...questions];
    rankQuestionsForStudy(questions, refDate);
    expect(questions.map((q) => q.questionId)).toEqual(copy.map((q) => q.questionId));
  });

  it("dá bonus temporal para questões não tentadas há muito tempo", () => {
    const questions = [
      makeQuestion({
        questionId: "q-recente",
        stats: makeStats({
          accuracy: 0.5,
          streakCorrect: 0,
          streakWrong: 0,
          lastAttemptedAt: "2026-08-28T10:00:00Z",
        }),
      }),
      makeQuestion({
        questionId: "q-antiga",
        stats: makeStats({
          accuracy: 0.5,
          streakCorrect: 0,
          streakWrong: 0,
          lastAttemptedAt: "2026-06-01T10:00:00Z",
        }),
      }),
    ];
    const result = rankQuestionsForStudy(questions, refDate);
    expect(result[0]!.questionId).toBe("q-antiga");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapDifficultyToKnowledge
// ─────────────────────────────────────────────────────────────────────────────

describe("mapDifficultyToKnowledge", () => {
  it("mapeia 1 e 2 para facil", () => {
    expect(mapDifficultyToKnowledge(1)).toBe("facil");
    expect(mapDifficultyToKnowledge(2)).toBe("facil");
  });

  it("mapeia 3 para media", () => {
    expect(mapDifficultyToKnowledge(3)).toBe("media");
  });

  it("mapeia 4 e 5 para dificil", () => {
    expect(mapDifficultyToKnowledge(4)).toBe("dificil");
    expect(mapDifficultyToKnowledge(5)).toBe("dificil");
  });

  it("mapeia null para media", () => {
    expect(mapDifficultyToKnowledge(null)).toBe("media");
  });

  it("mapeia NaN para media", () => {
    expect(mapDifficultyToKnowledge(NaN)).toBe("media");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeAttemptFeedback
// ─────────────────────────────────────────────────────────────────────────────

describe("computeAttemptFeedback", () => {
  const baseInput: AttemptFeedbackInput = {
    questionId: "q-1",
    isCorrect: true,
    difficulty: 3,
    topicId: "top-1",
    subjectId: "sub-1",
    timestamp: "2026-08-29T10:00:00Z",
    currentStats: null,
  };

  it("marca primeira tentativa corretamente", () => {
    const result = computeAttemptFeedback(baseInput);
    expect(result.isFirstAttempt).toBe(true);
    expect(result.currentStreak).toBe(1);
    expect(result.shouldCreateError).toBe(false);
  });

  it("gera shouldCreateError quando errou com tópico", () => {
    const result = computeAttemptFeedback({ ...baseInput, isCorrect: false });
    expect(result.shouldCreateError).toBe(true);
    expect(result.currentStreak).toBe(-1);
  });

  it("não gera erro quando errou sem tópico", () => {
    const result = computeAttemptFeedback({ ...baseInput, isCorrect: false, topicId: null });
    expect(result.shouldCreateError).toBe(false);
  });

  it("mapeia dificuldade corretamente", () => {
    expect(computeAttemptFeedback({ ...baseInput, difficulty: 1 }).knowledgeDifficulty).toBe(
      "facil",
    );
    expect(computeAttemptFeedback({ ...baseInput, difficulty: 5 }).knowledgeDifficulty).toBe(
      "dificil",
    );
  });

  it("sugere categoria conhecimento para streak de erros", () => {
    const stats = makeStats({ streakWrong: 2, streakCorrect: 0, accuracy: 0.3 });
    const result = computeAttemptFeedback({
      ...baseInput,
      isCorrect: false,
      currentStats: stats,
    });
    expect(result.suggestedErrorCategory).toBe("conhecimento");
  });

  it("sugere categoria esquecimento para quem acertava antes", () => {
    const stats = makeStats({
      streakWrong: 0,
      streakCorrect: 1,
      accuracy: 0.7,
      correctCount: 4,
      wrongCount: 1,
    });
    const result = computeAttemptFeedback({
      ...baseInput,
      isCorrect: false,
      currentStats: stats,
    });
    expect(result.suggestedErrorCategory).toBe("esquecimento");
  });

  it("calcula streak continuando acertos", () => {
    const stats = makeStats({ streakCorrect: 3, streakWrong: 0 });
    const result = computeAttemptFeedback({
      ...baseInput,
      isCorrect: true,
      currentStats: stats,
    });
    expect(result.currentStreak).toBe(4);
  });

  it("reseta streak quando muda de acerto para erro", () => {
    const stats = makeStats({ streakCorrect: 3, streakWrong: 0 });
    const result = computeAttemptFeedback({
      ...baseInput,
      isCorrect: false,
      currentStats: stats,
    });
    expect(result.currentStreak).toBe(-1);
  });

  it("masteryImpactEstimate é maior para primeira tentativa", () => {
    const first = computeAttemptFeedback(baseInput);
    const subsequent = computeAttemptFeedback({
      ...baseInput,
      currentStats: makeStats({ totalAttempts: 20 }),
    });
    expect(first.masteryImpactEstimate).toBeGreaterThan(subsequent.masteryImpactEstimate);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeBankSummary
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBankSummary", () => {
  it("retorna summary zerado para banco vazio", () => {
    const result = computeBankSummary([]);
    expect(result.totalQuestions).toBe(0);
    expect(result.attemptedQuestions).toBe(0);
    expect(result.globalAccuracy).toBe(0);
  });

  it("calcula summary corretamente", () => {
    const questions = [
      makeQuestion({
        questionId: "q-1",
        subjectId: "sub-1",
        examBoard: "CESPE",
        difficulty: 3,
        stats: makeStats({ totalAttempts: 5, correctCount: 3 }),
      }),
      makeQuestion({
        questionId: "q-2",
        subjectId: "sub-1",
        examBoard: "FCC",
        difficulty: 5,
        stats: makeStats({ totalAttempts: 10, correctCount: 8 }),
      }),
      makeQuestion({
        questionId: "q-3",
        subjectId: "sub-2",
        examBoard: "CESPE",
        difficulty: 3,
        stats: null,
      }),
    ];

    const result = computeBankSummary(questions);
    expect(result.totalQuestions).toBe(3);
    expect(result.attemptedQuestions).toBe(2);
    expect(result.unattemptedQuestions).toBe(1);
    expect(result.totalAttempts).toBe(15);
    expect(result.globalAccuracy).toBeCloseTo(11 / 15, 4);
    expect(result.bySubject.get("sub-1")).toBe(2);
    expect(result.bySubject.get("sub-2")).toBe(1);
    expect(result.byExamBoard.get("CESPE")).toBe(2);
    expect(result.byExamBoard.get("FCC")).toBe(1);
    expect(result.byDifficulty.get(3)).toBe(2);
    expect(result.byDifficulty.get(5)).toBe(1);
  });

  it("ignora questões sem stats no cálculo de accuracy", () => {
    const questions = [
      makeQuestion({ questionId: "q-1", stats: null }),
      makeQuestion({ questionId: "q-2", stats: null }),
    ];
    const result = computeBankSummary(questions);
    expect(result.totalQuestions).toBe(2);
    expect(result.attemptedQuestions).toBe(0);
    expect(result.globalAccuracy).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. normalizeTrueFalseAnswer
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeTrueFalseAnswer", () => {
  it("normaliza variações de CERTO para CERTO", () => {
    expect(normalizeTrueFalseAnswer("C")).toBe("CERTO");
    expect(normalizeTrueFalseAnswer("c")).toBe("CERTO");
    expect(normalizeTrueFalseAnswer("CERTO")).toBe("CERTO");
    expect(normalizeTrueFalseAnswer("certo")).toBe("CERTO");
    expect(normalizeTrueFalseAnswer(" C ")).toBe("CERTO");
  });

  it("normaliza variações de ERRADO para ERRADO", () => {
    expect(normalizeTrueFalseAnswer("E")).toBe("ERRADO");
    expect(normalizeTrueFalseAnswer("e")).toBe("ERRADO");
    expect(normalizeTrueFalseAnswer("ERRADO")).toBe("ERRADO");
    expect(normalizeTrueFalseAnswer("errado")).toBe("ERRADO");
    expect(normalizeTrueFalseAnswer(" e ")).toBe("ERRADO");
  });

  it("retorna null para valores inválidos", () => {
    expect(normalizeTrueFalseAnswer(null)).toBeNull();
    expect(normalizeTrueFalseAnswer(undefined)).toBeNull();
    expect(normalizeTrueFalseAnswer("")).toBeNull();
    expect(normalizeTrueFalseAnswer("A")).toBeNull();
    expect(normalizeTrueFalseAnswer("VERDADEIRO")).toBeNull();
  });
});
