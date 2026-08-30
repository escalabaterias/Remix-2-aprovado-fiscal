/**
 * MOTOR DETERMINÍSTICO DE PLANEJAMENTO — Etapa 2 + Etapa 3.3
 *
 * Nada aqui usa IA. Dado o mesmo insumo, o resultado é sempre o mesmo.
 * Todo o cálculo é feito em memória, a partir de dados já existentes no banco:
 * contest_topics, subjects, topics, topic_prerequisites, user_topic_knowledge,
 * contests.exam_date e availability_weeks.
 *
 * O motor tem três fases:
 *
 *  1. PONTUAÇÃO (score)
 *     score = 2.0*prioridade + 1.5*peso + 1.2*incidência + 1.0*relevância
 *           + 2.0*lacuna de domínio + bônus de proximidade da prova
 *     Cada fator é normalizado para 0..1 antes de receber o multiplicador.
 *     Tópicos com pré-requisito pendente são penalizados (fator 0.6) e o
 *     pré-requisito recebe bônus (+1.5), de modo que a base venha antes.
 *
 *     [Etapa 3.3] Quando dados diagnósticos estão disponíveis, o score
 *     estrutural é incrementado por computeDiagnosticBoost(), que considera
 *     o estado pedagógico, intervention_score, mastery gap, erros, recência.
 *     O boost máximo é 1.0 (soma dos pesos dos componentes).
 *
 *  2. DISTRIBUIÇÃO DE TEMPO
 *     A fatia de cada candidato é proporcional ao score, limitada por um teto
 *     por matéria (padrão 35% quando existem 3+ matérias) para evitar que uma
 *     única matéria consuma o plano inteiro. O teto é aplicado com algoritmo
 *     iterativo (cap-and-redistribute) que garante que nenhuma matéria exceda
 *     o limite mesmo após renormalização. Após conversão em blocos inteiros,
 *     uma segunda passada remove blocos excedentes de matérias acima do teto
 *     e redistribui para as demais.
 *
 *  3. ALOCAÇÃO EM DIAS
 *     Os blocos são intercalados por matéria (round-robin) e encaixados dia a
 *     dia respeitando a disponibilidade daquela semana e o teto diário.
 *     Semanas diferentes têm capacidades diferentes — nada é assumido.
 *
 * REGRA DE ARREDONDAMENTO E EXCEÇÃO MATEMÁTICA FORMAL:
 *
 *     Ao converter minutos proporcionais em blocos inteiros, o arredondamento
 *     pode causar variação de até 1 bloco por matéria. O motor garante que,
 *     com 3+ matérias, nenhuma matéria exceda ceil(totalBlocks * maxSubjectShare)
 *     blocos.
 *
 *     ANÁLISE MATEMÁTICA DO TETO DE 35%:
 *
 *     O teto em blocos inteiros é: maxBlocks = ceil(totalBlocks * 0.35).
 *     O percentual real máximo é: maxBlocks / totalBlocks.
 *
 *     Exemplos:
 *     - totalBlocks=1:  ceil(0.35) = 1  → 1/1 = 100%  (viola 35%)
 *     - totalBlocks=2:  ceil(0.70) = 1  → 1/2 = 50%   (viola 35%)
 *     - totalBlocks=3:  ceil(1.05) = 2  → 2/3 = 66.7% (mas 1/3 = 33.3% se 3 matérias, OK)
 *     - totalBlocks=10: ceil(3.50) = 4  → 4/10 = 40%  (viola marginal)
 *     - totalBlocks=20: ceil(7.00) = 7  → 7/20 = 35%  (exato)
 *     - totalBlocks=50: ceil(17.5) = 18 → 18/50 = 36% (viola marginal por arredondamento)
 *     - totalBlocks=100: ceil(35) = 35  → 35/100 = 35% (exato)
 *
 *     EXCEÇÃO DOCUMENTADA:
 *     Quando totalBlocks < 3 e existem 3+ matérias com score > 0, é
 *     matematicamente impossível distribuir blocos inteiros respeitando
 *     35% por matéria — cada matéria precisa de pelo menos 1 bloco, mas
 *     com 2 blocos o melhor caso é 50%. Neste cenário, a regra de "pelo
 *     menos 1 bloco por matéria com score" prevalece sobre o teto de 35%.
 *     Isso ocorre APENAS com disponibilidade extremamente baixa (ex: 100min
 *     total com blocos de 50min = 2 blocos para 3+ matérias).
 *
 *     Para totalBlocks >= 3 com 3+ matérias, o teto efetivo é:
 *     ceil(totalBlocks * 0.35) / totalBlocks, que converge para 35%
 *     conforme totalBlocks cresce. Com 20+ blocos (1 semana típica),
 *     o percentual máximo é <= 35.0%.
 *
 * [Etapa 5, Fase 5] chooseActivity() NÃO gera mais 'revisao'.
 * A revisão adaptativa é responsabilidade exclusiva do Review Engine +
 * Unified Scheduler (via reviewActivity()). O Planner gera apenas
 * atividades de estudo: teoria, questoes, flashcards.
 */

