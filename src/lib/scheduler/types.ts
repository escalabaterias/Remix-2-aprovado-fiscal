/**
 * TIPOS DO UNIFIED SCHEDULER — Etapa 5, Fase 1
 *
 * Tipos puros para o futuro sistema unificado de estudo + revisão.
 * Nenhuma lógica aqui — apenas contratos de dados.
 *
 * Reutiliza tipos existentes do projeto:
 *   - ActivityKind          (planner/engine.ts)
 *   - KnowledgeStateName    (diagnosis/engine.ts)
 *   - AvailabilityWeek      (planner/availability.ts)
 *   - TopicReviewDecision   (review/types.ts) — reviewType, reviewIntensity
 */

import type { ActivityKind } from "../planner/engine";
import type { KnowledgeStateName } from "../diagnosis/engine";
import type { AvailabilityWeek } from "../planner/availability";

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE
// ─────────────────────────────────────────────────────────────────────────────

/** Origem da tarefa na agenda unificada. Espelha o CHECK do banco. */
export type UnifiedTaskSource = "planner" | "review_engine" | "manual";

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED TASK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tarefa final da agenda unificada.
 * Campos de revisão aceitam null quando a tarefa é estudo novo (source = 'planner').
 */
export type UnifiedTask = {
  /** ID da tarefa (plan_tasks.id) */
  taskId: string;
  /** ID do tópico */
  topicId: string;
  /** ID da matéria */
  subjectId: string;
  /** Nome da matéria */
  subjectName: string;
  /** Nome do tópico */
  topicName: string;
  /** Data agendada (ISO YYYY-MM-DD) */
  scheduledDate: string;
  /** Minutos planejados para a tarefa */
  plannedMinutes: number;
  /** Tipo de atividade */
  activity: ActivityKind;
  /** Origem da tarefa */
  source: UnifiedTaskSource;
  /** Score de prioridade unificado (combina planner + review) */
  unifiedPriorityScore: number;
  /** Razão explicativa da prioridade */
  priorityReason: string;
  /** Urgência da revisão (0..1), null se estudo novo */
  reviewUrgency: number | null;
  /** Tipo de revisão, null se estudo novo */
  reviewType: "manutencao" | "consolidacao" | "recuperacao" | "erro_direcionado" | null;
  /** Intensidade da revisão, null se estudo novo */
  reviewIntensity: "leve" | "moderada" | "intensiva" | null;
  /** Posição na agenda do dia */
  position: number;
  /** ID do bloco de estudo (plan_blocks.id), null se avulso */
  blockId: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW TASK CANDIDATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Item da fila de revisão adaptado para o futuro scheduler.
 * Produzido pelo Review Service, consumido pelo Unified Scheduler.
 */
export type ReviewTaskCandidate = {
  /** ID do tópico */
  topicId: string;
  /** ID da matéria */
  subjectId: string;
  /** Nome da matéria */
  subjectName: string;
  /** Nome do tópico */
  topicName: string;
  /** Urgência da revisão (0..1) */
  reviewUrgency: number;
  /** Tipo de revisão recomendado */
  reviewType: "manutencao" | "consolidacao" | "recuperacao" | "erro_direcionado";
  /** Intensidade recomendada */
  reviewIntensity: "leve" | "moderada" | "intensiva";
  /** Intervalo calculado em dias até a próxima revisão */
  reviewInterval: number;
  /** Minutos estimados para a sessão de revisão */
  estimatedMinutes: number;
  /** Intervention score do Diagnostic Engine (0..1) */
  interventionScore: number;
  /** Estado pedagógico do Knowledge/Diagnosis Engine */
  knowledgeState: KnowledgeStateName | null;
  /** Prioridade estrutural do planner (score original) */
  structuralPriority: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER CONFIG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuração do Unified Scheduler.
 * Define os limites e parâmetros para distribuição de tempo entre
 * estudo novo e revisão.
 */
export type UnifiedSchedulerConfig = {
  /** Percentual padrão de capacidade reservada para revisão (0..1) */
  reviewCap: number;
  /** Mínimo de minutos garantidos para revisão por dia (floor) */
  reviewFloor: number;
  /** Capacidade extra para revisões urgentes (minutos adicionais) */
  urgentReviewExtraCap: number;
  /** Teto absoluto de minutos de revisão por dia */
  absoluteReviewCeiling: number;
  /**
   * Minutos estimados por intensidade de revisão.
   * Ex: { leve: 15, moderada: 30, intensiva: 50 }
   */
  reviewMinutesPerIntensity: Record<"leve" | "moderada" | "intensiva", number>;
  /** Data da prova (ISO), null se não definida */
  examDate: string | null;
  /** Início do período de planejamento (ISO) */
  startDate: string;
  /** Fim do período de planejamento (ISO) */
  endDate: string;
  /** Duração padrão de um bloco de estudo (minutos) */
  blockMinutes: number;
  /** Teto de minutos de estudo por dia */
  maxDailyMinutes: number;
  /** Teto de participação de uma matéria no total (0..1) */
  maxSubjectShare: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER RESULT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resultado da execução do Unified Scheduler.
 * Contém as tarefas geradas e métricas de distribuição.
 */
export type UnifiedSchedulerResult = {
  /** Lista de tarefas unificadas geradas */
  tasks: UnifiedTask[];
  /** Capacidade total em minutos no período */
  totalCapacityMinutes: number;
  /** Minutos alocados para estudo novo */
  studyMinutes: number;
  /** Minutos alocados para revisão */
  reviewMinutes: number;
  /** Minutos não alocados (sobra de capacidade) */
  unallocatedMinutes: number;
  /** Tópicos que apareciam tanto no planner quanto na revisão e foram deduplicados */
  deduplicatedTopics: string[];
  /** Quantidade de itens na fila de revisão que não couberam na agenda */
  reviewBacklog: number;
  /** Avisos não-bloqueantes do scheduler */
  warnings: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// RE-EXPORTS para conveniência
// ─────────────────────────────────────────────────────────────────────────────

export type { ActivityKind } from "../planner/engine";
export type { KnowledgeStateName } from "../diagnosis/engine";
export type { AvailabilityWeek } from "../planner/availability";
