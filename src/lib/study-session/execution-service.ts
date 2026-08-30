/**
 * SESSION EXECUTION SERVICE — Fase 4
 *
 * Camada de execução das atividades da sessão de estudo.
 * Encaminha o resultado da conclusão de cada atividade para o fluxo
 * já existente, conforme o tipo da atividade:
 *
 *   Questões    → submitAnswer() (attempt-service)
 *                 → error-integration → knowledge-integration
 *   Revisão     → getTopicReviewDecision() + recordReviewEvent() (review service)
 *   Estudo novo → apenas conclusão da atividade (completeActivity)
 *   Flashcards  → apenas conclusão da atividade (SRS NÃO implementado nesta fase)
 *
 * REUTILIZA (nada é reimplementado aqui):
 *   - src/lib/questions/attempt-service.ts  → submitAnswer
 *   - src/lib/review/service.ts             → getTopicReviewDecision, recordReviewEvent
 *   - src/lib/study-session/session-service.ts → completeActivity
 *
 * NÃO FAZ:
 *   - Recalcular mastery, confidence, urgência, intervalos ou prioridade
 *   - Criar error_entry diretamente (delegado ao attempt-service)
 *   - Alterar Knowledge/Diagnosis/Planner/Review Engines ou Unified Scheduler
 *   - Implementar SRS de flashcards
 *   - Criar UI, rota ou migration
 *
 * IDEMPOTÊNCIA:
 *   A tarefa é lida uma única vez no início. Se já estiver 'concluida',
 *   nenhum efeito pedagógico é disparado e o resultado retorna
 *   alreadyCompleted = true. Assim, respostas, error_entries e
 *   review_events nunca são duplicados por reexecução.
 *
 * PERFORMANCE:
 *   - 1 leitura da tarefa (join de matéria/tópico não é necessário aqui)
 *   - Questões: 1 chamada por resposta enviada (o attempt-service já é
 *     otimizado internamente); nenhuma leitura extra por questão
 *   - Revisão: reaproveita getTopicReviewDecision (2 queries em paralelo)
 *
 * SEGURANÇA:
 *   Usuário sempre obtido da sessão autenticada; RLS por user_id é a
 *   fronteira de segurança em todas as leituras e escritas.
 */

import { supabase } from "@/integrations/supabase/client";
import { submitAnswer } from "../questions/attempt-service";
import type { AttemptMode } from "../questions/types";
import { getTopicReviewDecision, recordReviewEvent } from "../review/service";
import { completeActivity } from "./session-service";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

/** Fluxo de execução ao qual a atividade pertence. */
export type ActivityExecutionKind = "questions" | "review" | "study" | "flashcards";

/** Resposta individual de questão enviada junto com a conclusão da atividade. */
export type ActivityQuestionAnswer = {
  questionId: string;
  chosenAnswer: string;
  isCorrect: boolean;
  timeSpentSeconds?: number | null;
  declaredConfidence?: number | null;
  notes?: string | null;
};

/** Resultado declarado pelo usuário para uma atividade de revisão. */
export type ActivityReviewOutcome = {
  result: "success" | "partial" | "fail";
  notes?: string | null;
};

export type ExecuteActivityInput = {
  sessionId: string;
  taskId: string;
  actualMinutes: number;
  /** Respostas de questões (usado apenas em atividades de questões/simulado/exercícios) */
  questionAnswers?: ActivityQuestionAnswer[];
  /** Resultado da revisão (usado apenas em atividades de revisão) */
  reviewOutcome?: ActivityReviewOutcome;
  /** Concurso vinculado, repassado ao attempt-service */
  contestId?: string | null;
  notes?: string | null;
};

export type ActivityAttemptOutcome = {
  questionId: string;
  attemptId: string;
  isCorrect: boolean;
  errorCreated: boolean;
  errorEntryId: string | null;
  knowledgeUpdated: boolean;
};

export type ActivityReviewRegistration = {
  reviewEventId: string;
  nextReviewAt: string;
  reviewCount: number;
  reviewType: "manutencao" | "consolidacao" | "recuperacao" | "erro_direcionado";
  reviewIntensity: "leve" | "moderada" | "intensiva";
};

