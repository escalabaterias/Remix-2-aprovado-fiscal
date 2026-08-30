/**
 * CAMADA DE INTELIGÊNCIA DO PLANNER — Etapa 3.3, Fase 1
 *
 * Função pura que calcula um boost diagnóstico para cada tópico,
 * permitindo ao planner priorizar com base nos sinais pedagógicos
 * do Diagnostic Engine (Etapa 3.2).
 *
 * PRINCÍPIOS:
 * - Função pura: mesmo input → mesmo output, sempre.
 * - Sem acesso a Supabase, banco, Date.now(), Math.random(), estado global.
 * - Todos os pesos e constantes são centralizados.
 * - Todos os sinais são normalizados para 0..1.
 * - O resultado é determinístico e finito.
 *
 * ARQUITETURA DO BOOST:
 *   finalScore = baseScore + diagnosticBoost
 *
 *   diagnosticBoost =
 *     STATE_WEIGHT       * stateComponent
 *   + INTERVENTION_WEIGHT * interventionComponent
 *   + MASTERY_GAP_WEIGHT  * masteryGapComponent
 *   + ERROR_WEIGHT        * errorComponent
 *   + RECURRENCE_WEIGHT   * recurrenceComponent
 *   + RECENCY_WEIGHT      * recencyComponent
 *
 * Cada componente está em 0..1. O boost máximo possível é a soma
 * dos pesos (1.0), o que garante que o boost não destrói o score
 * estrutural do planner.
 */

import type { KnowledgeStateName } from "../diagnosis/engine";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS DE ENTRADA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sinais mínimos que a camada de inteligência precisa.
 * Não recebe objetos do banco — apenas os dados necessários.
 */
