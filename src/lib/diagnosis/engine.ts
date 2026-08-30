/**
 * MOTOR DETERMINÍSTICO DE DIAGNÓSTICO — Etapa 3.2
 *
 * Recebe os sinais estruturados (PlannerSignals) de um tópico e produz
 * um diagnóstico pedagógico completo e determinístico.
 *
 * PRINCÍPIOS:
 * - Função pura: mesmo input → mesmo output, sempre.
 * - Sem acesso a banco, sem Date.now(), sem Math.random(), sem IA.
 * - A data de referência entra como parâmetro.
 * - Todos os thresholds são constantes documentadas.
 * - O diagnóstico considera mastery + confidence + accuracy + erros +
 *   recorrência + recência de forma independente.
 *
 * ARQUITETURA:
 *   DADOS BRUTOS → SINAIS (PlannerSignals) → DIAGNÓSTICO (TopicDiagnosis) → INTERVENÇÃO
 *   O planner NÃO é alterado nesta etapa.
 */

import type { PlannerSignals } from "../knowledge/signals";

// ─────────────────────────────────────────────────────────────────────────────
// ESTADOS PEDAGÓGICOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estado do conhecimento do aluno em um tópico.
 *
 * Hierarquia de precedência (maior → menor):
 *   PONTO_CRITICO > RISCO_ESQUECIMENTO > CONSOLIDANDO > INSTAVEL >
 *   DOMINADO > APRENDIZAGEM > SEM_EVIDENCIA
 *
 * Observação: CONSOLIDANDO só antecede INSTAVEL quando mastery é alto e a
 * confidence é insuficiente (evidência fraca não sustenta o rótulo de
 * instabilidade). Nos demais casos a divergência accuracy × mastery vence.

 *
 * Significado:
 * - SEM_EVIDENCIA: pouquíssimos dados para concluir domínio.
 * - APRENDIZAGEM: domínio baixo ou intermediário, evidência insuficiente
 *   para consolidação.
 * - INSTAVEL: desempenho oscilante — accuracy diverge significativamente
 *   do mastery estimado, indicando inconsistência.
 * - CONSOLIDANDO: domínio bom, mas evidência/confidence insuficiente para
 *   declarar domínio completo. Inclui detecção de "domínio falso".
 * - DOMINADO: domínio alto + confiança alta + desempenho consistente +
 *   estudo não muito antigo.
 * - RISCO_ESQUECIMENTO: domínio anteriormente elevado, mas longo período
 *   sem estudo. Linguagem probabilística: "possível perda de retenção".
 * - PONTO_CRITICO: domínio baixo com evidência suficiente, e/ou erros
 *   recorrentes com evidência. Requer intervenção prioritária.
 */
export type KnowledgeStateName =
  | "SEM_EVIDENCIA"
  | "APRENDIZAGEM"
  | "INSTAVEL"
  | "CONSOLIDANDO"
  | "DOMINADO"
  | "RISCO_ESQUECIMENTO"
  | "PONTO_CRITICO";

// ─────────────────────────────────────────────────────────────────────────────
// NÍVEL DE EVIDÊNCIA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classificação da quantidade de evidência disponível.
 * Baseada na confidence já calculada pelo knowledge engine.
 *
 * Coerência com computeConfidence:
 *   confidence = 1 - e^(-totalQuestions / 10)
 *   - 0 questões → 0.00   → NENHUMA
 *   - 1 questão  → 0.095  → NENHUMA (< 0.15)
 *   - 2 questões → 0.181  → BAIXA
 *   - 5 questões → 0.393  → BAIXA (< 0.40)
 *   - 6 questões → 0.451  → MEDIA
 *   - 10 questões → 0.632 → MEDIA
 *   - 14 questões → 0.753 → ALTA
 *   - 20 questões → 0.865 → ALTA
 *   - 50 questões → 0.993 → ALTA
 */
export type EvidenceLevel = "NENHUMA" | "BAIXA" | "MEDIA" | "ALTA";

