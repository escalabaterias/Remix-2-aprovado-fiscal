/**
 * MOTOR DETERMINÍSTICO DE PRIORIZAÇÃO DE ERROS — Central de Erros, Fase 1
 *
 * Calcula um score de prioridade (0..1) para cada error_entry,
 * combinando 5 fatores pedagógicos com pesos fixos.
 *
 * REUTILIZA:
 *   - analyzeTopicErrors()  (knowledge/errors.ts) — análise de recorrência e categorias
 *   - isRecurringError()    (knowledge/errors.ts) — detecção de recorrência individual
 *   - ErrorRecord, ErrorAnalysis (knowledge/errors.ts) — tipos existentes
 *   - KnowledgeState        (knowledge/engine.ts)  — estado de domínio do tópico
 *
 * NÃO DUPLICA nenhuma regra pedagógica existente.
 *
 * FATORES E PESOS:
 *   1. Recorrência        (0.30) — erro que reaparece após resolução é mais grave
 *   2. Impacto no mastery  (0.25) — tópico com baixo domínio/confidence amplifica
 *   3. Frequência          (0.20) — categoria que aparece muitas vezes no tópico
 *   4. Recência            (0.15) — erros recentes são mais acionáveis
 *   5. Status              (0.10) — não resolvido > resolvido
 *
 * PROPRIEDADES:
 *   - Score sempre entre 0 e 1
 *   - Determinístico: mesmo input → mesmo output
 *   - Sem dependência externa (puro)
 *   - Sem I/O (a camada de serviço busca dados e passa para cá)
 */

import type { KnowledgeState } from "../knowledge/engine";
import {
  analyzeTopicErrors,
  isRecurringError,
  type ErrorRecord,
  type ErrorAnalysis,
} from "../knowledge/errors";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

/** Fatores que compõem o score de prioridade de um erro. */
export type PriorityFactors = {
  /** Fator de recorrência (0 ou 1). Erro recorrente = 1. */
  recurrence: number;
  /** Fator de impacto no mastery (0..1). Tópico fraco = valor alto. */
  masteryImpact: number;
  /** Fator de frequência da categoria no tópico (0..1). */
  categoryFrequency: number;
  /** Fator de recência (0..1). Erro recente = valor alto. */
  recency: number;
  /** Fator de status (0 ou 1). Não resolvido = 1. */
  status: number;
};

/** Resultado da priorização de um erro individual. */
export type PrioritizedError = {
  /** O error_entry original. */
  error: ErrorRecord;
  /** Score de prioridade (0..1). */
  score: number;
  /** Detalhamento dos fatores. */
  factors: PriorityFactors;
};

/** Resumo de erros de um tópico para a UI. */
export type TopicErrorSummary = {
  topicId: string;
  analysis: ErrorAnalysis;
  /** Score médio de prioridade dos erros do tópico. */
  avgPriority: number;
  /** Score máximo de prioridade dos erros do tópico. */
  maxPriority: number;
  /** Quantidade de erros priorizados. */
  errorCount: number;
};

/** Mapa de topicId → KnowledgeState para lookup. */
export type KnowledgeMap = Map<string, KnowledgeState>;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES — PESOS DOS FATORES
// ─────────────────────────────────────────────────────────────────────────────

/** Peso do fator de recorrência no score final. */
export const WEIGHT_RECURRENCE = 0.30;
/** Peso do fator de impacto no mastery. */
export const WEIGHT_MASTERY_IMPACT = 0.25;
/** Peso do fator de frequência da categoria. */
export const WEIGHT_CATEGORY_FREQUENCY = 0.20;
/** Peso do fator de recência. */
export const WEIGHT_RECENCY = 0.15;
/** Peso do fator de status. */
export const WEIGHT_STATUS = 0.10;

/**
 * Constante de decaimento para recência (em dias).
 * Meia-vida: ~14 dias (recency = 0.5 após 14 dias).
 * Fórmula: e^(-days / RECENCY_HALF_LIFE_DAYS * ln(2))
 */
const RECENCY_HALF_LIFE_DAYS = 14;

/**
 * Limiar de frequência para normalização.
 * Se uma categoria aparece >= FREQUENCY_CAP vezes, o fator é 1.0.
 */
const FREQUENCY_CAP = 5;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Calcula o fator de recência (0..1) com decaimento exponencial.
 * Erro ocorrido hoje → ~1.0
 * Erro há 14 dias   → ~0.5
 * Erro há 60 dias   → ~0.05
 */
export function computeRecencyFactor(occurredAt: string, referenceDate: string): number {
  const diffMs = new Date(referenceDate).getTime() - new Date(occurredAt).getTime();
  const days = Math.max(0, diffMs / 86_400_000);
  return clamp01(Math.exp((-days * Math.LN2) / RECENCY_HALF_LIFE_DAYS));
}

/**
 * Calcula o fator de impacto no mastery (0..1).
 * Tópico com mastery baixo e confidence alta → impacto alto (o aluno
 * tem evidência de que está fraco).
 * Tópico sem dados → impacto moderado (0.5).
 *
 * Fórmula: (1 - mastery) * confidence_weight
 *   onde confidence_weight = 0.5 + 0.5 * confidence
 *   (sem confidence, o impacto é metade; com confidence alta, é pleno)
 */