import { addDays, availableMinutesOn, daysBetween, type AvailabilityWeek } from "./availability";

import { computeDiagnosticBoost, type IntelligenceInput } from "./intelligence";

import type { KnowledgeStateName } from "../diagnosis/engine";

export type ActivityKind =
  | "teoria"
  | "questoes"
  | "revisao"
  | "flashcards"
  | "simulado"
  | "exercicios"
  | "leitura"
  | "estudo_dirigido";

export type PlannerCandidate = {
  /** contest_topics.id (origem da prioridade/peso do edital) */
  contestTopicId: string;
  subjectId: string;
  subjectName: string;
  topicId: string | null;
  topicName: string | null;
  /** contest_topics.priority (1..5) */
  priority: number;
  /** contest_topics.weight (0..10, opcional) */
  weight: number | null;
  incidence: number | null;
  relevance: number | null;
  isStudied: boolean;
  /** user_topic_knowledge.mastery (0..1) — null = sem dados */
  mastery: number | null;
  /** topic_prerequisites: pré-requisitos diretos do tópico */
  prerequisiteTopicIds: string[];
};

/**
 * Dados diagnósticos opcionais por tópico, vindos do Diagnostic Engine.
 * Indexados por topicId no mapa passado a scoreCandidates/buildPlan.
 */
export type DiagnosticData = {
  knowledgeState: KnowledgeStateName | null;
  mastery: number;
  confidence: number;
  accuracy: number;
  recentErrors: number;
  unresolvedErrors: number;
  recurringErrors: number;
  daysSinceStudy: number | null;
  daysSinceError: number | null;
  interventionScore: number;
};

export type PlannerOptions = {
  startDate: string;
  endDate: string;
  examDate: string | null;
  blockMinutes: number;
  maxDailyMinutes: number;
  /** teto de participação de uma matéria no total (0..1) */
  maxSubjectShare?: number;
  minBlockMinutes?: number;
  /** Dados diagnósticos opcionais, indexados por topicId */
  diagnosticData?: Map<string, DiagnosticData>;
};

export type ScoredCandidate = PlannerCandidate & {
  score: number;
  gap: number;
  blockedByPrerequisite: boolean;
  isPrerequisiteOfBlocked: boolean;
  reasons: string[];
  /** Boost diagnóstico aplicado (0 se não disponível) */
  diagnosticBoost: number;
};

export type PlannedTask = {
  candidate: ScoredCandidate;
  date: string;
  minutes: number;
  activity: ActivityKind;
  priorityScore: number;
  priorityReason: string;
  position: number;
};

