/**
 * TIPOS DO BANCO DE QUESTÕES — Etapa 6, Fase 1
 *
 * Tipos puros para o sistema integrado de questões.
 * Nenhuma lógica aqui — apenas contratos de dados.
 *
 * O banco de questões alimenta o ciclo completo:
 *   questão → resposta → análise → erro → conhecimento
 *   → diagnóstico → revisão → planejamento
 *
 * Reutiliza tipos existentes do projeto:
 *   - Difficulty         (knowledge/engine.ts) — para feedback de tentativa
 *   - KnowledgeStateName (diagnosis/engine.ts) — para contexto de estudo
 *   - ErrorRecord        (knowledge/errors.ts) — para análise de erros
 */

import type { Difficulty } from "../knowledge/engine";
import type { KnowledgeStateName } from "../diagnosis/engine";

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS ESPELHADOS DO BANCO
// ─────────────────────────────────────────────────────────────────────────────

/** Origem da questão (espelha question_origin no banco). */
export type QuestionOrigin =
  "banco_externo" | "manual" | "ocr" | "prova_oficial" | "ia" | "variacao_sistema";

/** Novidade da questão (espelha question_novelty no banco). */
export type QuestionNovelty = "conhecida" | "nova" | "inedita" | "variacao";

/** Tipo de conjunto de questões (espelha question_set_type no banco). */
export type QuestionSetType = "simulado" | "lista" | "caderno" | "revisao" | "diagnostico";

/** Modo da tentativa (espelha attempt_mode no banco). */
export type AttemptMode = "estudo" | "revisao" | "simulado" | "diagnostico" | "flashcard" | "outro";

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION BANK ITEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Questão enriquecida com estatísticas e metadados para o banco.
 * Combina dados da tabela questions + question_stats.
 */