export type ExecuteActivityResult = {
  taskId: string;
  /** Tipo da atividade preservado como está registrado na tarefa */
  activity: string;
  /** Fluxo de execução escolhido a partir do tipo da atividade */
  kind: ActivityExecutionKind;
  /** true quando a atividade já estava concluída (nenhum efeito novo) */
  alreadyCompleted: boolean;
  attempts: ActivityAttemptOutcome[];
  questionsCount: number;
  correctCount: number;
  wrongCount: number;
  review: ActivityReviewRegistration | null;
  warnings: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICAÇÃO DA ATIVIDADE
// ─────────────────────────────────────────────────────────────────────────────

const QUESTION_ACTIVITIES = new Set(["questoes", "simulado", "exercicios"]);
const REVIEW_ACTIVITIES = new Set(["revisao"]);
const FLASHCARD_ACTIVITIES = new Set(["flashcards"]);

/**
 * Determina o fluxo de execução a partir do tipo da atividade.
 * Função pura — nenhuma regra pedagógica nova.
 */
export function resolveExecutionKind(activity: string | null): ActivityExecutionKind {
  const key = (activity ?? "").trim();
  if (QUESTION_ACTIVITIES.has(key)) return "questions";
  if (REVIEW_ACTIVITIES.has(key)) return "review";
  if (FLASHCARD_ACTIVITIES.has(key)) return "flashcards";
  return "study";
}

/** Modo de tentativa correspondente à atividade (mapeamento direto). */
function attemptModeFor(activity: string): AttemptMode {
  if (activity === "simulado") return "simulado";
  if (activity === "revisao") return "revisao";
  return "estudo";
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function requireUser(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Usuário não autenticado.");
  }
  return data.user.id;
}

type TaskRow = {
  id: string;
  status: string | null;
  session_id: string | null;
  activity: string | null;
  activity_type: string | null;
  topic_id: string | null;
  subject_id: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// API PÚBLICA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conclui uma atividade da sessão e encaminha o resultado ao fluxo correto.
 *
 * Fluxo:
 *   1. Autenticar usuário (sessão)
 *   2. Ler a tarefa (1 query) e validar vínculo com a sessão
 *   3. Idempotência: tarefa já concluída → retorna sem efeitos
 *   4. Despachar conforme o tipo:
 *        questões    → submitAnswer por resposta
 *        revisão     → getTopicReviewDecision + recordReviewEvent
 *        estudo novo → nada além da conclusão
 *        flashcards  → nada além da conclusão
 *   5. Concluir a atividade via completeActivity (persistência já existente)
 */
export async function executeActivityCompletion(
  input: ExecuteActivityInput,
): Promise<ExecuteActivityResult> {
  const userId = await requireUser();
  const { sessionId, taskId, actualMinutes } = input;

  // 2. Ler tarefa (única leitura da tarefa neste serviço)
  const { data: task, error: taskError } = await supabase
    .from("plan_tasks")
    .select("id, status, session_id, activity, activity_type, topic_id, subject_id")
    .eq("id", taskId)
    .eq("user_id", userId)
    .single();

  if (taskError || !task) {
    throw taskError ?? new Error("Tarefa não encontrada.");
  }

  const row = task as TaskRow;

  if (row.session_id !== sessionId) {
    throw new Error("Tarefa não pertence a esta sessão.");
  }

  const activity = row.activity ?? row.activity_type ?? "teoria";
  const kind = resolveExecutionKind(activity);
  const warnings: string[] = [];

  // 3. Idempotência — nenhum efeito pedagógico é reexecutado
  if (row.status === "concluida") {
    return {
      taskId,
      activity,
      kind,
      alreadyCompleted: true,
      attempts: [],
      questionsCount: 0,
      correctCount: 0,
      wrongCount: 0,
      review: null,
      warnings: ["atividade_ja_concluida"],
    };
  }

  const attempts: ActivityAttemptOutcome[] = [];
  let review: ActivityReviewRegistration | null = null;
  let questionsCount = 0;
  let correctCount = 0;
  let wrongCount = 0;

  // 4. Despacho por tipo de atividade
  if (kind === "questions") {
    const answers = input.questionAnswers ?? [];
    if (answers.length === 0) {
      warnings.push("atividade_de_questoes_sem_respostas");
    }

    for (const answer of answers) {
      // submitAnswer já executa: insert da tentativa → stats →
      // error-integration (dedup por attempt_id) → knowledge-integration.
      const result = await submitAnswer({
        questionId: answer.questionId,
        chosenAnswer: answer.chosenAnswer,
        isCorrect: answer.isCorrect,
        timeSpentSeconds: answer.timeSpentSeconds ?? null,
        mode: attemptModeFor(activity),
        declaredConfidence: answer.declaredConfidence ?? null,
        contestId: input.contestId ?? null,
        sessionId,
        notes: answer.notes ?? null,
      });

      attempts.push({
        questionId: answer.questionId,
        attemptId: result.attemptId,
        isCorrect: answer.isCorrect,
        errorCreated: result.errorCreated,
        errorEntryId: result.errorEntryId,
        knowledgeUpdated: result.knowledgeUpdated,
      });

      questionsCount += 1;
      if (answer.isCorrect) correctCount += 1;
      else wrongCount += 1;
    }
  } else if (kind === "review") {
    if (!row.topic_id) {
      warnings.push("revisao_sem_topico");
    } else if (!input.reviewOutcome) {
      warnings.push("revisao_sem_resultado_declarado");
    } else {
      // Parâmetros pedagógicos vêm do Review Engine via service — não recalculados aqui.
      const decision = await getTopicReviewDecision(row.topic_id);

      if (!decision) {
        warnings.push("sem_estado_de_conhecimento_para_revisao");
      } else {
        const recorded = await recordReviewEvent({
          topicId: row.topic_id,
          subjectId: row.subject_id ?? null,
          result: input.reviewOutcome.result,
          reviewType: decision.reviewType,
          reviewIntensity: decision.reviewIntensity,
          intervalDays: decision.reviewInterval,
          masteryAtReview: decision.input.mastery,
          confidenceAtReview: decision.input.confidence,
          sessionId,
          taskId,
          notes: input.reviewOutcome.notes ?? null,
        });

        review = {
          reviewEventId: recorded.reviewEventId,
          nextReviewAt: recorded.nextReviewAt,
          reviewCount: recorded.reviewCount,
          reviewType: decision.reviewType,
          reviewIntensity: decision.reviewIntensity,
        };
      }
    }
  } else if (kind === "flashcards") {
    // SRS de flashcards não pertence a esta fase: o tipo é preservado
    // e apenas a conclusão da atividade é registrada.
    warnings.push("flashcards_sem_srs_nesta_fase");
  }

  // 5. Conclusão da atividade (persistência existente, idempotente)
  const completion = await completeActivity({
    sessionId,
    taskId,
    actualMinutes,
    questionsCount,
    correctCount,
    wrongCount,
    ...(input.notes ? { notes: input.notes } : {}),
  });

  return {
    taskId,
    activity,
    kind,
    alreadyCompleted: completion.alreadyCompleted,
    attempts,
    questionsCount,
    correctCount,
    wrongCount,
    review,
    warnings,
  };
}
