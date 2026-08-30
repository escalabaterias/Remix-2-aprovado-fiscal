/**
 * MOTOR DETERMINÍSTICO DE REVISÃO — Etapa 4, Fase 1
 *
 * Calcula QUANDO um tópico deve ser revisado, consumindo sinais
 * já produzidos pelo Knowledge Engine, Diagnostic Engine e Planner.
 *
 * PRINCÍPIOS:
 * - Função pura: mesmo input → mesmo output, sempre.
 * - Sem Date.now(), new Date(), Math.random().
 * - Sem Supabase, banco, rede, estado global.
 * - Todas as datas derivadas exclusivamente de input.referenceDate.
 * - Todos os valores protegidos contra NaN, Infinity, negativos.
 * - Constantes centralizadas e documentadas para ajuste futuro.
 *
 * RESPONSABILIDADE:
 *   KNOWLEDGE → "Quanto o aluno domina?"
 *   DIAGNOSIS → "Qual é o estado pedagógico?"
 *   PLANNER   → "O que deve ser estudado?"
 *   REVIEW    → "Quando isso deve ser revisado?"
 */

import type { KnowledgeStateName } from "../diagnosis/engine";
import type { TopicReviewInput, TopicReviewDecision } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES — INTERVALOS BASE POR ESTADO PEDAGÓGICO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Intervalo base em dias para cada estado pedagógico.
 * Estes valores são o ponto de partida antes dos fatores multiplicativos.
 * Podem ser ajustados sem reescrever o motor.
 *
 * SEM_EVIDENCIA:        0 — não agendar revisão (sem base para revisar).
 * RISCO_ESQUECIMENTO:   2 — intervalo muito curto (urgência alta).
 * PONTO_CRITICO:        3 — intervalo curto (precisa intervenção).
 * INSTAVEL:             4 — intervalo curto (desempenho oscilante).
 * APRENDIZAGEM:         5 — intervalo curto (ainda construindo base).
 * CONSOLIDANDO:        10 — intervalo intermediário.
 * DOMINADO:            21 — intervalo longo (manutenção).
 */
export const BASE_INTERVALS: Record<KnowledgeStateName, number> = {
  SEM_EVIDENCIA: 0,
  RISCO_ESQUECIMENTO: 2,
  PONTO_CRITICO: 3,
  INSTAVEL: 4,
  APRENDIZAGEM: 5,
  CONSOLIDANDO: 10,
  DOMINADO: 21,
} as const;

/**
 * Intervalo padrão quando não há diagnóstico (knowledgeState === null).
 * Assume um valor conservador (curto) para não ignorar tópicos sem dados.
 */
export const DEFAULT_INTERVAL_NO_DIAGNOSIS = 7;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES — FATORES DE AJUSTE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fator de resultado da última revisão.
 * Sucesso permite espaçar mais; falha comprime o intervalo.
 *
 * success: 1.3 — bom resultado, pode espaçar.
 * partial: 1.0 — neutro.
 * fail:    0.6 — reduziu retenção, revisão mais frequente.
 * null:    0.9 — sem histórico, ligeiramente conservador.
 */
export const REVIEW_RESULT_FACTORS: Record<string, number> = {
  success: 1.3,
  partial: 1.0,
  fail: 0.6,
  none: 0.9,
} as const;

/**
 * Peso dos erros recorrentes na redução do intervalo.
 * recurringErrorFactor = 1 / (1 + RECURRING_ERROR_WEIGHT * recurringErrors)
 */
export const RECURRING_ERROR_WEIGHT = 0.3;

/**
 * Peso dos erros não resolvidos na redução do intervalo.
 * unresolvedErrorFactor = 1 / (1 + UNRESOLVED_ERROR_WEIGHT * unresolvedErrors)
 */
export const UNRESOLVED_ERROR_WEIGHT = 0.2;

/**
 * Incremento por revisão realizada no fator de espaçamento.
 * reviewCountFactor = 1 + min(reviewCount, MAX_REVIEW_COUNT_FACTOR) * REVIEW_COUNT_INCREMENT
 *
 * Cada revisão permite espaçar ligeiramente mais, até um teto.
 */