// ─────────────────────────────────────────────────────────────────────────────
// NÍVEL DE RISCO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classificação do risco pedagógico.
 * Considera múltiplos sinais, não apenas o inverso do mastery.
 *
 * - BAIXO: poucos sinais de risco.
 * - MODERADO: alguma fragilidade detectada.
 * - ALTO: evidências relevantes de deficiência.
 * - CRITICO: deficiência forte + evidência alta + sinais adicionais.
 */
export type RiskLevel = "BAIXO" | "MODERADO" | "ALTO" | "CRITICO";

// ─────────────────────────────────────────────────────────────────────────────
// RECÊNCIA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classificação da recência do último estudo.
 *
 * - RECENTE: estudo nos últimos RECENT_DAYS_THRESHOLD dias.
 * - ATENCAO: entre RECENT_DAYS_THRESHOLD e OLD_DAYS_THRESHOLD dias.
 * - ANTIGO: mais de OLD_DAYS_THRESHOLD dias sem estudo.
 * - DESCONHECIDA: sem registro de estudo.
 */
export type RecencyClassification = "RECENTE" | "ATENCAO" | "ANTIGO" | "DESCONHECIDA";

// ─────────────────────────────────────────────────────────────────────────────
// INTERVENÇÕES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tipos de intervenção pedagógica recomendada.
 *
 * - ESTUDAR_TEORIA: deficiência conceitual e/ou pouca evidência.
 * - RESOLVER_QUESTOES: base suficiente, mas desempenho baixo.
 * - REVISAR_ERROS: erros não resolvidos relevantes.
 * - REFORCAR_PONTO_FRACO: recorrência em categoria/tópico.
 * - REVISAR: domínio bom, mas risco de esquecimento.
 * - CONSOLIDAR: domínio bom, confidence insuficiente.
 * - MANUTENCAO: domínio e confiança altos.
 */
export type InterventionType =
  | "ESTUDAR_TEORIA"
  | "RESOLVER_QUESTOES"
  | "REVISAR_ERROS"
  | "REFORCAR_PONTO_FRACO"
  | "REVISAR"
  | "CONSOLIDAR"
  | "MANUTENCAO";

// ─────────────────────────────────────────────────────────────────────────────
// THRESHOLDS — Todas as constantes centralizadas e documentadas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Limiar de confidence abaixo do qual consideramos evidência insuficiente
 * para qualquer conclusão forte. Com a fórmula do knowledge engine,
 * confidence < 0.15 corresponde a ~1 questão respondida.
 */
export const NO_EVIDENCE_CONFIDENCE = 0.15;

/**
 * Número mínimo de questões para sair de SEM_EVIDENCIA.
 * Mesmo com confidence > 0.15, se houver < 2 questões, não há base.
 */
export const MIN_QUESTIONS_FOR_EVIDENCE = 2;

/**
 * Limiar de confidence para evidência BAIXA → MEDIA.
 * confidence >= 0.40 corresponde a ~5 questões.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.4;

/**
 * Limiar de confidence para evidência MEDIA → ALTA.
 * confidence >= 0.75 corresponde a ~14 questões.
 */
export const HIGH_CONFIDENCE_THRESHOLD = 0.75;

/**
 * Limiar de mastery para considerar domínio "alto".
 * Usado para determinar DOMINADO, CONSOLIDANDO, RISCO_ESQUECIMENTO.
 */
export const HIGH_MASTERY_THRESHOLD = 0.7;

/**
 * Limiar de mastery para considerar domínio "baixo" (ponto crítico potencial).
 */
export const LOW_MASTERY_THRESHOLD = 0.4;

/**
 * Limiar de mastery para risco de esquecimento.
 * O domínio precisa ter sido pelo menos moderado.
 */
export const FORGETTING_MASTERY_THRESHOLD = 0.5;

/**
 * Limiar de confidence mínimo para detectar risco de esquecimento.
 * Precisamos de alguma evidência para afirmar que houve domínio anterior.
 */
export const FORGETTING_CONFIDENCE_THRESHOLD = 0.4;

/**
 * Limiar de accuracy mínimo para que DOMINADO seja aceito.
 * Mesmo com mastery e confidence altos, accuracy muito baixa indica problema.
 */
export const MIN_ACCURACY_FOR_MASTERED = 0.6;

/**
 * Diferença mínima entre accuracy e mastery para detectar instabilidade.
 * Se |accuracy - mastery| >= este valor e evidence >= MEDIA, → INSTAVEL.
 */