export type QuestionBankItem = {
  /** ID da questão */
  questionId: string;
  /** Enunciado */
  statement: string;
  /** Alternativas (JSON) */
  alternatives: unknown[];
  /** Resposta correta */
  correctAnswer: string | null;
  /** Se é verdadeiro/falso */
  isTrueFalse: boolean;
  /** Banca examinadora */
  examBoard: string | null;
  /** Nome do concurso (texto livre) */
  contestName: string | null;
  /** ID do concurso vinculado */
  contestId: string | null;
  /** Ano da prova */
  year: number | null;
  /** ID da matéria */
  subjectId: string | null;
  /** ID do tópico */
  topicId: string | null;
  /** Dificuldade (1-5) */
  difficulty: number | null;
  /** Origem */
  origin: QuestionOrigin;
  /** Novidade */
  novelty: QuestionNovelty | null;
  /** Tags da questão */
  tags: string[];
  /** Explicação/gabarito comentado */
  explanation: string | null;
  /** Se é pública */
  isPublic: boolean;
  /** Estatísticas do usuário (null se nunca tentou) */
  stats: QuestionStats | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION STATS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estatísticas agregadas de uma questão para um usuário.
 * Espelha a tabela question_stats.
 */
export type QuestionStats = {
  /** Total de tentativas */
  totalAttempts: number;
  /** Acertos */
  correctCount: number;
  /** Erros */
  wrongCount: number;
  /** Sequência atual de acertos consecutivos */
  streakCorrect: number;
  /** Sequência atual de erros consecutivos */
  streakWrong: number;
  /** Melhor tempo em segundos */
  bestTimeSeconds: number | null;
  /** Tempo médio em segundos */
  avgTimeSeconds: number | null;
  /** Última tentativa */
  lastAttemptedAt: string | null;
  /** Último acerto */
  lastCorrectAt: string | null;
  /** Último erro */
  lastWrongAt: string | null;
  /** Taxa de acerto (0..1) */
  accuracy: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION SET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conjunto/lista de questões (simulado, caderno, etc).
 * Espelha a tabela question_sets.
 */
export type QuestionSet = {
  /** ID do conjunto */
  setId: string;
  /** Nome */
  name: string;
  /** Descrição */
  description: string | null;
  /** Tipo */
  type: QuestionSetType;
  /** ID do concurso vinculado */
  contestId: string | null;
  /** ID da matéria vinculada */
  subjectId: string | null;
  /** ID do tópico vinculado */
  topicId: string | null;
  /** Limite de tempo em minutos */
  timeLimitMinutes: number | null;
  /** Se é cronometrado */
  isTimed: boolean;
  /** Se foi concluído */
  isCompleted: boolean;
  /** Data de conclusão */
  completedAt: string | null;
  /** Total de questões no set */
  totalQuestions: number;
  /** Acertos */
  correctCount: number;
  /** Erros */
  wrongCount: number;
  /** Nota/score */
  score: number | null;
  /** Tags */
  tags: string[];
};

/**
 * Item dentro de um conjunto de questões.
 * Espelha a tabela question_set_items.
 */
export type QuestionSetItem = {
  /** ID do item */
  itemId: string;
  /** ID do conjunto */
  setId: string;
  /** ID da questão */
  questionId: string;
  /** Posição no conjunto */
  position: number;
  /** Se já foi respondida */
  isAnswered: boolean;
  /** Se acertou */
  isCorrect: boolean | null;
  /** Resposta escolhida */
  chosenAnswer: string | null;
  /** Tempo gasto em segundos */
  timeSpentSeconds: number | null;
  /** ID da tentativa vinculada */
  attemptId: string | null;
  /** Notas/anotações */
  notes: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION FILTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filtro multi-critério para busca no banco de questões.
 * Todos os campos são opcionais (null/undefined = sem filtro).
 */
export type QuestionFilter = {
  /** Filtrar por matéria */
  subjectId?: string | null;
  /** Filtrar por tópico */
  topicId?: string | null;
  /** Filtrar por concurso */
  contestId?: string | null;
  /** Filtrar por banca */
  examBoard?: string | null;
  /** Filtrar por ano (mínimo) */
  yearMin?: number | null;
  /** Filtrar por ano (máximo) */
  yearMax?: number | null;
  /** Filtrar por dificuldade (mínima, 1-5) */
  difficultyMin?: number | null;
  /** Filtrar por dificuldade (máxima, 1-5) */
  difficultyMax?: number | null;
  /** Filtrar por origem */
  origin?: QuestionOrigin | null;
  /** Filtrar por novidade */
  novelty?: QuestionNovelty | null;
  /** Filtrar por tags (qualquer uma presente) */
  tags?: string[] | null;
  /** Filtrar por verdadeiro/falso */
  isTrueFalse?: boolean | null;
  /** Filtrar apenas questões nunca tentadas */
  neverAttempted?: boolean | null;
  /** Filtrar apenas questões com erro na última tentativa */
  lastAttemptWrong?: boolean | null;
  /** Filtrar por texto no enunciado */
  searchText?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION BANK SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resumo geral do banco de questões do usuário.
 * Usado para dashboard e métricas.
 */
export type QuestionBankSummary = {
  /** Total de questões no banco */
  totalQuestions: number;
  /** Questões já tentadas */
  attemptedQuestions: number;
  /** Questões nunca tentadas */
  unattemptedQuestions: number;
  /** Taxa de acerto global */
  globalAccuracy: number;
  /** Total de tentativas */
  totalAttempts: number;
  /** Questões por matéria */
  bySubject: Map<string, number>;
  /** Questões por banca */
  byExamBoard: Map<string, number>;
  /** Questões por dificuldade */
  byDifficulty: Map<number, number>;
};

// ─────────────────────────────────────────────────────────────────────────────
// ATTEMPT FEEDBACK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Feedback gerado após uma tentativa de resposta.
 * Produz os sinais necessários para alimentar o ciclo:
 *   questão → resposta → análise → erro → conhecimento
 *   → diagnóstico → revisão → planejamento
 *
 * O campo knowledgeDifficulty mapeia a dificuldade numérica (1-5)
 * da questão para o tipo Difficulty do Knowledge Engine.
 */
export type AttemptFeedback = {
  /** ID da questão */
  questionId: string;
  /** Se acertou */
  isCorrect: boolean;
  /** Dificuldade mapeada para o Knowledge Engine */
  knowledgeDifficulty: Difficulty;
  /** Se deve gerar um error_entry */
  shouldCreateError: boolean;
  /** Categoria sugerida do erro (se errou) */
  suggestedErrorCategory: string | null;
  /** Se a questão é inédita para o aluno */
  isFirstAttempt: boolean;
  /** Sequência atual (positiva = acertos, negativa = erros) */
  currentStreak: number;
  /** Contribuição estimada para o mastery do tópico (0..1) */
  masteryImpactEstimate: number;
  /** ID do tópico (para roteamento ao Knowledge Engine) */
  topicId: string | null;
  /** ID da matéria */
  subjectId: string | null;
  /** Timestamp da tentativa (ISO) */
  timestamp: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// RE-EXPORTS para conveniência
// ─────────────────────────────────────────────────────────────────────────────

export type { Difficulty } from "../knowledge/engine";
export type { KnowledgeStateName } from "../diagnosis/engine";
