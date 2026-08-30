/**
 * TESTES DA EXECUÇÃO DE ATIVIDADES — Fase 4
 *
 * Valida o encaminhamento da conclusão de uma atividade para o fluxo
 * correto, reutilizando os services existentes (mockados) e garantindo
 * idempotência, autenticação, ausência de duplicação e sem N+1.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────────────────────────────

let mockAuthUser: { id: string } | null = { id: "user-1" };

type TaskRow = {
  id: string;
  status: string | null;
  session_id: string | null;
  activity: string | null;
  activity_type: string | null;
  topic_id: string | null;
  subject_id: string | null;
};

let mockTask: TaskRow | null = null;
let mockTaskError: unknown = null;

const calls: { name: string; args: unknown[] }[] = [];
function track(name: string, ...args: unknown[]) {
  calls.push({ name, args });
}

type ChainFn = (...args: unknown[]) => Chain;
type Chain = {
  select: ChainFn;
  eq: ChainFn;
  in: ChainFn;
  order: ChainFn;
  maybeSingle: ChainFn;
  single: () => Promise<{ data: TaskRow | null; error: unknown }>;
  then: (resolve: (value: { data: TaskRow[]; error: unknown }) => void) => void;
};

function createSelectChain(): Chain {
  const chain = {} as Chain;
  const methods = ["select", "eq", "in", "order", "maybeSingle"] as const;
  for (const m of methods) {
    chain[m] = (...args: unknown[]) => {
      track(`plan_tasks.${m}`, ...args);
      return chain;
    };
  }
  chain.single = () => Promise.resolve({ data: mockTask, error: mockTaskError });
  chain.then = (resolve) => resolve({ data: mockTask ? [mockTask] : [], error: mockTaskError });
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockAuthUser }, error: null }),
    },
    from: (table: string) => {
      track("from", table);
      return { select: (...a: unknown[]) => createSelectChain().select(...a) };
    },
  },
}));

type SubmitInput = {
  questionId: string;
  isCorrect: boolean;
  mode: string;
  sessionId: string | null;
  contestId: string | null;
};
type SubmitOutput = {
  attemptId: string;
  attemptNumber: number;
  feedback: Record<string, unknown>;
  updatedStats: Record<string, unknown>;
  errorCreated: boolean;
  errorEntryId: string | null;
  knowledgeUpdated: boolean;
};

let mockSubmitAnswerImpl: (input: SubmitInput) => Promise<SubmitOutput> = async (input) => ({
  attemptId: `attempt-${input.questionId}`,
  attemptNumber: 1,
  feedback: {},
  updatedStats: {},
  errorCreated: !input.isCorrect,
  errorEntryId: input.isCorrect ? null : `err-${input.questionId}`,
  knowledgeUpdated: true,
});

vi.mock("../questions/attempt-service", () => ({
  submitAnswer: (input: SubmitInput) => {
    track("submitAnswer", input);
    return mockSubmitAnswerImpl(input);
  },
}));

type MockDecision = {
  needsReview: boolean;
  reviewUrgency: number;
  suggestedReviewDate: string;
  reviewInterval: number;
  reviewReason: string;
  reviewIntensity: "leve" | "moderada" | "intensiva";
  reviewType: "manutencao" | "consolidacao" | "recuperacao" | "erro_direcionado";
  topicId: string;
  input: { mastery: number; confidence: number };
};

let mockDecision: MockDecision | null = {
  needsReview: true,
  reviewUrgency: 0.8,
  suggestedReviewDate: "2026-09-05",
  reviewInterval: 5,
  reviewReason: "teste",
  reviewIntensity: "moderada",
  reviewType: "consolidacao",
  topicId: "topic-1",
  input: { mastery: 0.42, confidence: 0.55 },
};

vi.mock("../review/service", () => ({
  getTopicReviewDecision: (...args: unknown[]) => {
    track("getTopicReviewDecision", ...args);
    return Promise.resolve(mockDecision);
  },
  recordReviewEvent: (input: unknown) => {
    track("recordReviewEvent", input);
    return Promise.resolve({
      reviewEventId: "review-1",
      nextReviewAt: "2026-09-05",
      reviewCount: 3,
    });
  },
}));

let mockAlreadyCompleted = false;

vi.mock("./session-service", () => ({
  completeActivity: (input: unknown) => {
    track("completeActivity", input);
    return Promise.resolve({ alreadyCompleted: mockAlreadyCompleted });
  },
}));

import { executeActivityCompletion, resolveExecutionKind } from "./execution-service";

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task-1",
    status: "pendente",
    session_id: "session-1",
    activity: "teoria",
    activity_type: null,
    topic_id: "topic-1",
    subject_id: "subject-1",
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  mockAuthUser = { id: "user-1" };
  mockTask = task();
  mockTaskError = null;
  mockAlreadyCompleted = false;
  mockDecision = {
    needsReview: true,
    reviewUrgency: 0.8,
    suggestedReviewDate: "2026-09-05",
    reviewInterval: 5,
    reviewReason: "teste",
    reviewIntensity: "moderada",
    reviewType: "consolidacao",
    topicId: "topic-1",
    input: { mastery: 0.42, confidence: 0.55 },
  };
  mockSubmitAnswerImpl = async (input) => ({
    attemptId: `attempt-${input.questionId}`,
    attemptNumber: 1,
    feedback: {},
    updatedStats: {},
    errorCreated: !input.isCorrect,
    errorEntryId: input.isCorrect ? null : `err-${input.questionId}`,
    knowledgeUpdated: true,
  });
});

const countOf = (name: string) => calls.filter((c) => c.name === name).length;

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveExecutionKind", () => {
  it("classifica questões, simulado e exercícios como fluxo de questões", () => {
    expect(resolveExecutionKind("questoes")).toBe("questions");
    expect(resolveExecutionKind("simulado")).toBe("questions");
    expect(resolveExecutionKind("exercicios")).toBe("questions");
  });

  it("classifica revisão e flashcards separadamente", () => {
    expect(resolveExecutionKind("revisao")).toBe("review");
    expect(resolveExecutionKind("flashcards")).toBe("flashcards");
  });

  it("trata teoria, leitura e valores desconhecidos/nulos como estudo novo", () => {
    expect(resolveExecutionKind("teoria")).toBe("study");
    expect(resolveExecutionKind("leitura")).toBe("study");
    expect(resolveExecutionKind("estudo_dirigido")).toBe("study");
    expect(resolveExecutionKind(null)).toBe("study");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEGURANÇA E VALIDAÇÕES
// ─────────────────────────────────────────────────────────────────────────────

describe("executeActivityCompletion — segurança", () => {
  it("exige usuário autenticado", async () => {
    mockAuthUser = null;
    await expect(
      executeActivityCompletion({ sessionId: "session-1", taskId: "task-1", actualMinutes: 30 }),
    ).rejects.toThrow("Usuário não autenticado.");
    expect(countOf("completeActivity")).toBe(0);
  });

  it("filtra a leitura da tarefa por id e user_id (RLS + escopo)", async () => {
    await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 30,
    });
    const eqArgs = calls.filter((c) => c.name === "plan_tasks.eq").map((c) => c.args[0]);
    expect(eqArgs).toContain("id");
    expect(eqArgs).toContain("user_id");
  });

  it("rejeita tarefa inexistente", async () => {
    mockTask = null;
    await expect(
      executeActivityCompletion({ sessionId: "session-1", taskId: "task-x", actualMinutes: 10 }),
    ).rejects.toThrow("Tarefa não encontrada.");
  });

  it("rejeita tarefa de outra sessão", async () => {
    mockTask = task({ session_id: "session-outra" });
    await expect(
      executeActivityCompletion({ sessionId: "session-1", taskId: "task-1", actualMinutes: 10 }),
    ).rejects.toThrow("Tarefa não pertence a esta sessão.");
    expect(countOf("completeActivity")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QUESTÕES
// ─────────────────────────────────────────────────────────────────────────────

describe("executeActivityCompletion — questões", () => {
  it("encaminha cada resposta ao attempt-service e agrega contadores", async () => {
    mockTask = task({ activity: "questoes" });
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 40,
      questionAnswers: [
        { questionId: "q1", chosenAnswer: "A", isCorrect: true },
        { questionId: "q2", chosenAnswer: "B", isCorrect: false },
        { questionId: "q3", chosenAnswer: "C", isCorrect: false },
      ],
    });

    expect(result.kind).toBe("questions");
    expect(countOf("submitAnswer")).toBe(3);
    expect(result.questionsCount).toBe(3);
    expect(result.correctCount).toBe(1);
    expect(result.wrongCount).toBe(2);
    expect(result.attempts.map((a) => a.attemptId)).toEqual([
      "attempt-q1",
      "attempt-q2",
      "attempt-q3",
    ]);
  });

  it("não cria error_entry por conta própria — apenas propaga o resultado do attempt-service", async () => {
    mockTask = task({ activity: "questoes" });
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 20,
      questionAnswers: [{ questionId: "q2", chosenAnswer: "B", isCorrect: false }],
    });

    expect(result.attempts[0]!.errorCreated).toBe(true);
    expect(result.attempts[0]!.errorEntryId).toBe("err-q2");
    // Nenhuma escrita direta em error_entries por este serviço
    expect(calls.filter((c) => c.name === "from" && c.args[0] === "error_entries")).toHaveLength(0);
  });

  it("propaga knowledgeUpdated sem recalcular mastery", async () => {
    mockTask = task({ activity: "questoes" });
    mockSubmitAnswerImpl = async (input) => ({
      attemptId: `attempt-${input.questionId}`,
      attemptNumber: 1,
      feedback: {},
      updatedStats: {},
      errorCreated: false,
      errorEntryId: null,
      knowledgeUpdated: false,
    });

    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 20,
      questionAnswers: [{ questionId: "q1", chosenAnswer: "A", isCorrect: true }],
    });

    expect(result.attempts[0]!.knowledgeUpdated).toBe(false);
    expect(countOf("getTopicReviewDecision")).toBe(0);
    expect(countOf("recordReviewEvent")).toBe(0);
  });

  it("usa modo simulado quando a atividade é simulado e vincula a sessão", async () => {
    mockTask = task({ activity: "simulado" });
    await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 60,
      contestId: "contest-1",
      questionAnswers: [{ questionId: "q1", chosenAnswer: "A", isCorrect: true }],
    });

    const submit = calls.find((c) => c.name === "submitAnswer")!.args[0] as SubmitInput;
    expect(submit.mode).toBe("simulado");
    expect(submit.sessionId).toBe("session-1");
    expect(submit.contestId).toBe("contest-1");
  });

  it("avisa quando a atividade de questões não trouxe respostas", async () => {
    mockTask = task({ activity: "questoes" });
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 15,
    });

    expect(result.warnings).toContain("atividade_de_questoes_sem_respostas");
    expect(countOf("submitAnswer")).toBe(0);
    expect(countOf("completeActivity")).toBe(1);
  });

  it("não faz N+1: leitura única da tarefa independentemente do número de respostas", async () => {
    mockTask = task({ activity: "questoes" });
    await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 50,
      questionAnswers: [
        { questionId: "q1", chosenAnswer: "A", isCorrect: true },
        { questionId: "q2", chosenAnswer: "A", isCorrect: true },
        { questionId: "q3", chosenAnswer: "A", isCorrect: true },
        { questionId: "q4", chosenAnswer: "A", isCorrect: true },
      ],
    });

    expect(calls.filter((c) => c.name === "from" && c.args[0] === "plan_tasks")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REVISÃO
// ─────────────────────────────────────────────────────────────────────────────

describe("executeActivityCompletion — revisão", () => {
  it("registra o evento de revisão usando os parâmetros do Review Engine", async () => {
    mockTask = task({ activity: "revisao" });
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 25,
      reviewOutcome: { result: "partial", notes: "faltou fluência" },
    });

    expect(result.kind).toBe("review");
    const payload = calls.find((c) => c.name === "recordReviewEvent")!.args[0] as {
      topicId: string;
      subjectId: string | null;
      result: string;
      reviewType: string;
      reviewIntensity: string;
      intervalDays: number;
      masteryAtReview: number;
      confidenceAtReview: number;
      sessionId: string;
      taskId: string;
    };
    expect(payload.topicId).toBe("topic-1");
    expect(payload.subjectId).toBe("subject-1");
    expect(payload.result).toBe("partial");
    expect(payload.reviewType).toBe("consolidacao");
    expect(payload.reviewIntensity).toBe("moderada");
    expect(payload.intervalDays).toBe(5);
    expect(payload.masteryAtReview).toBe(0.42);
    expect(payload.confidenceAtReview).toBe(0.55);
    expect(payload.sessionId).toBe("session-1");
    expect(payload.taskId).toBe("task-1");

    expect(result.review).toEqual({
      reviewEventId: "review-1",
      nextReviewAt: "2026-09-05",
      reviewCount: 3,
      reviewType: "consolidacao",
      reviewIntensity: "moderada",
    });
  });

  it("não registra revisão quando o resultado não foi declarado", async () => {
    mockTask = task({ activity: "revisao" });
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 25,
    });

    expect(result.review).toBeNull();
    expect(result.warnings).toContain("revisao_sem_resultado_declarado");
    expect(countOf("recordReviewEvent")).toBe(0);
    expect(countOf("completeActivity")).toBe(1);
  });

  it("não registra revisão quando a tarefa não tem tópico", async () => {
    mockTask = task({ activity: "revisao", topic_id: null });
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 25,
      reviewOutcome: { result: "success" },
    });

    expect(result.warnings).toContain("revisao_sem_topico");
    expect(countOf("getTopicReviewDecision")).toBe(0);
    expect(countOf("recordReviewEvent")).toBe(0);
  });

  it("não inventa dados quando não há estado de conhecimento", async () => {
    mockTask = task({ activity: "revisao" });
    mockDecision = null;
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 25,
      reviewOutcome: { result: "success" },
    });

    expect(result.review).toBeNull();
    expect(result.warnings).toContain("sem_estado_de_conhecimento_para_revisao");
    expect(countOf("recordReviewEvent")).toBe(0);
    expect(countOf("completeActivity")).toBe(1);
  });

  it("não envia respostas de questões no fluxo de revisão", async () => {
    mockTask = task({ activity: "revisao" });
    await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 25,
      reviewOutcome: { result: "success" },
      questionAnswers: [{ questionId: "q1", chosenAnswer: "A", isCorrect: true }],
    });
    expect(countOf("submitAnswer")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ESTUDO NOVO E FLASHCARDS
// ─────────────────────────────────────────────────────────────────────────────

describe("executeActivityCompletion — estudo novo e flashcards", () => {
  it("estudo novo apenas registra a conclusão", async () => {
    mockTask = task({ activity: "teoria" });
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 45,
      notes: "capítulo 3",
    });

    expect(result.kind).toBe("study");
    expect(result.attempts).toHaveLength(0);
    expect(result.review).toBeNull();
    expect(countOf("submitAnswer")).toBe(0);
    expect(countOf("recordReviewEvent")).toBe(0);
    const completion = calls.find((c) => c.name === "completeActivity")!.args[0] as Record<
      string,
      unknown
    >;
    expect(completion).toMatchObject({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 45,
      notes: "capítulo 3",
      questionsCount: 0,
    });
  });

  it("flashcards preserva o tipo e não implementa SRS", async () => {
    mockTask = task({ activity: "flashcards" });
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 15,
    });

    expect(result.kind).toBe("flashcards");
    expect(result.activity).toBe("flashcards");
    expect(result.warnings).toContain("flashcards_sem_srs_nesta_fase");
    expect(countOf("recordReviewEvent")).toBe(0);
    expect(countOf("submitAnswer")).toBe(0);
    expect(countOf("completeActivity")).toBe(1);
  });

  it("usa activity_type como fallback quando activity está ausente", async () => {
    mockTask = task({ activity: null, activity_type: "revisao" });
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 10,
      reviewOutcome: { result: "success" },
    });
    expect(result.kind).toBe("review");
    expect(countOf("recordReviewEvent")).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IDEMPOTÊNCIA
// ─────────────────────────────────────────────────────────────────────────────

describe("executeActivityCompletion — idempotência", () => {
  it("tarefa já concluída não dispara nenhum efeito pedagógico", async () => {
    mockTask = task({ activity: "questoes", status: "concluida" });
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 30,
      questionAnswers: [{ questionId: "q1", chosenAnswer: "A", isCorrect: false }],
    });

    expect(result.alreadyCompleted).toBe(true);
    expect(result.warnings).toContain("atividade_ja_concluida");
    expect(countOf("submitAnswer")).toBe(0);
    expect(countOf("recordReviewEvent")).toBe(0);
    expect(countOf("completeActivity")).toBe(0);
  });

  it("revisão já concluída não registra review_event duplicado", async () => {
    mockTask = task({ activity: "revisao", status: "concluida" });
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 30,
      reviewOutcome: { result: "success" },
    });

    expect(result.review).toBeNull();
    expect(countOf("getTopicReviewDecision")).toBe(0);
    expect(countOf("recordReviewEvent")).toBe(0);
  });

  it("propaga alreadyCompleted vindo do completeActivity", async () => {
    mockTask = task({ activity: "teoria" });
    mockAlreadyCompleted = true;
    const result = await executeActivityCompletion({
      sessionId: "session-1",
      taskId: "task-1",
      actualMinutes: 30,
    });
    expect(result.alreadyCompleted).toBe(true);
  });
});