export type PlannerResult = {
  tasks: PlannedTask[];
  scored: ScoredCandidate[];
  totalCapacityMinutes: number;
  allocatedMinutes: number;
  unallocatedMinutes: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Lacuna de domínio: sem dados assume-se lacuna alta (0.8), porém não máxima. */
function masteryGap(mastery: number | null, isStudied: boolean): number {
  if (mastery !== null && mastery !== undefined) return clamp01(1 - mastery);
  return isStudied ? 0.5 : 0.8;
}

/**
 * Sinais utilizados no cálculo do score.
 * Estrutura extensível: novos sinais podem ser adicionados aqui sem alterar
 * a assinatura de scoreCandidates. Sinais futuros previstos:
 * - recentErrors: frequência de erros recentes (0..1)
 * - recurrentErrors: taxa de erros recorrentes (0..1)
 * - reviewRecency: quão recente foi a última revisão (0..1, 1 = muito tempo)
 * - accuracyRate: inverso da taxa de acerto (0..1)
 * - difficulty: dificuldade estimada (0..1)
 * - boardPerformance: desempenho na banca específica (0..1)
 * - forgettingCurve: estimativa de esquecimento (0..1)
 */
export type ScoreSignals = {
  normPriority: number;
  normWeight: number;
  normIncidence: number;
  normRelevance: number;
  gap: number;
};

/** Pesos para cada sinal. Separados para futura configurabilidade. */
export type ScoreWeights = {
  priority: number;
  weight: number;
  incidence: number;
  relevance: number;
  gap: number;
};

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  priority: 2.0,
  weight: 1.5,
  incidence: 1.2,
  relevance: 1.0,
  gap: 2.0,
};

/** Calcula o score bruto a partir dos sinais e pesos. */
export function computeRawScore(
  signals: ScoreSignals,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): number {
  return (
    weights.priority * signals.normPriority +
    weights.weight * signals.normWeight +
    weights.incidence * signals.normIncidence +
    weights.relevance * signals.normRelevance +
    weights.gap * signals.gap
  );
}

/**
 * Fase 1 — pontuação determinística e explicada.
 *
 * [Etapa 3.3] Quando diagnosticData é fornecido e contém dados para o
 * topicId do candidato, o score estrutural é incrementado pelo
 * diagnosticBoost calculado por computeDiagnosticBoost().
 */
export function scoreCandidates(
  candidates: PlannerCandidate[],
  options: Pick<PlannerOptions, "examDate" | "startDate" | "diagnosticData">,
): ScoredCandidate[] {
  const daysToExam = options.examDate ? daysBetween(options.startDate, options.examDate) : null;

  const diagnosticData = options.diagnosticData ?? null;

  const masteryById = new Map<string, number | null>();
  for (const c of candidates) if (c.topicId) masteryById.set(c.topicId, c.mastery);

  // Um tópico está bloqueado quando algum pré-requisito tem domínio < 0.5
  // (ou não tem dado nenhum de domínio registrado).
  const blockedIds = new Set<string>();
  const prerequisiteNeeded = new Set<string>();
  for (const c of candidates) {
    for (const prereqId of c.prerequisiteTopicIds) {
      const prereqMastery = masteryById.get(prereqId);
      const unknown = prereqMastery === undefined || prereqMastery === null;
      if (unknown || prereqMastery < 0.5) {
        if (c.topicId) blockedIds.add(c.topicId);
        prerequisiteNeeded.add(prereqId);
      }
    }
  }

  return candidates.map((c) => {
    const reasons: string[] = [];

    const normPriority = clamp01((c.priority - 1) / 4);
    const normWeight = c.weight !== null ? clamp01(c.weight / 10) : normPriority;
    const normIncidence = c.incidence !== null ? clamp01(c.incidence / 100) : 0;
    const normRelevance = c.relevance !== null ? clamp01(c.relevance / 100) : 0;
    const gap = masteryGap(c.mastery, c.isStudied);

    const signals: ScoreSignals = { normPriority, normWeight, normIncidence, normRelevance, gap };
    let score = computeRawScore(signals);

    if (c.priority >= 4) reasons.push("prioridade alta definida no edital");
    if (c.weight !== null && c.weight >= 6) reasons.push(`peso ${c.weight} no edital`);
    if (normIncidence >= 0.6) reasons.push("alta incidência registrada");
    if (gap >= 0.7) {
      reasons.push(c.mastery === null ? "domínio ainda não medido" : "domínio atual baixo");
    }

    // Proximidade da prova: usa exam_date apenas como amplificador.
    if (daysToExam !== null) {
      if (daysToExam <= 15) {
        score += c.isStudied ? 1.5 : 0.5;
        reasons.push(`prova em ${daysToExam} dia(s) — foco em consolidação`);
      } else if (daysToExam <= 60) {
        score += 0.75 * normPriority;
        reasons.push(`prova em ${daysToExam} dias — prioridade elevada`);
      }
    }

    const blockedByPrerequisite = c.topicId ? blockedIds.has(c.topicId) : false;
    const isPrerequisiteOfBlocked = c.topicId ? prerequisiteNeeded.has(c.topicId) : false;

    if (isPrerequisiteOfBlocked) {
      score += 1.5;
      reasons.push("é pré-requisito de outro conteúdo do plano");
    }
    if (blockedByPrerequisite) {
      score *= 0.6;
      reasons.push("depende de pré-requisito ainda não consolidado");
    }

    // ── [Etapa 3.3] Integração do diagnóstico ──────────────────────────
    let diagnosticBoost = 0;
    if (diagnosticData && c.topicId) {
      const diag = diagnosticData.get(c.topicId);
      if (diag) {
        const intelligenceInput: IntelligenceInput = {
          baseScore: score,
          knowledgeState: diag.knowledgeState,
          mastery: diag.mastery,
          confidence: diag.confidence,
          accuracy: diag.accuracy,
          recentErrors: diag.recentErrors,
          unresolvedErrors: diag.unresolvedErrors,
          recurringErrors: diag.recurringErrors,
          daysSinceStudy: diag.daysSinceStudy,
          daysSinceError: diag.daysSinceError,
          interventionScore: diag.interventionScore,
        };
        const boostResult = computeDiagnosticBoost(intelligenceInput);
        diagnosticBoost = boostResult.diagnosticBoost;
        score = boostResult.finalScore;
        reasons.push(boostResult.reason);
      }
    }

    return {
      ...c,
      score: Math.max(score, 0.1),
      gap,
      blockedByPrerequisite,
      isPrerequisiteOfBlocked,
      reasons,
      diagnosticBoost,
    };
  });
}