export const INSTABILITY_DIVERGENCE = 0.25;

/**
 * Limiar de dias para classificar estudo como RECENTE.
 */
export const RECENT_DAYS_THRESHOLD = 7;

/**
 * Limiar de dias para classificar estudo como ANTIGO (risco de esquecimento).
 */
export const OLD_DAYS_THRESHOLD = 21;

/**
 * Limiar de erros recorrentes que, combinado com confidence MEDIA+,
 * pode elevar o estado a PONTO_CRITICO mesmo com mastery intermediário.
 */
export const RECURRING_ERRORS_CRITICAL_THRESHOLD = 1;

/**
 * Limiar de erros não resolvidos para considerar que há erros "relevantes".
 */
export const UNRESOLVED_ERRORS_RELEVANT_THRESHOLD = 1;

// ─── Pesos do intervention_score ─────────────────────────────────────────────

/**
 * Pesos para o cálculo do intervention_score.
 * Cada componente contribui proporcionalmente.
 * A soma dos pesos é 1.0 para que o score final esteja em 0..1.
 *
 * gap:         peso da lacuna de domínio (1 - mastery).
 * evidence:    peso da falta de evidência (1 - confidence).
 * unresolved:  peso dos erros não resolvidos.
 * recurring:   peso dos erros recorrentes.
 * accuracyGap: peso da lacuna de accuracy (1 - accuracy).
 * recency:     peso do tempo sem estudo.
 * stability:   peso da instabilidade (divergência mastery/accuracy).
 */
export const INTERVENTION_WEIGHTS = {
  gap: 0.3,
  evidence: 0.1,
  unresolved: 0.15,
  recurring: 0.15,
  accuracyGap: 0.1,
  recency: 0.1,
  stability: 0.1,
} as const;

/**
 * Fator de normalização para erros não resolvidos no intervention_score.
 * unresolvedComponent = min(unresolvedErrors / UNRESOLVED_NORM, 1)
 */
export const UNRESOLVED_NORM = 5;

/**
 * Fator de normalização para erros recorrentes no intervention_score.
 * recurringComponent = min(recurringErrors / RECURRING_NORM, 1)
 */
export const RECURRING_NORM = 3;

/**
 * Fator de normalização para recência no intervention_score.
 * recencyComponent = min(daysSinceStudy / RECENCY_NORM_DAYS, 1)
 */
export const RECENCY_NORM_DAYS = 60;

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS DE SAÍDA
// ─────────────────────────────────────────────────────────────────────────────

