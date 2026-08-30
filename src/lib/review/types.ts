/**
 * TIPOS DO REVIEW ENGINE — Etapa 4, Fase 1
 *
 * Tipos fortemente tipados para a camada de revisão adaptativa.
 * O Review Engine NÃO duplica responsabilidades existentes:
 *   KNOWLEDGE → "Quanto o aluno domina?"
 *   DIAGNOSIS → "Qual é o estado pedagógico?"
 *   PLANNER   → "O que deve ser estudado?"
 *   REVIEW    → "Quando isso deve ser revisado?"
 */

import type { KnowledgeStateName } from "../diagnosis/engine";

// ─────────────────────────────────────────────────────────────────────────────
// ENTRADA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sinais consumidos pelo Review Engine para calcular a decisão de revisão.
 * Todos os campos vêm dos motores existentes (Knowledge, Diagnosis, Planner).
 * Nenhum é recalculado aqui.
 */
export type TopicReviewInput = {
  /** Identificador do tópico */
  topicId: string;
  /** Domínio estimado (0..1), do Knowledge Engine */
  mastery: number;
  /** Confiança na estimativa (0..1), do Knowledge Engine */
  confidence: number;
  /** Taxa de acerto observada (0..1) */
  accuracy: number;
  /** Estado pedagógico do Diagnostic Engine (null = sem diagnóstico) */
  knowledgeState: KnowledgeStateName | null;
  /** Intervention score normalizado 0..1, do Diagnostic Engine */
  interventionScore: number;
  /** Dias desde o último estudo (null = sem dados) */
  daysSinceStudy: number | null;
  /** Quantidade de erros não resolvidos */
  unresolvedErrors: number;
  /** Quantidade de erros recorrentes */
  recurringErrors: number;
  /** Data da última revisão no formato ISO (null = nunca revisado) */
  lastReviewDate: string | null;
  /** Quantidade de revisões já realizadas */
  reviewCount: number;
  /** Resultado da última revisão (null = sem histórico) */
  lastReviewResult: "success" | "partial" | "fail" | null;
  /** Data de referência para todos os cálculos temporais (ISO string) */
  referenceDate: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// SAÍDA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decisão de revisão calculada pelo Review Engine.
 * Todos os campos são determinísticos e derivados exclusivamente do input.
 */
export type TopicReviewDecision = {
  /** Se o tópico precisa de revisão */
  needsReview: boolean;
  /** Urgência da revisão (0..1, onde 1 = máxima urgência) */
  reviewUrgency: number;
  /** Data sugerida para a próxima revisão (ISO string) */
  suggestedReviewDate: string;
  /** Intervalo calculado em dias até a próxima revisão */
  reviewInterval: number;
  /** Razão explicativa determinística */
  reviewReason: string;
  /** Intensidade recomendada para a sessão de revisão */
  reviewIntensity: "leve" | "moderada" | "intensiva";
  /** Tipo de revisão recomendada */
  reviewType: "manutencao" | "consolidacao" | "recuperacao" | "erro_direcionado";
};