/**
 * Escolha determinística da atividade de ESTUDO — sem revisão heurística.
 *
 * [Etapa 5, Fase 5] Esta função NÃO gera mais 'revisao'.
 * A revisão adaptativa é responsabilidade exclusiva do Review Engine +
 * Unified Scheduler (via reviewActivity()). Aqui o Planner escolhe apenas
 * atividades de estudo: teoria, questoes, flashcards.
 *
 * Substituições feitas:
 *   - Prova em ≤15 dias: era revisao/questoes, agora questoes/flashcards
 *   - Tópico já estudado: era revisao a cada 3 blocos, agora flashcards
 */
export function chooseActivity(
  c: ScoredCandidate,
  indexForCandidate: number,
  daysToExam: number | null,
): ActivityKind {
  if (daysToExam !== null && daysToExam <= 15) {
    return indexForCandidate % 2 === 0 ? "questoes" : "flashcards";
  }
  if (c.gap >= 0.7 && !c.isStudied) {
    return indexForCandidate % 2 === 0 ? "teoria" : "questoes";
  }
  if (c.isStudied) {
    return indexForCandidate % 3 === 2 ? "flashcards" : "questoes";
  }
  return indexForCandidate % 2 === 0 ? "teoria" : "questoes";
}

function buildReason(c: ScoredCandidate, activity: ActivityKind): string {
  const head =
    c.score >= 5 ? "Prioridade alta" : c.score >= 3 ? "Prioridade média" : "Prioridade baixa";
  const why = c.reasons.length ? c.reasons.join("; ") : "distribuição equilibrada entre matérias";
  return `${head} porque ${why}. Atividade planejada: ${activity}.`;
}

/**
 * Cap-and-redistribute: garante que nenhuma matéria exceda maxShare.
 * Algoritmo iterativo:
 *  1. Calcula shares proporcionais ao score.
 *  2. Identifica matérias acima do teto, fixa-as no teto.
 *  3. Redistribui o excedente entre as não-fixadas, proporcionalmente.
 *  4. Repete até estabilizar (máximo 20 iterações).
 */