export const REVIEW_COUNT_INCREMENT = 0.05;

/**
 * Número máximo de revisões contabilizadas no fator de espaçamento.
 */
export const MAX_REVIEW_COUNT_FACTOR = 10;

/**
 * Limiar de urgência para considerar que uma revisão é necessária.
 */
export const URGENCY_THRESHOLD = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS PUROS
// ─────────────────────────────────────────────────────────────────────────────

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Garante que o valor é finito e não NaN. */
function safeFinite(v: number, fallback: number): number {
  if (Number.isFinite(v)) return v;
  return fallback;
}

/** Calcula dias entre duas datas ISO. Resultado sempre >= 0. */
function daysBetweenISO(a: string, b: string): number {
  const msA = Date.parse(a);
  const msB = Date.parse(b);
  if (!Number.isFinite(msA) || !Number.isFinite(msB)) return 0;
  return Math.max(0, Math.round((msB - msA) / 86_400_000));
}

/**
 * Adiciona dias a uma data ISO e retorna string ISO (YYYY-MM-DD).
 *
 * Robustez (pura e determinística):
 * - `days` não finito (NaN/Infinity) é tratado como 0.
 * - `days` é truncado para inteiro e limitado a ±MAX_DAY_SHIFT, evitando
 *   estouro do range do objeto Date (RangeError: Invalid time value).
 * - Qualquer resultado fora do range válido de Date retorna a data original.
 */
export const MAX_DAY_SHIFT = 36_500; // ~100 anos