export type IntelligenceInput = {
  /** Score estrutural calculado pelo planner (fase 1 do engine) */
  baseScore: number;
  /** Estado pedagógico do tópico, vindo do Diagnostic Engine */
  knowledgeState: KnowledgeStateName | null;
  /** Mastery do tópico (0..1) */
  mastery: number;
  /** Confidence na estimativa (0..1) */
  confidence: number;
  /** Taxa de acerto observada (0..1) */
  accuracy: number;
  /** Quantidade de erros recentes */
  recentErrors: number;
  /** Quantidade de erros não resolvidos */
  unresolvedErrors: number;
  /** Quantidade de erros recorrentes */
  recurringErrors: number;
  /** Dias desde o último estudo (null = sem dados) */
  daysSinceStudy: number | null;
  /** Dias desde o último erro (null = sem dados) */
  daysSinceError: number | null;
  /** Intervention score normalizado 0..1, do Diagnostic Engine */
  interventionScore: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS DE SAÍDA
// ─────────────────────────────────────────────────────────────────────────────

export type IntelligenceOutput = {
  /** Boost diagnóstico calculado (sempre >= 0) */
  diagnosticBoost: number;
  /** Score final: baseScore + diagnosticBoost */
  finalScore: number;
  /** Explicação determinística do resultado */
  reason: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES — BOOST POR ESTADO PEDAGÓGICO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Boost base associado a cada estado pedagógico.
 * Normalizado: o maior valor (PONTO_CRITICO = 1.00) corresponde
 * ao componente máximo (1.0 após normalização).
 *
 * PONTO_CRITICO:        máxima urgência
 * RISCO_ESQUECIMENTO:   urgência alta
 * INSTAVEL:             urgência alta
 * APRENDIZAGEM:         urgência moderada
 * CONSOLIDANDO:         urgência moderada
 * SEM_EVIDENCIA:        urgência moderada (precisa construir base)
 * DOMINADO:             urgência mínima
 */
export const STATE_BOOST: Record<KnowledgeStateName, number> = {
  PONTO_CRITICO: 1.0,
  RISCO_ESQUECIMENTO: 0.75,
  INSTAVEL: 0.65,
  APRENDIZAGEM: 0.4,
  CONSOLIDANDO: 0.35,
  SEM_EVIDENCIA: 0.3,
  DOMINADO: 0.05,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES — PESOS DOS COMPONENTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pesos de cada componente no cálculo do diagnosticBoost.
 * A soma é 1.0, portanto o boost máximo possível é 1.0.
 */
export const COMPONENT_WEIGHTS = {
  /** Peso do estado pedagógico no boost */
  STATE: 0.4,
  /** Peso do intervention_score */
  INTERVENTION: 0.15,
  /** Peso da lacuna de mastery (1 - mastery) */
  MASTERY_GAP: 0.2,
  /** Peso dos erros não resolvidos */
  ERROR: 0.1,
  /** Peso dos erros recorrentes */
  RECURRENCE: 0.1,
  /** Peso da recência do estudo */
  RECENCY: 0.05,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES — NORMALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fator de normalização para erros não resolvidos.
 * errorComponent = min(unresolvedErrors / ERROR_NORM, 1)
 */
export const ERROR_NORM = 5;

/**
 * Fator de normalização para erros recorrentes.
 * recurrenceComponent = min(recurringErrors / RECURRENCE_NORM, 1)
 */
export const RECURRENCE_NORM = 3;

/**
 * Fator de normalização para recência (dias sem estudo).
 * recencyComponent = min(daysSinceStudy / RECENCY_NORM_DAYS, 1)
 */
export const RECENCY_NORM_DAYS = 60;

/**
 * Valor padrão do componente de recência quando não há dados.
 * Assume valor intermediário — nem urgente, nem recente.
 */
export const RECENCY_UNKNOWN_DEFAULT = 0.5;

/**
 * Boost base quando não há diagnóstico (knowledgeState === null).
 * Neutro: não penaliza nem beneficia.
 */
export const NO_DIAGNOSIS_STATE_BOOST = 0.2;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Garante que o valor é finito e não NaN. Retorna fallback se inválido. */
function safeFinite(v: number, fallback: number): number {
  if (Number.isFinite(v)) return v;
  return fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// GERAÇÃO DE REASON
// ─────────────────────────────────────────────────────────────────────────────

const STATE_REASON_PREFIX: Record<KnowledgeStateName, string> = {
  PONTO_CRITICO: "Ponto crítico",
  RISCO_ESQUECIMENTO: "Risco de esquecimento",
  INSTAVEL: "Desempenho instável",
  APRENDIZAGEM: "Em aprendizagem",
  CONSOLIDANDO: "Domínio em consolidação",
  SEM_EVIDENCIA: "Sem evidência suficiente",
  DOMINADO: "Domínio elevado",
};

function buildReason(input: IntelligenceInput): string {
  const parts: string[] = [];

  // Parte 1: estado pedagógico
  if (input.knowledgeState !== null) {
    parts.push(STATE_REASON_PREFIX[input.knowledgeState]);
  } else {
    parts.push("Sem diagnóstico disponível");
  }

  // Parte 2: sinais relevantes (adiciona apenas os mais significativos)
  if (input.recurringErrors > 0) {
    parts.push("erros recorrentes");
  }
  if (input.unresolvedErrors > 0) {
    parts.push("erros não resolvidos");
  }
  if (input.mastery < 0.4) {
    parts.push("domínio baixo");
  }
  if (input.interventionScore >= 0.6) {
    parts.push("intervenção prioritária");
  }
  if (input.daysSinceStudy !== null && input.daysSinceStudy > 21) {
    parts.push("longo período sem estudo");
  }

  // Parte 3: contexto para DOMINADO
  if (
    input.knowledgeState === "DOMINADO" &&
    input.confidence >= 0.75 &&
    input.accuracy >= 0.6 &&
    input.daysSinceStudy !== null &&
    input.daysSinceStudy <= 7
  ) {
    return "Domínio elevado e estudo recente; manutenção.";
  }

  // Concatena
  if (parts.length === 1) {
    // Apenas o estado
    switch (input.knowledgeState) {
      case "PONTO_CRITICO":
        return "Ponto crítico requer intervenção prioritária.";
      case "RISCO_ESQUECIMENTO":
        return "Risco de esquecimento após período sem estudo.";
      case "INSTAVEL":
        return "Desempenho instável exige nova verificação.";
      case "APRENDIZAGEM":
        return "Em fase de aprendizagem.";
      case "CONSOLIDANDO":
        return "Domínio em consolidação.";
      case "SEM_EVIDENCIA":
        return "Sem evidência suficiente; prioridade para construção de base.";
      case "DOMINADO":
        return "Domínio elevado; manutenção.";
      default:
        return "Sem diagnóstico disponível; boost neutro.";
    }
  }

  // Junta com " + " entre os sinais, ponto final
  const stateStr = parts[0]!;
  const signalStr = parts.slice(1).join(" + ");
  return `${stateStr} + ${signalStr}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula o boost diagnóstico para um tópico.
 *
 * Esta função é PURA:
 * - Mesmo input → mesmo output, sempre.
 * - Sem efeitos colaterais.
 * - Sem acesso a banco, rede, relógio ou estado global.
 *
 * @param input - Sinais mínimos do tópico
 * @returns diagnosticBoost, finalScore e reason
 */
export function computeDiagnosticBoost(input: IntelligenceInput): IntelligenceOutput {
  const W = COMPONENT_WEIGHTS;

  // ── Componente 1: estado pedagógico ──────────────────────────────────
  const stateRaw =
    input.knowledgeState !== null ? STATE_BOOST[input.knowledgeState] : NO_DIAGNOSIS_STATE_BOOST;
  const stateComponent = clamp01(safeFinite(stateRaw, NO_DIAGNOSIS_STATE_BOOST));

  // ── Componente 2: intervention score ─────────────────────────────────
  const interventionComponent = clamp01(safeFinite(input.interventionScore, 0));

  // ── Componente 3: lacuna de mastery ──────────────────────────────────
  const masteryGapComponent = clamp01(safeFinite(1 - input.mastery, 0.8));

  // ── Componente 4: erros não resolvidos ───────────────────────────────
  const errorComponent = clamp01(safeFinite(Math.min(input.unresolvedErrors / ERROR_NORM, 1), 0));

  // ── Componente 5: erros recorrentes ──────────────────────────────────
  const recurrenceComponent = clamp01(
    safeFinite(Math.min(input.recurringErrors / RECURRENCE_NORM, 1), 0),
  );

  // ── Componente 6: recência ───────────────────────────────────────────
  const recencyComponent =
    input.daysSinceStudy !== null
      ? clamp01(
          safeFinite(
            Math.min(input.daysSinceStudy / RECENCY_NORM_DAYS, 1),
            RECENCY_UNKNOWN_DEFAULT,
          ),
        )
      : RECENCY_UNKNOWN_DEFAULT;

  // ── Cálculo do boost ─────────────────────────────────────────────────
  const rawBoost =
    W.STATE * stateComponent +
    W.INTERVENTION * interventionComponent +
    W.MASTERY_GAP * masteryGapComponent +
    W.ERROR * errorComponent +
    W.RECURRENCE * recurrenceComponent +
    W.RECENCY * recencyComponent;

  // Proteção contra NaN / Infinity / negativos
  const diagnosticBoost = Math.max(0, safeFinite(rawBoost, 0));
  const safeBase = safeFinite(input.baseScore, 0);
  const finalScore = safeFinite(safeBase + diagnosticBoost, safeBase);

  const reason = buildReason(input);

  return {
    diagnosticBoost,
    finalScore,
    reason,
  };
}
