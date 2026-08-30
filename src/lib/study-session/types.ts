/**
 * TIPOS DO MOTOR DE SESSÃO DE ESTUDO — Fase 1
 *
 * Tipos puros para o motor que transforma tarefas já planejadas
 * (pelo Planner/Unified Scheduler) em uma sequência ordenada de
 * atividades para uma sessão de estudo.
 *
 * Nenhuma lógica aqui — apenas contratos de dados.
 *
 * Reutiliza tipos existentes do projeto:
 *   - ActivityKind         (planner/engine.ts)
 *   - UnifiedTaskSource    (scheduler/types.ts)
 *   - KnowledgeStateName   (diagnosis/engine.ts)
 */

import type { ActivityKind } from "../planner/engine";
import type { UnifiedTaskSource } from "../scheduler/types";

// ─────────────────────────────────────────────────────────────────────────────
// ENTRADA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tarefa candidata para a sessão de estudo.
 * Produzida pelo Unified Scheduler ou pelo Planner.
 * O motor de sessão NÃO recalcula scores — apenas ordena e fatia.
 */
export type SessionTaskInput = {
  /** ID único da tarefa */
  taskId: string;
  /** ID do tópico */
  topicId: string;
  /** ID da matéria */
  subjectId: string;
  /** Nome da matéria */
  subjectName: string;
  /** Nome do tópico */
  topicName: string;
  /** Tipo de atividade */
  activity: ActivityKind;
  /** Origem da tarefa */
  source: UnifiedTaskSource;
  /** Minutos planejados */
  plannedMinutes: number;
  /** Score de prioridade unificado (já calculado pelo scheduler/planner) */
  priorityScore: number;
  /** Razão explicativa da prioridade */
  priorityReason: string;
  /** Urgência da revisão (0..1), null se estudo novo */
  reviewUrgency: number | null;
  /** Tipo de revisão, null se estudo novo */
  reviewType: "manutencao" | "consolidacao" | "recuperacao" | "erro_direcionado" | null;
  /** Intensidade da revisão, null se estudo novo */
  reviewIntensity: "leve" | "moderada" | "intensiva" | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuração do motor de sessão de estudo.
 * Define limites e preferências para a montagem da sequência.
 */
export type SessionConfig = {
  /** Duração disponível para a sessão (minutos) */
  availableMinutes: number;
  /** Duração mínima de uma atividade (minutos). Abaixo disso, descarta. */
  minActivityMinutes: number;
  /**
   * Teto de participação de uma matéria na sessão (0..1).
   * Ex: 0.5 = nenhuma matéria ocupa mais de 50% da sessão.
   * 1 = sem limite.
   */
  maxSubjectShare: number;
  /**
   * Se true, intercala matérias diferentes (round-robin por matéria).
   * Se false, agrupa por matéria.
   */
  interleaveSubjects: boolean;
  /**
   * Estratégia de ordenação dentro de cada grupo:
   * - "priority": maior priorityScore primeiro
   * - "review_first": revisões antes de estudo novo, depois por prioridade
   * - "study_first": estudo novo antes de revisões, depois por prioridade
   */
  ordering: "priority" | "review_first" | "study_first";
};

// ─────────────────────────────────────────────────────────────────────────────
// SAÍDA — ITEM DA SESSÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atividade individual na sequência da sessão de estudo.
 * Contém a tarefa original + posição e minutos ajustados.
 */
export type SessionActivity = {
  /** Referência à tarefa original */
  taskId: string;
  /** ID do tópico */
  topicId: string;
  /** ID da matéria */
  subjectId: string;
  /** Nome da matéria */
  subjectName: string;
  /** Nome do tópico */
  topicName: string;
  /** Tipo de atividade */
  activity: ActivityKind;
  /** Origem da tarefa */
  source: UnifiedTaskSource;
  /** Minutos alocados nesta sessão (pode ser menor que o planejado) */
  allocatedMinutes: number;
  /** Minutos originalmente planejados */
  plannedMinutes: number;
  /** Score de prioridade (preservado da entrada) */
  priorityScore: number;
  /** Razão explicativa da prioridade */
  priorityReason: string;
  /** Posição na sequência (0-based) */
  position: number;
  /** Urgência da revisão (0..1), null se estudo novo */
  reviewUrgency: number | null;
  /** Tipo de revisão, null se estudo novo */
  reviewType: "manutencao" | "consolidacao" | "recuperacao" | "erro_direcionado" | null;
  /** Intensidade da revisão, null se estudo novo */
  reviewIntensity: "leve" | "moderada" | "intensiva" | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// SAÍDA — RESULTADO DA SESSÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resultado da construção da sessão de estudo.
 * Contém a sequência de atividades e métricas.
 */
export type SessionResult = {
  /** Sequência ordenada de atividades */
  activities: SessionActivity[];
  /** Minutos totais alocados */
  allocatedMinutes: number;
  /** Minutos disponíveis originais */
  availableMinutes: number;
  /** Minutos não alocados (sobra) */
  unallocatedMinutes: number;
  /** Tarefas descartadas por não caber na sessão */
  discardedTasks: DiscardedTask[];
  /** Avisos não-bloqueantes */
  warnings: string[];
};

/**
 * Tarefa que não coube na sessão.
 */
export type DiscardedTask = {
  /** ID da tarefa */
  taskId: string;
  /** ID do tópico */
  topicId: string;
  /** Motivo do descarte */
  reason: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// RE-EXPORTS para conveniência
// ─────────────────────────────────────────────────────────────────────────────

export type { ActivityKind } from "../planner/engine";
export type { UnifiedTaskSource } from "../scheduler/types";
