/**
 * MOTOR DETERMINÍSTICO DO BANCO DE QUESTÕES — Etapa 6, Fase 1
 *
 * Funções puras para análise, filtragem e priorização de questões.
 * Prepara a infraestrutura lógica para o ciclo completo:
 *   questão → resposta → análise → erro → conhecimento
 *   → diagnóstico → revisão → planejamento
 *
 * PRINCÍPIOS:
 * - Função pura: mesmo input → mesmo output, sempre.
 * - Sem Date.now(), new Date(), Math.random().
 * - Sem Supabase, banco, rede, estado global.
 * - Todos os valores protegidos contra NaN, Infinity, negativos.
 */

import type { Difficulty } from "../knowledge/engine";
import type {
  QuestionBankItem,
  QuestionStats,
  QuestionFilter,
  QuestionBankSummary,
  AttemptFeedback,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS PUROS
// ─────────────────────────────────────────────────────────────────────────────

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Garante que o valor é finito e não NaN. */
function safeFinite(v: number, fallback: number): number {
  if (Number.isFinite(v)) return v;
  return fallback;
}

/**
 * Normaliza respostas de questões CERTO/ERRADO.
 *
 * Mapeamento:
 * "C" / "c" / "CERTO" / "certo" → "CERTO"
 * "E" / "e" / "ERRADO" / "errado" → "ERRADO"
 *
 * @param answer - A string de resposta a ser normalizada
 * @returns "CERTO", "ERRADO" ou null se não puder ser mapeado.
 */
export function normalizeTrueFalseAnswer(
  answer: string | null | undefined,
): "CERTO" | "ERRADO" | null {
  if (!answer) return null;
  const normalized = answer.trim().toUpperCase();

  if (normalized === "C" || normalized === "CERTO") return "CERTO";
  if (normalized === "E" || normalized === "ERRADO") return "ERRADO";

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. computeQuestionStats
// ─────────────────────────────────────────────────────────────────────────────

export type AttemptRecord = {
  attemptId: string;
  questionId: string;
  isCorrect: boolean;
  timeSpentSeconds: number | null;
  answeredAt: string;
};

/**
 * Calcula estatísticas agregadas de uma questão a partir de tentativas.
 *
 * Determinístico: dado o mesmo array de tentativas, retorna sempre
 * o mesmo resultado.
 */
export function computeQuestionStats(attempts: AttemptRecord[]): QuestionStats {
  if (attempts.length === 0) {
    return {
      totalAttempts: 0,
      correctCount: 0,
      wrongCount: 0,
      streakCorrect: 0,
      streakWrong: 0,
      bestTimeSeconds: null,
      avgTimeSeconds: null,
      lastAttemptedAt: null,
      lastCorrectAt: null,
      lastWrongAt: null,
      accuracy: 0,
    };
  }

  // Ordenar cronologicamente
  const sorted = [...attempts].sort(
    (a, b) => new Date(a.answeredAt).getTime() - new Date(b.answeredAt).getTime(),
  );

  let correctCount = 0;
  let wrongCount = 0;
  let bestTime: number | null = null;
  let totalTime = 0;
  let timeCount = 0;
  let lastCorrectAt: string | null = null;
  let lastWrongAt: string | null = null;

  for (const a of sorted) {
    if (a.isCorrect) {
      correctCount++;
      lastCorrectAt = a.answeredAt;
    } else {
      wrongCount++;
      lastWrongAt = a.answeredAt;
    }

    if (a.timeSpentSeconds !== null && a.timeSpentSeconds > 0) {
      const t = safeFinite(a.timeSpentSeconds, 0);
      if (t > 0) {
        if (bestTime === null || t < bestTime) bestTime = t;
        totalTime += t;
        timeCount++;
      }
    }
  }

  // Calcular streak a partir do final
  let streakCorrect = 0;
  let streakWrong = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]!.isCorrect) {
      if (streakWrong > 0) break;
      streakCorrect++;
    } else {
      if (streakCorrect > 0) break;
      streakWrong++;
    }
  }

  const total = sorted.length;
  const lastAttemptedAt = sorted[total - 1]!.answeredAt;
  const accuracy = total > 0 ? clamp01(correctCount / total) : 0;
  const avgTimeSeconds = timeCount > 0 ? safeFinite(totalTime / timeCount, 0) : null;

  return {
    totalAttempts: total,
    correctCount,
    wrongCount,
    streakCorrect,
    streakWrong,
    bestTimeSeconds: bestTime,
    avgTimeSeconds,
    lastAttemptedAt,
    lastCorrectAt,
    lastWrongAt,
    accuracy,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. filterQuestions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filtra questões com base em critérios multi-campo.
 * Todos os filtros são AND (questão deve satisfazer todos os critérios ativos).
 *
 * Determinístico: mesmo input → mesmo output.
 */
export function filterQuestions(
  questions: QuestionBankItem[],
  filter: QuestionFilter,
): QuestionBankItem[] {
  return questions.filter((q) => {
    if (filter.subjectId != null && q.subjectId !== filter.subjectId) return false;
    if (filter.topicId != null && q.topicId !== filter.topicId) return false;
    if (filter.contestId != null && q.contestId !== filter.contestId) return false;
    if (filter.examBoard != null && q.examBoard !== filter.examBoard) return false;

    if (filter.yearMin != null && (q.year === null || q.year < filter.yearMin)) return false;
    if (filter.yearMax != null && (q.year === null || q.year > filter.yearMax)) return false;

    if (
      filter.difficultyMin != null &&
      (q.difficulty === null || q.difficulty < filter.difficultyMin)
    )
      return false;
    if (
      filter.difficultyMax != null &&
      (q.difficulty === null || q.difficulty > filter.difficultyMax)
    )
      return false;

    if (filter.origin != null && q.origin !== filter.origin) return false;
    if (filter.novelty != null && q.novelty !== filter.novelty) return false;
    if (filter.isTrueFalse != null && q.isTrueFalse !== filter.isTrueFalse) return false;

    if (filter.tags != null && filter.tags.length > 0) {
      const hasAny = filter.tags.some((t) => q.tags.includes(t));
      if (!hasAny) return false;
    }

    if (filter.neverAttempted === true && q.stats !== null) return false;
    if (filter.lastAttemptWrong === true) {
      if (!q.stats || q.stats.totalAttempts === 0) return false;
      if (q.stats.streakWrong === 0) return false;
    }

    if (filter.searchText != null && filter.searchText.trim() !== "") {
      const lower = filter.searchText.toLowerCase();
      if (!q.statement.toLowerCase().includes(lower)) return false;
    }

    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. rankQuestionsForStudy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ordena questões por prioridade de estudo.
 *
 * Prioridade (maior primeiro):
 *   1. Nunca tentadas (sem stats) — score base 100
 *   2. Última tentativa errada — score base 80
 *   3. Baixa accuracy — score proporcional a (1 - accuracy) * 60
 *   4. Não tentadas há muito tempo — bonus temporal
 *   5. Dificuldade mais alta — ligeiro bonus
 *
 * Retorna array novo (não muta o original), ordenado por score decrescente.
 *
 * Determinístico: mesmo input → mesma ordem.
 *
 * @param referenceDate - Data ISO de referência para cálculos temporais.
 */
export function rankQuestionsForStudy(
  questions: QuestionBankItem[],
  referenceDate: string,
): QuestionBankItem[] {
  const refMs = Date.parse(referenceDate);

  const scored = questions.map((q) => {
    let score = 0;

    if (!q.stats || q.stats.totalAttempts === 0) {
      // Nunca tentada
      score = 100;
    } else {
      const s = q.stats;

      // Última tentativa errada
      if (s.streakWrong > 0) {
        score += 80;
      }

      // Baixa accuracy
      score += (1 - s.accuracy) * 60;

      // Bonus temporal: dias desde última tentativa
      if (s.lastAttemptedAt && Number.isFinite(refMs)) {
        const lastMs = Date.parse(s.lastAttemptedAt);
        if (Number.isFinite(lastMs)) {
          const daysSince = Math.max(0, (refMs - lastMs) / 86_400_000);
          // Até 20 pontos de bonus temporal (satura em ~60 dias)
          score += Math.min(20, daysSince / 3);
        }
      }
    }

    // Bonus por dificuldade
    if (q.difficulty !== null && q.difficulty > 0) {
      score += safeFinite(q.difficulty, 0) * 0.5;
    }

    return { question: q, score };
  });

  // Ordenar por score decrescente, desempate por questionId (estabilidade)
  scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 0.001) return diff;
    return a.question.questionId.localeCompare(b.question.questionId);
  });

  return scored.map((s) => s.question);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. mapDifficultyToKnowledge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapeia dificuldade numérica (1-5) para o tipo Difficulty do Knowledge Engine.
 *
 * 1-2 → facil
 * 3   → media
 * 4-5 → dificil
 * null/fora do range → media (fallback conservador)
 */
export function mapDifficultyToKnowledge(difficulty: number | null): Difficulty {
  if (difficulty === null || !Number.isFinite(difficulty)) return "media";
  if (difficulty <= 2) return "facil";
  if (difficulty >= 4) return "dificil";
  return "media";
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. computeAttemptFeedback
// ─────────────────────────────────────────────────────────────────────────────

export type AttemptFeedbackInput = {
  questionId: string;
  isCorrect: boolean;
  difficulty: number | null;
  topicId: string | null;
  subjectId: string | null;
  timestamp: string;
  /** Estatísticas atuais da questão ANTES desta tentativa (null se primeira) */
  currentStats: QuestionStats | null;
};

/**
 * Analisa uma tentativa e gera feedback para alimentar o ciclo de aprendizagem.
 *
 * O feedback produz os sinais necessários para:
 * - Knowledge Engine: isCorrect, knowledgeDifficulty, topicId
 * - Error tracking: shouldCreateError, suggestedErrorCategory
 * - Stats update: currentStreak, isFirstAttempt
 *
 * Determinístico: mesmo input → mesmo output.
 */
export function computeAttemptFeedback(input: AttemptFeedbackInput): AttemptFeedback {
  const knowledgeDifficulty = mapDifficultyToKnowledge(input.difficulty);
  const isFirstAttempt = !input.currentStats || input.currentStats.totalAttempts === 0;

  // Calcular streak após esta tentativa
  let currentStreak: number;
  if (isFirstAttempt) {
    currentStreak = input.isCorrect ? 1 : -1;
  } else {
    const stats = input.currentStats!;
    if (input.isCorrect) {
      currentStreak = stats.streakCorrect > 0 ? stats.streakCorrect + 1 : 1;
    } else {
      currentStreak = stats.streakWrong > 0 ? -(stats.streakWrong + 1) : -1;
    }
  }

  // Determinar se deve criar error_entry
  // Cria erro quando: errou E tem tópico associado
  const shouldCreateError = !input.isCorrect && input.topicId !== null;

  // Sugerir categoria do erro baseado no padrão
  let suggestedErrorCategory: string | null = null;
  if (!input.isCorrect && input.currentStats) {
    const s = input.currentStats;
    if (s.streakWrong >= 2) {
      // Errando repetidamente → provavelmente lacuna de conhecimento
      suggestedErrorCategory = "conhecimento";
    } else if (s.correctCount > 0 && s.accuracy >= 0.5) {
      // Já acertou antes com boa taxa → provavelmente esquecimento ou atenção
      suggestedErrorCategory = "esquecimento";
    }
    // Se não se encaixa, deixa null para o usuário classificar
  }

  // Estimar impacto no mastery
  // Simplificado: primeira tentativa tem mais impacto que as seguintes
  let masteryImpactEstimate: number;
  if (isFirstAttempt) {
    masteryImpactEstimate = input.isCorrect ? 0.15 : 0.1;
  } else {
    const totalAfter = (input.currentStats?.totalAttempts ?? 0) + 1;
    // Impacto diminui com mais tentativas (similar ao alpha do Knowledge Engine)
    const base = Math.min(2 / (totalAfter + 2), 0.5);
    masteryImpactEstimate = clamp01(safeFinite(base * 0.5, 0.01));
  }

  return {
    questionId: input.questionId,
    isCorrect: input.isCorrect,
    knowledgeDifficulty,
    shouldCreateError,
    suggestedErrorCategory,
    isFirstAttempt,
    currentStreak,
    masteryImpactEstimate,
    topicId: input.topicId,
    subjectId: input.subjectId,
    timestamp: input.timestamp,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. computeBankSummary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gera resumo do banco de questões.
 *
 * Determinístico: mesmo input → mesmo output.
 */
export function computeBankSummary(questions: QuestionBankItem[]): QuestionBankSummary {
  let attemptedCount = 0;
  let totalCorrect = 0;
  let totalAttempts = 0;

  const bySubject = new Map<string, number>();
  const byExamBoard = new Map<string, number>();
  const byDifficulty = new Map<number, number>();

  for (const q of questions) {
    // By subject
    if (q.subjectId) {
      bySubject.set(q.subjectId, (bySubject.get(q.subjectId) ?? 0) + 1);
    }

    // By exam board
    if (q.examBoard) {
      byExamBoard.set(q.examBoard, (byExamBoard.get(q.examBoard) ?? 0) + 1);
    }

    // By difficulty
    if (q.difficulty !== null) {
      byDifficulty.set(q.difficulty, (byDifficulty.get(q.difficulty) ?? 0) + 1);
    }

    // Stats
    if (q.stats && q.stats.totalAttempts > 0) {
      attemptedCount++;
      totalCorrect += q.stats.correctCount;
      totalAttempts += q.stats.totalAttempts;
    }
  }

  const globalAccuracy =
    totalAttempts > 0 ? clamp01(safeFinite(totalCorrect / totalAttempts, 0)) : 0;

  return {
    totalQuestions: questions.length,
    attemptedQuestions: attemptedCount,
    unattemptedQuestions: questions.length - attemptedCount,
    globalAccuracy,
    totalAttempts,
    bySubject,
    byExamBoard,
    byDifficulty,
  };
}