export type TopicDiagnosis = {
  /** Sinais de entrada usados para o diagnóstico */
  signals: PlannerSignals;
  /** Mastery do tópico (0..1) */
  mastery: number;
  /** Confidence na estimativa (0..1) */
  confidence: number;
  /** Taxa de acerto observada (0..1) */
  accuracy: number;
  /** Classificação do nível de evidência */
  evidenceLevel: EvidenceLevel;
  /** Estado pedagógico principal */
  knowledgeState: KnowledgeStateName;
  /** Nível de risco pedagógico */
  riskLevel: RiskLevel;
  /** Classificação de recência do estudo */
  recency: RecencyClassification;
  /** Score de intervenção normalizado 0..1 */
  interventionScore: number;
  /** Tipo de intervenção recomendada */
  intervention: InterventionType;
  /** Razão legível do diagnóstico */
  diagnosisReason: string;
  /** Sinais secundários relevantes */
  secondarySignals: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES AUXILIARES (todas puras)
// ─────────────────────────────────────────────────────────────────────────────

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Classifica o nível de evidência com base na confidence. */
export function classifyEvidence(confidence: number, questionCount: number): EvidenceLevel {
  if (confidence < NO_EVIDENCE_CONFIDENCE || questionCount < MIN_QUESTIONS_FOR_EVIDENCE) {
    return "NENHUMA";
  }
  if (confidence < LOW_CONFIDENCE_THRESHOLD) return "BAIXA";
  if (confidence < HIGH_CONFIDENCE_THRESHOLD) return "MEDIA";
  return "ALTA";
}

/** Classifica a recência do último estudo. */
export function classifyRecency(daysSinceStudy: number | null): RecencyClassification {
  if (daysSinceStudy === null) return "DESCONHECIDA";
  if (daysSinceStudy <= RECENT_DAYS_THRESHOLD) return "RECENTE";
  if (daysSinceStudy <= OLD_DAYS_THRESHOLD) return "ATENCAO";
  return "ANTIGO";
}

/**
 * Calcula o intervention_score normalizado 0..1.
 *
 * Fórmula:
 *   score = W_gap * (1 - mastery)
 *         + W_evidence * (1 - confidence)
 *         + W_unresolved * min(unresolvedErrors / UNRESOLVED_NORM, 1)
 *         + W_recurring * min(recurringErrors / RECURRING_NORM, 1)
 *         + W_accuracyGap * (1 - accuracy)
 *         + W_recency * min(daysSinceStudy / RECENCY_NORM_DAYS, 1)
 *         + W_stability * min(|accuracy - mastery| / 0.5, 1)
 *
 * Cada componente está em 0..1. Os pesos somam 1.0.
 * O resultado final é clamped em 0..1.
 */
export function computeInterventionScore(signals: PlannerSignals): number {
  const W = INTERVENTION_WEIGHTS;

  const gapComponent = 1 - signals.mastery;
  const evidenceComponent = 1 - signals.confidence;
  const unresolvedComponent = Math.min(signals.unresolvedErrors / UNRESOLVED_NORM, 1);
  const recurringComponent = Math.min(signals.recurringErrors / RECURRING_NORM, 1);
  const accuracyGapComponent = 1 - signals.accuracy;
  const recencyComponent =
    signals.daysSinceStudy !== null ? Math.min(signals.daysSinceStudy / RECENCY_NORM_DAYS, 1) : 0.5; // sem dados de recência assume valor intermediário
  const stabilityComponent = Math.min(Math.abs(signals.accuracy - signals.mastery) / 0.5, 1);

  const score =
    W.gap * gapComponent +
    W.evidence * evidenceComponent +
    W.unresolved * unresolvedComponent +
    W.recurring * recurringComponent +
    W.accuracyGap * accuracyGapComponent +
    W.recency * recencyComponent +
    W.stability * stabilityComponent;

  return clamp01(score);
}

/**
 * Determina o nível de risco pedagógico.
 *
 * Não é uma simples inversão do mastery. Considera:
 * - mastery baixo + confidence alta → mais grave
 * - erros não resolvidos e recorrentes agravam
 * - accuracy baixa com evidência agrava
 * - recência agrava
 */
export function classifyRisk(signals: PlannerSignals, evidence: EvidenceLevel): RiskLevel {
  let riskScore = 0;

  // Mastery baixo é sinal de risco, mas ponderado pela evidência
  if (signals.mastery < LOW_MASTERY_THRESHOLD) {
    riskScore += evidence === "ALTA" ? 3 : evidence === "MEDIA" ? 2 : 1;
  } else if (signals.mastery < HIGH_MASTERY_THRESHOLD) {
    riskScore += evidence === "ALTA" ? 1 : 0;
  }

  // Erros não resolvidos
  if (signals.unresolvedErrors >= UNRESOLVED_ERRORS_RELEVANT_THRESHOLD) {
    riskScore += Math.min(signals.unresolvedErrors, 3);
  }

  // Erros recorrentes (sinal forte)
  if (signals.recurringErrors >= RECURRING_ERRORS_CRITICAL_THRESHOLD) {
    riskScore += Math.min(signals.recurringErrors * 2, 4);
  }

  // Accuracy baixa com evidência
  if (signals.accuracy < 0.4 && (evidence === "MEDIA" || evidence === "ALTA")) {
    riskScore += 2;
  }

  // Recência: estudo antigo com domínio que pode ser perdido
  if (signals.daysSinceStudy !== null && signals.daysSinceStudy > OLD_DAYS_THRESHOLD) {
    riskScore += 1;
  }

  if (riskScore >= 6) return "CRITICO";
  if (riskScore >= 4) return "ALTO";
  if (riskScore >= 2) return "MODERADO";
  return "BAIXO";
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNÓSTICO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produz o diagnóstico pedagógico de um tópico a partir dos sinais.
 *
 * Esta é a função principal do módulo. É pura e determinística.
 *
 * @param signals - Sinais estruturados do tópico (PlannerSignals)
 * @param _referenceDate - Data de referência (reservado para uso futuro;
 *   a recência já vem calculada nos sinais como daysSinceStudy)
 * @returns TopicDiagnosis completo
 */
export function diagnoseTopic(signals: PlannerSignals, _referenceDate?: string): TopicDiagnosis {
  const { mastery, confidence, accuracy } = signals;
  const evidence = classifyEvidence(confidence, signals.questionCount);
  const recency = classifyRecency(signals.daysSinceStudy);
  const interventionScore = computeInterventionScore(signals);
  const riskLevel = classifyRisk(signals, evidence);

  const secondarySignals: string[] = [];
  let knowledgeState: KnowledgeStateName;
  let intervention: InterventionType;
  let diagnosisReason: string;

  // ── 1. SEM_EVIDENCIA ────────────────────────────────────────────────────
  // Precedência mais baixa mas avaliada primeiro: se não há dados,
  // qualquer outra conclusão seria infundada.
  if (evidence === "NENHUMA") {
    knowledgeState = "SEM_EVIDENCIA";
    intervention = "ESTUDAR_TEORIA";
    diagnosisReason =
      signals.questionCount === 0
        ? "Nenhuma questão respondida neste tópico. Não há dados para avaliar domínio."
        : `Apenas ${signals.questionCount} questão(ões) respondida(s). Evidência insuficiente para qualquer conclusão.`;

    return {
      signals,
      mastery,
      confidence,
      accuracy,
      evidenceLevel: evidence,
      knowledgeState,
      riskLevel,
      recency,
      interventionScore,
      intervention,
      diagnosisReason,
      secondarySignals,
    };
  }

  // ── 2. PONTO_CRITICO ───────────────────────────────────────────────────
  // Maior precedência entre estados com evidência.
  // Condição A: mastery baixo + confidence suficiente
  // Condição B: erros recorrentes com confidence média+
  const isCriticalByMastery =
    mastery < LOW_MASTERY_THRESHOLD && confidence >= LOW_CONFIDENCE_THRESHOLD;
  const isCriticalByRecurrence =
    signals.recurringErrors >= RECURRING_ERRORS_CRITICAL_THRESHOLD &&
    (evidence === "MEDIA" || evidence === "ALTA");

  if (isCriticalByMastery || isCriticalByRecurrence) {
    knowledgeState = "PONTO_CRITICO";

    if (isCriticalByMastery) {
      secondarySignals.push("domínio baixo com evidência suficiente");
    }
    if (isCriticalByRecurrence) {
      secondarySignals.push(`${signals.recurringErrors} erro(s) recorrente(s) detectado(s)`);
    }
    if (signals.unresolvedErrors >= UNRESOLVED_ERRORS_RELEVANT_THRESHOLD) {
      secondarySignals.push(`${signals.unresolvedErrors} erro(s) não resolvido(s)`);
    }

    // Intervenção: se há erros recorrentes, reforçar ponto fraco;
    // se há erros não resolvidos, revisar erros; senão, resolver questões
    if (isCriticalByRecurrence) {
      intervention = "REFORCAR_PONTO_FRACO";
    } else if (signals.unresolvedErrors >= UNRESOLVED_ERRORS_RELEVANT_THRESHOLD) {
      intervention = "REVISAR_ERROS";
    } else {
      intervention = "RESOLVER_QUESTOES";
    }

    const parts: string[] = [];
    if (isCriticalByMastery) {
      parts.push(
        `Domínio baixo (${(mastery * 100).toFixed(0)}%) com alta evidência (confidence ${(confidence * 100).toFixed(0)}%)`,
      );
    }
    if (isCriticalByRecurrence) {
      parts.push(`erros recorrentes (${signals.recurringErrors})`);
    }
    if (signals.unresolvedErrors > 0) {
      parts.push(`${signals.unresolvedErrors} erro(s) não resolvido(s)`);
    }
    diagnosisReason = parts.join("; ") + ".";

    return {
      signals,
      mastery,
      confidence,
      accuracy,
      evidenceLevel: evidence,
      knowledgeState,
      riskLevel,
      recency,
      interventionScore,
      intervention,
      diagnosisReason,
      secondarySignals,
    };
  }

  // ── 3. RISCO_ESQUECIMENTO ──────────────────────────────────────────────
  // Domínio anteriormente elevado + confiança razoável + longo período sem estudo
  if (
    mastery >= FORGETTING_MASTERY_THRESHOLD &&
    confidence >= FORGETTING_CONFIDENCE_THRESHOLD &&
    recency === "ANTIGO"
  ) {
    knowledgeState = "RISCO_ESQUECIMENTO";
    intervention = "REVISAR";
    diagnosisReason = `Domínio estimado em ${(mastery * 100).toFixed(0)}% com confidence ${(confidence * 100).toFixed(0)}%, porém sem estudo há ${signals.daysSinceStudy} dias. Há sinais de possível perda de retenção devido à ausência prolongada de revisão.`;

    if (signals.unresolvedErrors > 0) {
      secondarySignals.push(`${signals.unresolvedErrors} erro(s) não resolvido(s)`);
    }

    return {
      signals,
      mastery,
      confidence,
      accuracy,
      evidenceLevel: evidence,
      knowledgeState,
      riskLevel,
      recency,
      interventionScore,
      intervention,
      diagnosisReason,
      secondarySignals,
    };
  }

  // ── 4. INSTAVEL ────────────────────────────────────────────────────────
  // Desempenho oscilante: accuracy diverge do mastery com evidência suficiente.
  // Poucos dados NÃO devem gerar instabilidade falsamente.
  //
  // Exceção (CONSOLIDANDO tem precedência): mastery alto com confidence
  // insuficiente. Nesse cenário a divergência costuma refletir melhora
  // recente (EMA sobe antes da média histórica) e não oscilação real; com
  // evidência insuficiente a conclusão correta é "consolidar", não "instável".
  const divergence = Math.abs(accuracy - mastery);
  const isConsolidating =
    mastery >= HIGH_MASTERY_THRESHOLD && confidence < HIGH_CONFIDENCE_THRESHOLD;
  if (
    !isConsolidating &&
    divergence >= INSTABILITY_DIVERGENCE &&
    (evidence === "MEDIA" || evidence === "ALTA")
  ) {
    knowledgeState = "INSTAVEL";

    if (signals.unresolvedErrors >= UNRESOLVED_ERRORS_RELEVANT_THRESHOLD) {
      intervention = "REVISAR_ERROS";
      secondarySignals.push(`${signals.unresolvedErrors} erro(s) não resolvido(s)`);
    } else {
      intervention = "RESOLVER_QUESTOES";
    }

    diagnosisReason = `Desempenho inconsistente: accuracy ${(accuracy * 100).toFixed(0)}% diverge do mastery estimado ${(mastery * 100).toFixed(0)}% (diferença de ${(divergence * 100).toFixed(0)} pontos percentuais). Indica oscilação no desempenho.`;

    return {
      signals,
      mastery,
      confidence,
      accuracy,
      evidenceLevel: evidence,
      knowledgeState,
      riskLevel,
      recency,
      interventionScore,
      intervention,
      diagnosisReason,
      secondarySignals,
    };
  }

  // ── 5. CONSOLIDANDO (inclui detecção de "domínio falso") ───────────────
  // Mastery alto MAS confidence baixa → não pode ser DOMINADO.
  if (mastery >= HIGH_MASTERY_THRESHOLD && confidence < HIGH_CONFIDENCE_THRESHOLD) {
    knowledgeState = "CONSOLIDANDO";
    intervention = "CONSOLIDAR";
    diagnosisReason = `Domínio estimado alto (${(mastery * 100).toFixed(0)}%), mas ainda há pouca evidência (confidence ${(confidence * 100).toFixed(0)}%). São necessárias mais questões para confirmar o domínio.`;

    secondarySignals.push("domínio falso potencial: mastery alto com evidence insuficiente");

    return {
      signals,
      mastery,
      confidence,
      accuracy,
      evidenceLevel: evidence,
      knowledgeState,
      riskLevel,
      recency,
      interventionScore,
      intervention,
      diagnosisReason,
      secondarySignals,
    };
  }

  // ── 6. DOMINADO ────────────────────────────────────────────────────────
  // Mastery alto + confidence alta + accuracy razoável + estudo não muito antigo
  if (
    mastery >= HIGH_MASTERY_THRESHOLD &&
    confidence >= HIGH_CONFIDENCE_THRESHOLD &&
    accuracy >= MIN_ACCURACY_FOR_MASTERED
  ) {
    knowledgeState = "DOMINADO";
    intervention = "MANUTENCAO";
    diagnosisReason = `Domínio elevado (${(mastery * 100).toFixed(0)}%) e alta confiança (${(confidence * 100).toFixed(0)}%) com accuracy ${(accuracy * 100).toFixed(0)}%. Recomenda-se manutenção.`;

    if (recency === "ATENCAO") {
      secondarySignals.push("último estudo há alguns dias; considerar revisão preventiva");
    }

    return {
      signals,
      mastery,
      confidence,
      accuracy,
      evidenceLevel: evidence,
      knowledgeState,
      riskLevel,
      recency,
      interventionScore,
      intervention,
      diagnosisReason,
      secondarySignals,
    };
  }

  // ── 7. APRENDIZAGEM (default com evidência) ────────────────────────────
  // Domínio baixo ou intermediário, ou condições de DOMINADO não atendidas.
  knowledgeState = "APRENDIZAGEM";

  // Intervenção depende dos sinais disponíveis
  if (signals.unresolvedErrors >= UNRESOLVED_ERRORS_RELEVANT_THRESHOLD) {
    intervention = "REVISAR_ERROS";
    secondarySignals.push(`${signals.unresolvedErrors} erro(s) não resolvido(s)`);
  } else if (evidence === "BAIXA") {
    intervention = "ESTUDAR_TEORIA";
  } else {
    intervention = "RESOLVER_QUESTOES";
  }

  const accuracyPart =
    signals.questionCount > 0 ? ` Accuracy: ${(accuracy * 100).toFixed(0)}%.` : "";
  diagnosisReason = `Domínio em desenvolvimento (${(mastery * 100).toFixed(0)}%) com confidence ${(confidence * 100).toFixed(0)}%.${accuracyPart}`;

  return {
    signals,
    mastery,
    confidence,
    accuracy,
    evidenceLevel: evidence,
    knowledgeState,
    riskLevel,
    recency,
    interventionScore,
    intervention,
    diagnosisReason,
    secondarySignals,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LABELS PARA UI
// ─────────────────────────────────────────────────────────────────────────────

export const KNOWLEDGE_STATE_LABELS: Record<KnowledgeStateName, string> = {
  SEM_EVIDENCIA: "Sem evidência",
  APRENDIZAGEM: "Aprendizagem",
  INSTAVEL: "Instável",
  CONSOLIDANDO: "Consolidando",
  DOMINADO: "Dominado",
  RISCO_ESQUECIMENTO: "Risco de esquecimento",
  PONTO_CRITICO: "Ponto crítico",
};

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  BAIXO: "Baixo",
  MODERADO: "Moderado",
  ALTO: "Alto",
  CRITICO: "Crítico",
};

export const EVIDENCE_LEVEL_LABELS: Record<EvidenceLevel, string> = {
  NENHUMA: "Nenhuma",
  BAIXA: "Baixa",
  MEDIA: "Média",
  ALTA: "Alta",
};

export const INTERVENTION_LABELS: Record<InterventionType, string> = {
  ESTUDAR_TEORIA: "Estudar teoria",
  RESOLVER_QUESTOES: "Resolver questões",
  REVISAR_ERROS: "Revisar erros",
  REFORCAR_PONTO_FRACO: "Reforçar ponto fraco",
  REVISAR: "Revisar",
  CONSOLIDAR: "Consolidar",
  MANUTENCAO: "Manutenção",
};

export const RECENCY_LABELS: Record<RecencyClassification, string> = {
  RECENTE: "Recente",
  ATENCAO: "Atenção",
  ANTIGO: "Antigo",
  DESCONHECIDA: "Desconhecida",
};
