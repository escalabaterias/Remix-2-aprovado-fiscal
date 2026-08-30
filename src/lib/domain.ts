/**
 * Rótulos e tipos de domínio compartilhados (espelham os enums do banco).
 * Mantidos em um único lugar para evitar strings soltas nos componentes.
 */
import type { Database } from "@/integrations/supabase/types";

type Enums = Database["public"]["Enums"];

export type ContestStatus = Enums["contest_status"];
export type EditalStatus = Enums["edital_status"];
export type ProcessingStatus = Enums["processing_status"];
export type SourceType = Enums["source_type"];
export type TopicKind = Enums["topic_kind"];
export type CoachIntensity = Enums["coach_intensity"];
export type CoachAutonomy = Enums["coach_autonomy"];

export const CONTEST_STATUS_LABELS: Record<ContestStatus, string> = {
  futuro: "Futuro",
  ativo: "Ativo",
  concluido: "Concluído",
  arquivado: "Arquivado",
};

export const EDITAL_STATUS_LABELS: Record<EditalStatus, string> = {
  rascunho: "Rascunho",
  publicado: "Publicado",
  retificado: "Retificado",
  substituido: "Substituído",
  arquivado: "Arquivado",
};

export const PROCESSING_STATUS_LABELS: Record<ProcessingStatus, string> = {
  pendente: "Pendente",
  processando: "Processando",
  processado: "Processado",
  erro: "Erro",
  ignorado: "Ignorado",
};

export const TOPIC_KIND_LABELS: Record<TopicKind, string> = {
  topico: "Tópico",
  subtopico: "Subtópico",
  conceito: "Conceito",
};

export const COACH_INTENSITY_LABELS: Record<CoachIntensity, string> = {
  leve: "Leve",
  moderada: "Moderada",
  intensa: "Intensa",
};

export const COACH_AUTONOMY_LABELS: Record<CoachAutonomy, string> = {
  sugestivo: "Sugestivo",
  assistido: "Assistido",
  autonomo: "Autônomo",
};

export const PRIORITY_LABELS: Record<number, string> = {
  1: "Muito baixa",
  2: "Baixa",
  3: "Média",
  4: "Alta",
  5: "Crítica",
};

export type TaskStatus = Enums["task_status"];
export type ActivityKindEnum = Enums["activity_kind"];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  parcialmente_concluida: "Parcialmente concluída",
  adiada: "Adiada",
  cancelada: "Cancelada",
  reagendada: "Reagendada",
};

export const ACTIVITY_LABELS: Record<ActivityKindEnum, string> = {
  teoria: "Teoria",
  questoes: "Questões",
  revisao: "Revisão",
  flashcards: "Flashcards",
  simulado: "Simulado",
  exercicios: "Exercícios",
  leitura: "Leitura",
  estudo_dirigido: "Estudo dirigido",
};