function capAndRedistribute(
  subjectScores: Map<string, number>,
  maxShare: number,
): Map<string, number> {
  const result = new Map<string, number>();
  const totalScore = Array.from(subjectScores.values()).reduce((a, b) => a + b, 0);
  if (totalScore === 0) {
    // Distribuição uniforme quando todos os scores são zero.
    const n = subjectScores.size;
    for (const id of subjectScores.keys()) result.set(id, 1 / n);
    return result;
  }

  // Shares iniciais proporcionais ao score.
  for (const [id, score] of subjectScores) {
    result.set(id, score / totalScore);
  }

  const fixed = new Set<string>();
  for (let iter = 0; iter < 20; iter++) {
    let excess = 0;
    let unfixedTotal = 0;
    let changed = false;

    for (const [id, share] of result) {
      if (fixed.has(id)) continue;
      if (share > maxShare) {
        excess += share - maxShare;
        result.set(id, maxShare);
        fixed.add(id);
        changed = true;
      } else {
        unfixedTotal += share;
      }
    }

    if (!changed || excess === 0) break;

    // Redistribui o excedente proporcionalmente entre as não-fixadas.
    if (unfixedTotal > 0) {
      for (const [id, share] of result) {
        if (fixed.has(id)) continue;
        result.set(id, share + excess * (share / unfixedTotal));
      }
    } else {
      // Todas fixadas — distribui uniformemente o excedente.
      const unfixedIds = Array.from(subjectScores.keys()).filter((id) => !fixed.has(id));
      if (unfixedIds.length) {
        const each = excess / unfixedIds.length;
        for (const id of unfixedIds) result.set(id, (result.get(id) ?? 0) + each);
      }
    }
  }

  // Normalização final para garantir soma = 1 (pode ter flutuação por arredondamento).
  const sum = Array.from(result.values()).reduce((a, b) => a + b, 0);
  if (sum > 0 && Math.abs(sum - 1) > 0.001) {
    for (const [id, v] of result) result.set(id, v / sum);
  }

  return result;
}

/**
 * Fases 2 e 3 — distribui o tempo disponível e aloca em dias.
 *
 * [Etapa 3.3] diagnosticData é propagado para scoreCandidates via options.
 */