function addDaysISO(date: string, days: number): string {
  const ms = Date.parse(date);
  if (!Number.isFinite(ms)) return date;

  const rawDays = Number.isFinite(days) ? Math.trunc(days) : 0;
  const safeDays = Math.max(-MAX_DAY_SHIFT, Math.min(MAX_DAY_SHIFT, rawDays));

  const resultMs = ms + safeDays * 86_400_000;
  if (!Number.isFinite(resultMs)) return date;

  const result = new Date(resultMs);
  if (Number.isNaN(result.getTime())) return date;

  return result.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// CÁLCULO DO INTERVALO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula o intervalo de revisão em dias.
 *
 * Fórmula:
 *   base = BASE_INTERVALS[knowledgeState] (ou DEFAULT se null)
 *   masteryFactor = 0.5 + mastery
 *   confidenceFactor = 0.6 + 0.4 * confidence
 *   resultFactor = REVIEW_RESULT_FACTORS[lastReviewResult ?? 'none']
 *   recurringFactor = 1 / (1 + 0.3 * recurringErrors)
 *   unresolvedFactor = 1 / (1 + 0.2 * unresolvedErrors)
 *   countFactor = 1 + min(reviewCount, 10) * 0.05
 *   interval = max(1, round(base * masteryFactor * confidenceFactor
 *              * resultFactor * recurringFactor * unresolvedFactor * countFactor))
 *
 * Para SEM_EVIDENCIA, retorna 0 (sem revisão agendada).
 */
export function computeReviewInterval(input: TopicReviewInput): number {
  const state = input.knowledgeState;

  // SEM_EVIDENCIA: sem base para revisão
  if (state === "SEM_EVIDENCIA") return 0;

  const base = state !== null ? BASE_INTERVALS[state] : DEFAULT_INTERVAL_NO_DIAGNOSIS;

  // Se o base for 0 (segurança), retorna 0
  if (base === 0) return 0;

  const mastery = clamp01(safeFinite(input.mastery, 0));
  const confidence = clamp01(safeFinite(input.confidence, 0));

  // Fatores multiplicativos
  const masteryFactor = 0.5 + mastery; // 0.5..1.5
  const confidenceFactor = 0.6 + 0.4 * confidence; // 0.6..1.0

  const resultKey = input.lastReviewResult ?? "none";
  const resultFactor = safeFinite(
    REVIEW_RESULT_FACTORS[resultKey] ?? REVIEW_RESULT_FACTORS["none"]!,
    0.9,
  );

  const recurringErrors = Math.max(0, safeFinite(input.recurringErrors, 0));
  const recurringFactor = 1 / (1 + RECURRING_ERROR_WEIGHT * recurringErrors);

  const unresolvedErrors = Math.max(0, safeFinite(input.unresolvedErrors, 0));
  const unresolvedFactor = 1 / (1 + UNRESOLVED_ERROR_WEIGHT * unresolvedErrors);

  const reviewCount = Math.max(0, safeFinite(input.reviewCount, 0));
  const countFactor = 1 + Math.min(reviewCount, MAX_REVIEW_COUNT_FACTOR) * REVIEW_COUNT_INCREMENT;

  const raw =
    base *
    masteryFactor *
    confidenceFactor *
    resultFactor *
    recurringFactor *
    unresolvedFactor *
    countFactor;

  const interval = Math.max(1, Math.round(safeFinite(raw, 1)));
  return interval;
}

// ─────────────────────────────────────────────────────────────────────────────
// CÁLCULO DA URGÊNCIA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fração da urgência atribuída à rampa até a data de revisão.
 * Ao atingir exatamente a data prevista, a urgência vale DUE_DATE_URGENCY.
 * O restante (1 - DUE_DATE_URGENCY) é reservado para o atraso, de forma
 * assintótica, para que atrasos maiores continuem produzindo urgências
 * estritamente maiores sem nunca ultrapassar 1.
 */
export const DUE_DATE_URGENCY = 0.9;

/**
 * Calcula a urgência de revisão (0..1).
 *
 * Lógica:
 *   Se há uma lastReviewDate, calcula dias desde a última revisão.
 *   Se não, usa daysSinceStudy como proxy.
 *   Se nenhum dado temporal existe, usa 0.5 (conservador).
 *
 *   ratio = diasPassados / interval
 *   ratio <= 1 → urgency = DUE_DATE_URGENCY * ratio          (rampa linear)
 *   ratio  > 1 → urgency = DUE_DATE_URGENCY
 *                        + (1 - DUE_DATE_URGENCY) * (1 - 1/(1 + (ratio - 1)))
 *
 *   A curva é contínua em ratio = 1, monotônica crescente e sempre < 1
 *   quando há atraso finito. Isso preserva a semântica anterior
 *   ("quanto mais atrasado, mais urgente") e corrige a saturação em 1,
 *   que apagava a informação temporal de atrasos distintos.
 *
 * Para SEM_EVIDENCIA (interval=0), urgência = 0.
 */
export function computeReviewUrgency(input: TopicReviewInput, interval: number): number {
  if (interval <= 0) return 0;

  let daysSinceLastReview: number;

  if (input.lastReviewDate !== null) {
    daysSinceLastReview = daysBetweenISO(input.lastReviewDate, input.referenceDate);
  } else if (input.daysSinceStudy !== null) {
    daysSinceLastReview = Math.max(0, safeFinite(input.daysSinceStudy, 0));
  } else {
    // Sem dados temporais: assume urgência intermediária
    return 0.5;
  }

  const ratio = safeFinite(daysSinceLastReview / interval, 0);

  const urgency =
    ratio <= 1
      ? DUE_DATE_URGENCY * ratio
      : DUE_DATE_URGENCY + (1 - DUE_DATE_URGENCY) * (1 - 1 / ratio);

  return clamp01(safeFinite(urgency, 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICAÇÃO DO TIPO DE REVISÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determina o tipo de revisão com base nos sinais.
 *
 * erro_direcionado: erros não resolvidos + recorrentes dominam a necessidade.
 * recuperacao: estados críticos (PONTO_CRITICO, RISCO_ESQUECIMENTO).
 * consolidacao: em fase de aprendizagem ou consolidação.
 * manutencao: domínio elevado.
 */
export function classifyReviewType(input: TopicReviewInput): TopicReviewDecision["reviewType"] {
  const totalErrors = (input.unresolvedErrors ?? 0) + (input.recurringErrors ?? 0);

  // Erros dominam: se há erros significativos E eles representam
  // o principal problema (estado não é DOMINADO)
  if (totalErrors >= 3 && input.knowledgeState !== "DOMINADO") {
    return "erro_direcionado";
  }

  if (
    totalErrors >= 1 &&
    input.knowledgeState !== "DOMINADO" &&
    input.knowledgeState !== "CONSOLIDANDO" &&
    input.knowledgeState !== "SEM_EVIDENCIA" &&
    (input.mastery < 0.4 || input.recurringErrors >= 2)
  ) {
    return "erro_direcionado";
  }

  const state = input.knowledgeState;
  if (state === "PONTO_CRITICO" || state === "RISCO_ESQUECIMENTO") {
    return "recuperacao";
  }

  if (state === "CONSOLIDANDO" || state === "APRENDIZAGEM" || state === "INSTAVEL") {
    return "consolidacao";
  }

  if (state === "DOMINADO") {
    return "manutencao";
  }

  // null ou SEM_EVIDENCIA que passou (não deveria chegar aqui para SEM_EVIDENCIA)
  if (input.mastery >= 0.7) return "manutencao";
  if (input.mastery >= 0.4) return "consolidacao";
  return "recuperacao";
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICAÇÃO DA INTENSIDADE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determina a intensidade da sessão de revisão.
 *
 * intensiva:
 *   - estados críticos (PONTO_CRITICO, RISCO_ESQUECIMENTO); ou
 *   - urgência >= 0.7 ACOMPANHADA de um sinal de risco real
 *     (domínio insuficiente, erros pendentes/recorrentes ou última
 *     revisão insatisfatória).
 *   Urgência alta sozinha significa apenas "está na hora"; não justifica
 *   sessão intensiva quando o desempenho está adequado.
 * leve: urgência < 0.3 com domínio consolidado.
 * moderada: demais casos.
 */
export function classifyReviewIntensity(
  input: TopicReviewInput,
  urgency: number,
): TopicReviewDecision["reviewIntensity"] {
  const state = input.knowledgeState;

  if (state === "PONTO_CRITICO" || state === "RISCO_ESQUECIMENTO") {
    return "intensiva";
  }

  const hasRiskSignal =
    input.mastery < 0.5 ||
    (input.unresolvedErrors ?? 0) > 0 ||
    (input.recurringErrors ?? 0) > 0 ||
    input.lastReviewResult === "fail";

  if (urgency >= 0.7 && hasRiskSignal) {
    return "intensiva";
  }

  if (urgency < 0.3 && state === "DOMINADO") {
    return "leve";
  }

  if (urgency < 0.3 && input.mastery >= 0.7 && input.confidence >= 0.7) {
    return "leve";
  }

  return "moderada";
}

// ─────────────────────────────────────────────────────────────────────────────
// GERAÇÃO DA RAZÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gera uma razão determinística e explicável para a decisão de revisão.
 * Baseada nos sinais reais do input. Sem textos aleatórios.
 */
export function buildReviewReason(input: TopicReviewInput, urgency: number): string {
  const state = input.knowledgeState;

  if (state === "SEM_EVIDENCIA") {
    return "Sem evidência suficiente para agendar revisão.";
  }

  const parts: string[] = [];

  // Estado pedagógico
  switch (state) {
    case "PONTO_CRITICO":
      parts.push("Ponto crítico identificado");
      break;
    case "RISCO_ESQUECIMENTO":
      parts.push("Risco de esquecimento detectado");
      break;
    case "INSTAVEL":
      parts.push("Desempenho instável");
      break;
    case "APRENDIZAGEM":
      parts.push("Tópico em fase de aprendizagem");
      break;
    case "CONSOLIDANDO":
      parts.push("Conhecimento em consolidação");
      break;
    case "DOMINADO":
      parts.push("Domínio elevado");
      break;
    default:
      parts.push("Sem diagnóstico disponível");
      break;
  }

  // Sinais adicionais
  if (input.recurringErrors > 0) {
    parts.push(`${input.recurringErrors} erro(s) recorrente(s)`);
  }
  if (input.unresolvedErrors > 0) {
    parts.push(`${input.unresolvedErrors} erro(s) não resolvido(s)`);
  }
  if (input.confidence < 0.4) {
    parts.push("baixa confiança na estimativa");
  }
  if (input.daysSinceStudy !== null && input.daysSinceStudy > 21) {
    parts.push(`${input.daysSinceStudy} dias sem estudo`);
  }
  if (input.lastReviewResult === "fail") {
    parts.push("última revisão com resultado insatisfatório");
  }

  // Urgência
  if (urgency >= 0.8) {
    parts.push("urgência alta");
  } else if (urgency >= 0.5) {
    parts.push("revisão recomendada");
  }

  if (parts.length === 1) {
    if (state === "DOMINADO") return "Domínio elevado; revisão de manutenção programada.";
    return parts[0] + "; revisão recomendada.";
  }

  return parts.join("; ") + ".";
}

// ─────────────────────────────────────────────────────────────────────────────
// DECISÃO DE NECESSIDADE DE REVISÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determina se o tópico precisa de revisão.
 *
 * Regras:
 * - SEM_EVIDENCIA: nunca gera revisão artificial.
 * - Urgência >= URGENCY_THRESHOLD: precisa de revisão.
 * - Estados PONTO_CRITICO ou RISCO_ESQUECIMENTO: sempre revisão.
 * - DOMINADO recente com boa evidência: não precisa se urgência baixa.
 */
export function computeNeedsReview(
  input: TopicReviewInput,
  urgency: number,
  interval: number,
): boolean {
  // SEM_EVIDENCIA não gera revisão
  if (input.knowledgeState === "SEM_EVIDENCIA") return false;
  if (interval <= 0) return false;

  // Estados críticos sempre precisam de revisão
  if (input.knowledgeState === "PONTO_CRITICO" || input.knowledgeState === "RISCO_ESQUECIMENTO") {
    return true;
  }

  // Urgência acima do limiar
  if (urgency >= URGENCY_THRESHOLD) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula a decisão de revisão para um tópico.
 *
 * Esta função é PURA e DETERMINÍSTICA:
 * - Mesmo input → mesmo output, sempre.
 * - Sem efeitos colaterais.
 * - Sem Date.now(), new Date(), Math.random().
 * - Sem Supabase, banco, rede ou estado global.
 * - Todas as datas derivadas de input.referenceDate.
 *
 * @param input - Sinais do tópico (todos vindos dos motores existentes)
 * @returns TopicReviewDecision completa
 */
export function computeReviewDecision(input: TopicReviewInput): TopicReviewDecision {
  const interval = computeReviewInterval(input);
  const urgency = computeReviewUrgency(input, interval);
  const needsReview = computeNeedsReview(input, urgency, interval);
  const reviewType = classifyReviewType(input);
  const reviewIntensity = classifyReviewIntensity(input, urgency);
  const reviewReason = buildReviewReason(input, urgency);

  // Data sugerida: referenceDate + diasRestantes (ou referenceDate se revisão imediata)
  let suggestedReviewDate: string;
  if (interval <= 0) {
    // SEM_EVIDENCIA ou sem revisão necessária
    suggestedReviewDate = input.referenceDate;
  } else if (needsReview && urgency >= 0.9) {
    // Urgência muito alta: revisão imediata
    suggestedReviewDate = input.referenceDate;
  } else {
    // Calcula baseado na última revisão ou estudo
    let anchor: string;
    if (input.lastReviewDate !== null) {
      anchor = input.lastReviewDate;
    } else if (input.daysSinceStudy !== null) {
      // Reconstituir a data do último estudo
      anchor = addDaysISO(input.referenceDate, -input.daysSinceStudy);
    } else {
      anchor = input.referenceDate;
    }
    suggestedReviewDate = addDaysISO(anchor, interval);

    // Se a data sugerida já passou, agendar para a referenceDate
    if (suggestedReviewDate < input.referenceDate) {
      suggestedReviewDate = input.referenceDate;
    }
  }

  return {
    needsReview,
    reviewUrgency: safeFinite(urgency, 0),
    suggestedReviewDate,
    reviewInterval: Math.max(interval <= 0 ? 0 : 1, interval),
    reviewReason,
    reviewIntensity,
    reviewType,
  };
}