export function computeMasteryImpactFactor(knowledge: KnowledgeState | null): number {
  if (!knowledge) return 0.5; // sem dados → impacto moderado
  const confidenceWeight = 0.5 + 0.5 * knowledge.confidence;
  return clamp01((1 - knowledge.mastery) * confidenceWeight);
}

/**
 * Calcula o fator de frequência da categoria no tópico (0..1).
 * Normaliza pela constante FREQUENCY_CAP.
 */
export function computeCategoryFrequencyFactor(
  categoryCount: number,
): number {
  if (categoryCount <= 0) return 0;
  return clamp01(categoryCount / FREQUENCY_CAP);
}

// ─────────────────────────────────────────────────────────────────────────────
// API PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula o score de prioridade de um único error_entry.
 *
 * @param error       - O error_entry a priorizar.
 * @param allErrors   - Todos os error_entries do usuário (necessário para
 *                      recorrência e frequência via analyzeTopicErrors).
 * @param knowledge   - Estado de conhecimento do tópico (pode ser null).
 * @param referenceDate - Data de referência para cálculos temporais (ISO).
 *
 * Determinístico: mesmo input → mesmo output.
 */
export function computeErrorPriority(
  error: ErrorRecord,
  allErrors: ErrorRecord[],
  knowledge: KnowledgeState | null,
  referenceDate: string,
): PrioritizedError {
  // 1. Recorrência — reutiliza isRecurringError() de knowledge/errors.ts
  const recurrence = isRecurringError(error, allErrors) ? 1 : 0;

  // 2. Impacto no mastery
  const masteryImpact = computeMasteryImpactFactor(knowledge);

  // 3. Frequência da categoria no tópico
  let categoryFrequency = 0;
  if (error.topicId && error.category) {
    // Reutiliza analyzeTopicErrors() para obter a frequência
    const analysis = analyzeTopicErrors(allErrors, error.topicId, referenceDate);
    const count = analysis.categoryFrequency.get(error.category) ?? 0;
    categoryFrequency = computeCategoryFrequencyFactor(count);
  }

  // 4. Recência
  const recency = computeRecencyFactor(error.occurredAt, referenceDate);

  // 5. Status
  const status = error.isResolved ? 0 : 1;

  // Score composto
  const score = clamp01(
    WEIGHT_RECURRENCE * recurrence +
    WEIGHT_MASTERY_IMPACT * masteryImpact +
    WEIGHT_CATEGORY_FREQUENCY * categoryFrequency +
    WEIGHT_RECENCY * recency +
    WEIGHT_STATUS * status,
  );

  const factors: PriorityFactors = {
    recurrence,
    masteryImpact,
    categoryFrequency,
    recency,
    status,
  };

  return { error, score, factors };
}

/**
 * Prioriza uma lista de error_entries, retornando-os ordenados por score
 * decrescente (maior prioridade primeiro).
 *
 * @param errors        - Lista de error_entries do usuário.
 * @param knowledgeMap  - Mapa topicId → KnowledgeState.
 * @param referenceDate - Data de referência (ISO).
 *
 * Determinístico: mesmos inputs → mesma ordenação.
 */
export function prioritizeErrors(
  errors: ErrorRecord[],
  knowledgeMap: KnowledgeMap,
  referenceDate: string,
): PrioritizedError[] {
  if (errors.length === 0) return [];

  const prioritized = errors.map((error) => {
    const knowledge = error.topicId ? (knowledgeMap.get(error.topicId) ?? null) : null;
    return computeErrorPriority(error, errors, knowledge, referenceDate);
  });

  // Ordenação estável por score decrescente.
  // Em caso de empate, mantém a ordem original (estabilidade do sort JS
  // é garantida pelo spec desde ES2019).
  prioritized.sort((a, b) => b.score - a.score);

  return prioritized;
}

/**
 * Agrega os erros de cada tópico em um resumo para a UI da Central de Erros.
 *
 * Reutiliza analyzeTopicErrors() e prioritizeErrors().
 *
 * @param errors        - Todos os error_entries do usuário.
 * @param knowledgeMap  - Mapa topicId → KnowledgeState.
 * @param referenceDate - Data de referência (ISO).
 */
export function computeTopicErrorSummaries(
  errors: ErrorRecord[],
  knowledgeMap: KnowledgeMap,
  referenceDate: string,
): TopicErrorSummary[] {
  // Agrupar por topicId
  const topicIds = new Set<string>();
  for (const e of errors) {
    if (e.topicId) topicIds.add(e.topicId);
  }

  const summaries: TopicErrorSummary[] = [];

  for (const topicId of topicIds) {
    const topicErrors = errors.filter((e) => e.topicId === topicId);
    const analysis = analyzeTopicErrors(errors, topicId, referenceDate);

    // Priorizar os erros deste tópico
    const prioritized = topicErrors.map((error) => {
      const knowledge = knowledgeMap.get(topicId) ?? null;
      return computeErrorPriority(error, errors, knowledge, referenceDate);
    });

    if (prioritized.length === 0) continue;

    const scores = prioritized.map((p) => p.score);
    const avgPriority = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const maxPriority = Math.max(...scores);

    summaries.push({
      topicId,
      analysis,
      avgPriority,
      maxPriority,
      errorCount: prioritized.length,
    });
  }

  // Ordenar por maxPriority decrescente
  summaries.sort((a, b) => b.maxPriority - a.maxPriority);

  return summaries;
}
