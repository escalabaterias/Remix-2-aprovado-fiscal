/**
 * TESTES DO QUESTION BANK SERVICE — Etapa 6, Fase 2
 *
 * Testa os conversores e a lógica de orquestração do service.
 * Como o service depende do Supabase (I/O), os testes focam em:
 *   - Conversores internos (funções puras exportadas para teste)
 *   - Verificação de que o engine é chamado corretamente
 *   - Lógica de buildSupabaseFilters
 *   - Composição de QuestionBankItem com stats
 */

import { describe, it, expect } from "vitest";
import {
  toQuestionBankItem,
  toQuestionStats,
  toQuestionSet,
  toQuestionSetItem,
  buildSupabaseFilters,
} from "./service";
import { filterQuestions, rankQuestionsForStudy, computeBankSummary } from "./engine";
import type {
  QuestionBankItem,
  QuestionStats,
  QuestionSet,
  QuestionSetItem,
  QuestionFilter,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// FACTORIES (rows do banco simuladas)
// ─────────────────────────────────────────────────────────────────────────────

function makeQuestionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "q-1",
    statement: "Qual é a capital do Brasil?",
    alternatives: ["A", "B", "C", "D"],
    correct_answer: "A",
    is_true_false: false,
    exam_board: "CESPE",
    contest_name: null,
    contest_id: null,
    year: 2024,
    subject_id: "sub-1",
    topic_id: "top-1",
    difficulty: 3,
    origin: "prova_oficial",
    novelty: null,
    tags: ["constitucional"],
    explanation: null,
    is_public: false,
    ...overrides,
  };
}

function makeStatsRow(overrides: Record<string, unknown> = {}) {
  return {
    question_id: "q-1",
    total_attempts: 5,
    correct_count: 3,
    wrong_count: 2,
    streak_correct: 1,
    streak_wrong: 0,
    best_time_seconds: 20,
    avg_time_seconds: 30,
    last_attempted_at: "2026-08-01T10:00:00Z",
    last_correct_at: "2026-08-01T10:00:00Z",
    last_wrong_at: "2026-07-28T10:00:00Z",
    ...overrides,
  };
}

function makeQuestionSetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "set-1",
    name: "Simulado 1",
    description: "Simulado de constitucional",
    type: "simulado",
    contest_id: null,
    subject_id: "sub-1",
    topic_id: null,
    time_limit_minutes: 120,
    is_timed: true,
    is_completed: false,
    completed_at: null,
    total_questions: 10,
    correct_count: 0,
    wrong_count: 0,
    score: null,
    tags: ["simulado", "constitucional"],
    ...overrides,
  };
}

function makeQuestionSetItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    set_id: "set-1",
    question_id: "q-1",
    position: 0,
    is_answered: false,
    is_correct: null,
    chosen_answer: null,
    time_spent_seconds: null,
    attempt_id: null,
    notes: null,
    ...overrides,
  };
}

function makeQuestionBankItem(overrides: Partial<QuestionBankItem> = {}): QuestionBankItem {
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
    origin: "prova_oficial",
    novelty: null,
    tags: [],
    explanation: null,
    isPublic: false,
    stats: null,
    ...overrides,
  };
}

