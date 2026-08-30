/**
 * Módulo de sinais para o planner — Etapa 3.1
 *
 * Fornece uma interface estruturada de sinais baseados no desempenho
 * do aluno, que futuramente alimentarão o score do planner adaptativo.
 *
 * Nesta etapa, o planner existente NÃO é alterado.
 * Este módulo apenas PREPARA os dados.
 */

import type { KnowledgeState } from "./engine";
import type { ErrorAnalysis } from "./errors";

export type PlannerSignals = {
  /** Domínio estimado (0..1) */
  mastery: number;
  /** Confiança na estimativa (0..1) */
  confidence: number;
  /** Taxa de acerto (0..1) */
  accuracy: number;
  /** Quantidade de erros recentes (últimos 30 dias) */
  recentErrors: number;
  /** Quantidade de erros não resolvidos */
  unresolvedErrors: number;
  /** Quantidade de erros recorrentes */
  recurringErrors: number;
  /** Dias desde o último estudo */
  daysSinceStudy: number | null;
  /** Dias desde o último erro */
  daysSinceError: number | null;
  /** Total de questões respondidas */
  questionCount: number;
  /** Quantidade de revisões realizadas */
  reviewCount: number;
};

/**
 * Constrói os sinais a partir do estado de conhecimento e análise de erros.
 *
 * @param knowledge - Estado atual do conhecimento para o tópico
 * @param errorAnalysis - Análise de erros do tópico (pode ser null se sem erros)
 * @param reviewCount - Quantidade de revisões (de review_events)
 * @param referenceDate - Data de referência para cálculos temporais
 */
export function buildSignals(
  knowledge: KnowledgeState | null,
  errorAnalysis: ErrorAnalysis | null,
  reviewCount: number,
  referenceDate: string,
): PlannerSignals {
  const k = knowledge ?? {
    mastery: 0,
    confidence: 0,
    totalQuestions: 0,
    correctQuestions: 0,
    lastStudiedAt: null,
  };

  const accuracy = k.totalQuestions > 0 ? k.correctQuestions / k.totalQuestions : 0;

  let daysSinceStudy: number | null = null;
  if (k.lastStudiedAt) {
    const diff = new Date(referenceDate).getTime() - new Date(k.lastStudiedAt).getTime();
    daysSinceStudy = Math.max(0, Math.round(diff / 86_400_000));
  }

  return {
    mastery: k.mastery,
    confidence: k.confidence,
    accuracy,
    recentErrors: errorAnalysis?.totalErrors ?? 0,
    unresolvedErrors: errorAnalysis?.unresolvedErrors ?? 0,
    recurringErrors: errorAnalysis?.recurringErrors ?? 0,
    daysSinceStudy,
    daysSinceError: errorAnalysis?.daysSinceLastError ?? null,
    questionCount: k.totalQuestions,
    reviewCount,
  };
}