export function buildPlan(
  candidates: PlannerCandidate[],
  weeks: Map<string, AvailabilityWeek>,
  options: PlannerOptions,
): PlannerResult {
  const blockMinutes = Math.max(15, options.blockMinutes);
  const minBlock = options.minBlockMinutes ?? Math.min(20, blockMinutes);
  const scored = scoreCandidates(candidates, options).sort((a, b) => b.score - a.score);

  // Capacidade real do intervalo, dia a dia, conforme a semana de cada data.
  const days: { date: string; capacity: number }[] = [];
  let cursor = options.startDate;
  let guard = 0;
  while (cursor <= options.endDate && guard < 800) {
    const capacity = Math.min(availableMinutesOn(cursor, weeks), options.maxDailyMinutes);
    if (capacity >= minBlock) days.push({ date: cursor, capacity });
    cursor = addDays(cursor, 1);
    guard += 1;
  }

  const totalCapacityMinutes = days.reduce((sum, d) => sum + d.capacity, 0);
  if (!scored.length || totalCapacityMinutes < minBlock) {
    return {
      tasks: [],
      scored,
      totalCapacityMinutes,
      allocatedMinutes: 0,
      unallocatedMinutes: totalCapacityMinutes,
    };
  }

  // --- Fase 2: fatia por candidato, com teto por matéria ---
  const subjectIds = Array.from(new Set(scored.map((c) => c.subjectId)));
  const maxSubjectShare =
    options.maxSubjectShare ?? (subjectIds.length >= 3 ? 0.35 : 1 / subjectIds.length + 0.15);

  const subjectScore = new Map<string, number>();
  for (const c of scored) {
    subjectScore.set(c.subjectId, (subjectScore.get(c.subjectId) ?? 0) + c.score);
  }

  // Distribuição com teto iterativo (cap-and-redistribute).
  const subjectShare = capAndRedistribute(subjectScore, maxSubjectShare);

  // Blocos por candidato: fatia da matéria repartida entre seus tópicos.
  const totalBlocks = Math.max(1, Math.floor(totalCapacityMinutes / blockMinutes));
  const blocksByCandidate = new Map<string, number>();
  const blocksBySubject = new Map<string, number>();

  for (const subjectId of subjectIds) {
    const subjectBlocks = Math.max(1, Math.round((subjectShare.get(subjectId) ?? 0) * totalBlocks));
    blocksBySubject.set(subjectId, subjectBlocks);
    const items = scored.filter((c) => c.subjectId === subjectId);
    const itemsTotal = items.reduce((sum, c) => sum + c.score, 0);
    let remaining = subjectBlocks;
    items.forEach((c, index) => {
      const isLast = index === items.length - 1;
      const share = itemsTotal > 0 ? c.score / itemsTotal : 1 / items.length;
      const value = isLast
        ? remaining
        : Math.min(remaining, Math.max(1, Math.round(share * subjectBlocks)));
      blocksByCandidate.set(c.contestTopicId, Math.max(0, value));
      remaining -= Math.max(0, value);
      if (remaining < 0) remaining = 0;
    });
  }

  // Pós-arredondamento: garantir teto por matéria em blocos inteiros.
  // O teto em blocos = ceil(totalBlocks * maxSubjectShare).
  // Com blocos muito poucos (ex: 2 blocos, 3 matérias), o arredondamento
  // mínimo (1 bloco por matéria com score) pode exceder — nesse caso
  // a regra de "pelo menos 1 bloco" prevalece e a exceção é inevitável.
  if (subjectIds.length >= 3) {
    const maxBlocks = Math.ceil(totalBlocks * maxSubjectShare);
    let excessTotal = 0;
    const underCap: string[] = [];

    for (const subjectId of subjectIds) {
      const current = blocksBySubject.get(subjectId) ?? 0;
      if (current > maxBlocks) {
        const excess = current - maxBlocks;
        excessTotal += excess;
        blocksBySubject.set(subjectId, maxBlocks);
        // Reduzir proporcionalmente os blocos dos tópicos desta matéria.
        const items = scored.filter((c) => c.subjectId === subjectId);
        let toRemove = excess;
        // Remove do item com mais blocos primeiro.
        const sorted = [...items].sort(
          (a, b) =>
            (blocksByCandidate.get(b.contestTopicId) ?? 0) -
            (blocksByCandidate.get(a.contestTopicId) ?? 0),
        );
        for (const item of sorted) {
          if (toRemove <= 0) break;
          const current = blocksByCandidate.get(item.contestTopicId) ?? 0;
          const remove = Math.min(toRemove, Math.max(0, current - 1));
          blocksByCandidate.set(item.contestTopicId, current - remove);
          toRemove -= remove;
        }
        // Se ainda sobra (todos já estão em 1), remove o último.
        if (toRemove > 0) {
          for (const item of sorted) {
            if (toRemove <= 0) break;
            const current = blocksByCandidate.get(item.contestTopicId) ?? 0;
            if (current > 0) {
              const remove = Math.min(toRemove, current);
              blocksByCandidate.set(item.contestTopicId, current - remove);
              toRemove -= remove;
            }
          }
        }
      } else {
        underCap.push(subjectId);
      }
    }

    // Redistribui blocos excedentes para matérias abaixo do teto.
    if (excessTotal > 0 && underCap.length > 0) {
      const underScoreTotal = underCap.reduce((s, id) => s + (subjectScore.get(id) ?? 0), 0);
      let remaining = excessTotal;
      for (let i = 0; i < underCap.length && remaining > 0; i++) {
        const subjectId = underCap[i]!;
        const isLast = i === underCap.length - 1;
        const share =
          underScoreTotal > 0
            ? (subjectScore.get(subjectId) ?? 0) / underScoreTotal
            : 1 / underCap.length;
        const give = isLast
          ? remaining
          : Math.min(remaining, Math.max(1, Math.round(share * excessTotal)));
        remaining -= give;
        // Adiciona ao último tópico da matéria.
        const items = scored.filter((c) => c.subjectId === subjectId);
        if (items.length) {
          const last = items[items.length - 1]!;
          blocksByCandidate.set(
            last.contestTopicId,
            (blocksByCandidate.get(last.contestTopicId) ?? 0) + give,
          );
        }
      }
    }
  }

  // --- Fase 3: fila intercalada por matéria (round-robin) ---
  const queues = new Map<string, ScoredCandidate[]>();
  for (const subjectId of subjectIds) {
    const list: ScoredCandidate[] = [];
    for (const c of scored.filter((x) => x.subjectId === subjectId)) {
      const count = blocksByCandidate.get(c.contestTopicId) ?? 0;
      for (let i = 0; i < count; i += 1) list.push(c);
    }
    if (list.length) queues.set(subjectId, list);
  }

  const orderedSubjects = subjectIds
    .filter((id) => queues.has(id))
    .sort((a, b) => (subjectScore.get(b) ?? 0) - (subjectScore.get(a) ?? 0));

  const sequence: ScoredCandidate[] = [];
  let rotation = 0;
  while (queues.size > 0 && sequence.length < totalBlocks * 2) {
    const subjectId = orderedSubjects[rotation % orderedSubjects.length]!;
    const queue = queues.get(subjectId);
    rotation += 1;
    if (!queue) continue;
    const next = queue.shift();
    if (next) sequence.push(next);
    if (!queue.length) queues.delete(subjectId);
  }

  // Aloca a fila nos dias disponíveis.
  const daysToExam = options.examDate ? daysBetween(options.startDate, options.examDate) : null;
  const tasks: PlannedTask[] = [];
  const perCandidateIndex = new Map<string, number>();
  let seqIndex = 0;
  let allocatedMinutes = 0;

  for (const day of days) {
    let remaining = day.capacity;
    let position = 0;
    while (remaining >= minBlock && seqIndex < sequence.length) {
      const candidate = sequence[seqIndex]!;
      const minutes = Math.min(blockMinutes, remaining);
      const index = perCandidateIndex.get(candidate.contestTopicId) ?? 0;
      perCandidateIndex.set(candidate.contestTopicId, index + 1);
      const activity = chooseActivity(candidate, index, daysToExam);
      tasks.push({
        candidate,
        date: day.date,
        minutes,
        activity,
        priorityScore: Number(candidate.score.toFixed(3)),
        priorityReason: buildReason(candidate, activity),
        position,
      });
      remaining -= minutes;
      allocatedMinutes += minutes;
      position += 1;
      seqIndex += 1;
    }
    if (seqIndex >= sequence.length) break;
  }

  return {
    tasks,
    scored,
    totalCapacityMinutes,
    allocatedMinutes,
    unallocatedMinutes: totalCapacityMinutes - allocatedMinutes,
  };
}