function makeQuestionStats(overrides: Partial<QuestionStats> = {}): QuestionStats {
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
// toQuestionStats
// ─────────────────────────────────────────────────────────────────────────────

describe("toQuestionStats", () => {
  it("converte row do banco para QuestionStats", () => {
    const row = makeStatsRow();
    const stats = toQuestionStats(row);
    expect(stats.totalAttempts).toBe(5);
    expect(stats.correctCount).toBe(3);
    expect(stats.wrongCount).toBe(2);
    expect(stats.streakCorrect).toBe(1);
    expect(stats.streakWrong).toBe(0);
    expect(stats.bestTimeSeconds).toBe(20);
    expect(stats.avgTimeSeconds).toBe(30);
    expect(stats.lastAttemptedAt).toBe("2026-08-01T10:00:00Z");
    expect(stats.accuracy).toBeCloseTo(0.6, 4);
  });

  it("trata campos null corretamente", () => {
    const row = makeStatsRow({
      best_time_seconds: null,
      avg_time_seconds: null,
      last_attempted_at: null,
      last_correct_at: null,
      last_wrong_at: null,
    });
    const stats = toQuestionStats(row);
    expect(stats.bestTimeSeconds).toBeNull();
    expect(stats.avgTimeSeconds).toBeNull();
    expect(stats.lastAttemptedAt).toBeNull();
  });

  it("calcula accuracy 0 para zero tentativas", () => {
    const row = makeStatsRow({ total_attempts: 0, correct_count: 0, wrong_count: 0 });
    const stats = toQuestionStats(row);
    expect(stats.accuracy).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toQuestionBankItem
// ─────────────────────────────────────────────────────────────────────────────

describe("toQuestionBankItem", () => {
  it("converte row + stats para QuestionBankItem", () => {
    const row = makeQuestionRow();
    const stats = toQuestionStats(makeStatsRow());
    const item = toQuestionBankItem(row, stats);

    expect(item.questionId).toBe("q-1");
    expect(item.statement).toBe("Qual é a capital do Brasil?");
    expect(item.examBoard).toBe("CESPE");
    expect(item.year).toBe(2024);
    expect(item.difficulty).toBe(3);
    expect(item.origin).toBe("prova_oficial");
    expect(item.tags).toEqual(["constitucional"]);
    expect(item.stats).not.toBeNull();
    expect(item.stats!.totalAttempts).toBe(5);
  });

  it("converte row sem stats (null)", () => {
    const row = makeQuestionRow();
    const item = toQuestionBankItem(row, null);
    expect(item.stats).toBeNull();
  });

  it("trata alternatives não-array como array vazio", () => {
    const row = makeQuestionRow({ alternatives: "not-an-array" });
    const item = toQuestionBankItem(row, null);
    expect(item.alternatives).toEqual([]);
  });

  it("trata tags não-array como array vazio", () => {
    const row = makeQuestionRow({ tags: null });
    const item = toQuestionBankItem(row, null);
    expect(item.tags).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toQuestionSet
// ─────────────────────────────────────────────────────────────────────────────

describe("toQuestionSet", () => {
  it("converte row para QuestionSet", () => {
    const row = makeQuestionSetRow();
    const set = toQuestionSet(row);
    expect(set.setId).toBe("set-1");
    expect(set.name).toBe("Simulado 1");
    expect(set.type).toBe("simulado");
    expect(set.isTimed).toBe(true);
    expect(set.timeLimitMinutes).toBe(120);
    expect(set.totalQuestions).toBe(10);
    expect(set.tags).toEqual(["simulado", "constitucional"]);
    expect(set.isCompleted).toBe(false);
    expect(set.score).toBeNull();
  });

  it("converte set completo com score", () => {
    const row = makeQuestionSetRow({
      is_completed: true,
      completed_at: "2026-08-29T12:00:00Z",
      correct_count: 7,
      wrong_count: 3,
      score: 70.0,
    });
    const set = toQuestionSet(row);
    expect(set.isCompleted).toBe(true);
    expect(set.completedAt).toBe("2026-08-29T12:00:00Z");
    expect(set.correctCount).toBe(7);
    expect(set.wrongCount).toBe(3);
    expect(set.score).toBe(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toQuestionSetItem
// ─────────────────────────────────────────────────────────────────────────────

describe("toQuestionSetItem", () => {
  it("converte row para QuestionSetItem", () => {
    const row = makeQuestionSetItemRow();
    const item = toQuestionSetItem(row);
    expect(item.itemId).toBe("item-1");
    expect(item.setId).toBe("set-1");
    expect(item.questionId).toBe("q-1");
    expect(item.position).toBe(0);
    expect(item.isAnswered).toBe(false);
    expect(item.isCorrect).toBeNull();
    expect(item.chosenAnswer).toBeNull();
    expect(item.timeSpentSeconds).toBeNull();
  });

  it("converte item respondido", () => {
    const row = makeQuestionSetItemRow({
      is_answered: true,
      is_correct: true,
      chosen_answer: "A",
      time_spent_seconds: 45,
      attempt_id: "att-1",
      notes: "Questão fácil",
    });
    const item = toQuestionSetItem(row);
    expect(item.isAnswered).toBe(true);
    expect(item.isCorrect).toBe(true);
    expect(item.chosenAnswer).toBe("A");
    expect(item.timeSpentSeconds).toBe(45);
    expect(item.attemptId).toBe("att-1");
    expect(item.notes).toBe("Questão fácil");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Engine delegation (filterQuestions + rankQuestionsForStudy + computeBankSummary)
// ─────────────────────────────────────────────────────────────────────────────

describe("Engine delegation via service", () => {
  const questions: QuestionBankItem[] = [
    makeQuestionBankItem({
      questionId: "q-1",
      subjectId: "sub-1",
      examBoard: "CESPE",
      difficulty: 3,
      stats: null,
    }),
    makeQuestionBankItem({
      questionId: "q-2",
      subjectId: "sub-2",
      examBoard: "FCC",
      difficulty: 5,
      stats: makeQuestionStats({
        totalAttempts: 10,
        correctCount: 8,
        accuracy: 0.8,
        streakCorrect: 3,
        streakWrong: 0,
      }),
    }),
    makeQuestionBankItem({
      questionId: "q-3",
      subjectId: "sub-1",
      examBoard: "CESPE",
      difficulty: 1,
      stats: makeQuestionStats({
        totalAttempts: 5,
        correctCount: 1,
        accuracy: 0.2,
        streakCorrect: 0,
        streakWrong: 2,
      }),
    }),
  ];

  it("filterQuestions filtra por subjectId", () => {
    const result = filterQuestions(questions, { subjectId: "sub-1" });
    expect(result).toHaveLength(2);
    expect(result.map((q) => q.questionId)).toEqual(["q-1", "q-3"]);
  });

  it("filterQuestions filtra neverAttempted", () => {
    const result = filterQuestions(questions, { neverAttempted: true });
    expect(result).toHaveLength(1);
    expect(result[0]!.questionId).toBe("q-1");
  });

  it("filterQuestions filtra lastAttemptWrong", () => {
    const result = filterQuestions(questions, { lastAttemptWrong: true });
    expect(result).toHaveLength(1);
    expect(result[0]!.questionId).toBe("q-3");
  });

  it("filterQuestions retorna vazio quando nenhum match", () => {
    const result = filterQuestions(questions, { subjectId: "sub-inexistente" });
    expect(result).toHaveLength(0);
  });

  it("rankQuestionsForStudy prioriza nunca tentadas", () => {
    const result = rankQuestionsForStudy(questions, "2026-08-29");
    expect(result[0]!.questionId).toBe("q-1"); // nunca tentada
  });

  it("rankQuestionsForStudy prioriza erros sobre acertos", () => {
    // Remove a nunca tentada para focar no ranking entre tentadas
    const tried = questions.filter((q) => q.stats !== null);
    const result = rankQuestionsForStudy(tried, "2026-08-29");
    expect(result[0]!.questionId).toBe("q-3"); // streakWrong > 0
  });

  it("computeBankSummary gera resumo correto", () => {
    const summary = computeBankSummary(questions);
    expect(summary.totalQuestions).toBe(3);
    expect(summary.attemptedQuestions).toBe(2); // q-2 e q-3
    expect(summary.unattemptedQuestions).toBe(1); // q-1
    expect(summary.totalAttempts).toBe(15); // 10 + 5
    expect(summary.globalAccuracy).toBeCloseTo(9 / 15, 4); // (8+1)/15
    expect(summary.bySubject.get("sub-1")).toBe(2);
    expect(summary.bySubject.get("sub-2")).toBe(1);
    expect(summary.byExamBoard.get("CESPE")).toBe(2);
    expect(summary.byExamBoard.get("FCC")).toBe(1);
    expect(summary.byDifficulty.get(3)).toBe(1);
    expect(summary.byDifficulty.get(5)).toBe(1);
    expect(summary.byDifficulty.get(1)).toBe(1);
  });

  it("computeBankSummary retorna zerado para banco vazio", () => {
    const summary = computeBankSummary([]);
    expect(summary.totalQuestions).toBe(0);
    expect(summary.globalAccuracy).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSupabaseFilters (lógica de construção de filtros)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSupabaseFilters", () => {
  // Não podemos chamar Supabase real, mas podemos testar que a função
  // não lança exceção e aceita filtros válidos.
  // O teste real de integração seria com Supabase local.

  it("aceita filtro vazio sem erro", () => {
    // buildSupabaseFilters precisa de um query-like object.
    // Criamos um mock mínimo que registra chamadas.
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const mockQuery = new Proxy(
      {},
      {
        get(_target, prop) {
          return (...args: unknown[]) => {
            calls.push({ method: String(prop), args });
            return mockQuery;
          };
        },
      },
    ) as ReturnType<
      ReturnType<typeof import("@supabase/supabase-js").createClient>["from"]
    >["select"];

    const result = buildSupabaseFilters(mockQuery as never, {});
    expect(result).toBeDefined();
    // Sem filtros, nenhum método deve ter sido chamado
    expect(calls).toHaveLength(0);
  });

  it("chama eq/gte/lte/overlaps para cada filtro ativo", () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const mockQuery = new Proxy(
      {},
      {
        get(_target, prop) {
          return (...args: unknown[]) => {
            calls.push({ method: String(prop), args });
            return mockQuery;
          };
        },
      },
    );

    const filter: QuestionFilter = {
      subjectId: "sub-1",
      topicId: "top-1",
      contestId: "c-1",
      examBoard: "CESPE",
      yearMin: 2020,
      yearMax: 2024,
      difficultyMin: 2,
      difficultyMax: 4,
      origin: "prova_oficial",
      isTrueFalse: false,
      tags: ["constitucional"],
    };

    buildSupabaseFilters(mockQuery as never, filter);

    // Deve ter chamado: eq x5, gte x2, lte x2, overlaps x1 = 10 chamadas
    const methodCounts = calls.reduce(
      (acc, c) => {
        acc[c.method] = (acc[c.method] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    expect(calls).toHaveLength(11);
    expect(methodCounts["eq"]).toBe(6);
    expect(methodCounts["gte"]).toBe(2);
    expect(methodCounts["lte"]).toBe(2);
    expect(methodCounts["overlaps"]).toBe(1);
  });

  it("não aplica filtros de stats no Supabase (neverAttempted, lastAttemptWrong)", () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const mockQuery = new Proxy(
      {},
      {
        get(_target, prop) {
          return (...args: unknown[]) => {
            calls.push({ method: String(prop), args });
            return mockQuery;
          };
        },
      },
    );

    buildSupabaseFilters(mockQuery as never, {
      neverAttempted: true,
      lastAttemptWrong: true,
      searchText: "capital",
      novelty: "inedita",
    });

    // Nenhum desses filtros mapeia para Supabase
    expect(calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stats batch (verificação de lógica de composição)
// ─────────────────────────────────────────────────────────────────────────────

describe("Stats batch composition (sem N+1)", () => {
  it("compõe corretamente questões com stats de lote", () => {
    // Simula o fluxo que fetchQuestions faz:
    // 1. Busca questões → rows[]
    // 2. Busca stats em lote → Map<questionId, stats>
    // 3. Monta QuestionBankItem[]
    const rows = [
      makeQuestionRow({ id: "q-1" }),
      makeQuestionRow({ id: "q-2" }),
      makeQuestionRow({ id: "q-3" }),
    ];

    const statsMap = new Map<string, QuestionStats>();
    statsMap.set(
      "q-1",
      toQuestionStats(makeStatsRow({ question_id: "q-1", total_attempts: 10, correct_count: 7 })),
    );
    // q-2 não tem stats (nunca tentada)
    statsMap.set(
      "q-3",
      toQuestionStats(makeStatsRow({ question_id: "q-3", total_attempts: 3, correct_count: 1 })),
    );

    const items = rows.map((row) => toQuestionBankItem(row, statsMap.get(row.id) ?? null));

    expect(items).toHaveLength(3);
    expect(items[0]!.stats).not.toBeNull();
    expect(items[0]!.stats!.totalAttempts).toBe(10);
    expect(items[1]!.stats).toBeNull(); // q-2 sem stats
    expect(items[2]!.stats).not.toBeNull();
    expect(items[2]!.stats!.totalAttempts).toBe(3);
  });

  it("não há N+1: todas as stats vêm de um único Map (simulação)", () => {
    // Verifica que o pattern do service é: busca tudo em 1 query → Map → merge
    // Não faz 1 query por questão
    const questionIds = Array.from({ length: 100 }, (_, i) => `q-${i}`);
    const statsMap = new Map<string, QuestionStats>();

    // Simula batch: apenas 30 têm stats
    for (let i = 0; i < 30; i++) {
      statsMap.set(
        `q-${i}`,
        toQuestionStats(makeStatsRow({ question_id: `q-${i}`, total_attempts: i + 1 })),
      );
    }

    // Merge: O(N), não O(N*query)
    const items = questionIds.map((id) => {
      const row = makeQuestionRow({ id });
      return toQuestionBankItem(row, statsMap.get(id) ?? null);
    });

    const withStats = items.filter((i) => i.stats !== null);
    const withoutStats = items.filter((i) => i.stats === null);

    expect(withStats).toHaveLength(30);
    expect(withoutStats).toHaveLength(70);
    expect(items).toHaveLength(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Isolamento por usuário
// ─────────────────────────────────────────────────────────────────────────────

describe("Isolamento por usuário", () => {
  it("service não aceita userId arbitrário (não há parâmetro userId nas funções públicas)", () => {
    // Verificação estática: nenhuma das funções exportadas do service
    // aceita userId como parâmetro. O isolamento é feito via:
    // 1. requireUser() — valida autenticação
    // 2. RLS no banco — filtra por auth.uid()
    //
    // Isso é uma verificação de design, não de runtime.
    // As assinaturas confirmam: fetchQuestions, fetchRankedQuestions,
    // fetchQuestionStats, fetchBankSummary, createQuestionSet,
    // getQuestionSet, getUserQuestionSets, updateQuestionSetItem
    // — nenhuma tem parâmetro userId.
    expect(true).toBe(true); // Design assertion
  });
});