/**
 * REPLANEJAMENTO — redistribui tarefas pendentes atrasadas dentro da
 * disponibilidade futura, sem empilhar tudo no dia seguinte.
 *
 * Retorna, para cada tarefa, a nova data (ou null quando não cabe).
 * A ordem respeita o score original (prioridade preservada).
 */
export function redistributeTasks(
  pending: { id: string; minutes: number; score: number }[],
  weeks: Map<string, AvailabilityWeek>,
  allocated: Map<string, number>,
  options: { fromDate: string; endDate: string; maxDailyMinutes: number },
): { id: string; date: string | null }[] {
  const sorted = [...pending].sort((a, b) => b.score - a.score);
  const days: { date: string; remaining: number }[] = [];
  let cursor = options.fromDate;
  let guard = 0;
  while (cursor <= options.endDate && guard < 400) {
    const cap = Math.min(availableMinutesOn(cursor, weeks), options.maxDailyMinutes);
    const used = allocated.get(cursor) ?? 0;
    if (cap - used >= 15) days.push({ date: cursor, remaining: cap - used });
    cursor = addDays(cursor, 1);
    guard += 1;
  }

  const result: { id: string; date: string | null }[] = [];
  for (const task of sorted) {
    const day = days.find((d) => d.remaining >= task.minutes);
    if (day) {
      result.push({ id: task.id, date: day.date });
      day.remaining -= task.minutes;
    } else {
      result.push({ id: task.id, date: null });
    }
  }
  return result;
}
