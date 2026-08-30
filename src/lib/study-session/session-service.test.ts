/**
 * TESTES DO SESSION SERVICE — Fase 3
 *
 * Testa a camada de execução/persistência de sessões de estudo.
 * Mocks completos do cliente Supabase (auth + from/select/eq/update/insert).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// MOCK DO SUPABASE
// ─────────────────────────────────────────────────────────────────────────────

let mockAuthUser: { id: string } | null = { id: "user-1" };
let mockAuthError: Error | null = null;

// Query chain state
type ChainResult = { data: any; error: any };
let mockChainResult: ChainResult = { data: null, error: null };
let mockInsertResult: ChainResult = { data: null, error: null };
let mockUpdateResult: ChainResult = { data: null, error: null };

// Track calls
const mockCalls: { method: string; args: any[] }[] = [];

function trackCall(method: string, ...args: any[]) {
  mockCalls.push({ method, args });
}

// Fluent chain builder
function createChain(resultGetter: () => ChainResult): any {
  const chain: any = {};
  const methods = ["select", "eq", "in", "order", "single"];
  for (const m of methods) {
    chain[m] = (...args: any[]) => {
      trackCall(m, ...args);
      return chain;
    };
  }
  chain.then = (resolve: (v: any) => void) => resolve(resultGetter());
  return chain;
}

function createInsertChain(): any {
  const chain: any = {};
  chain.select = (...args: any[]) => {
    trackCall("insert.select", ...args);
    return chain;
  };
  chain.single = (...args: any[]) => {
    trackCall("insert.single", ...args);
    return chain;
  };
  chain.then = (resolve: (v: any) => void) => resolve(mockInsertResult);
  return chain;
}

function createUpdateChain(): any {
  const chain: any = {};
  const methods = ["eq", "in", "select", "single"];
  for (const m of methods) {
    chain[m] = (...args: any[]) => {
      trackCall(`update.${m}`, ...args);
      return chain;
    };
  }
  chain.then = (resolve: (v: any) => void) => resolve(mockUpdateResult);
  return chain;
}

function defaultMockFrom(table: string) {
  trackCall("from", table);
  return {
    select: (...args: any[]) => {
      trackCall("select", ...args);
      return createChain(() => mockChainResult);
    },
    insert: (...args: any[]) => {
      trackCall("insert", ...args);
      return createInsertChain();
    },
    update: (...args: any[]) => {
      trackCall("update", ...args);
      return createUpdateChain();
    },
  };
}

const mockFrom = vi.fn().mockImplementation(defaultMockFrom);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: mockAuthUser },
          error: mockAuthError,
        }),
    },
    from: mockFrom,
  },
}));

// Mock buildStudySession from service.ts
let mockBuildResult: any = {
  activities: [],
  allocatedMinutes: 0,
  availableMinutes: 120,
  unallocatedMinutes: 120,
  discardedTasks: [],
  warnings: [],
};

vi.mock("./service", () => ({
  buildStudySession: (...args: any[]) => {
    trackCall("buildStudySession", ...args);
    return Promise.resolve(mockBuildResult);
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function makeActivity(id: string, position: number): any {
  return {
    taskId: `task-${id}`,
    topicId: `topic-${id}`,
    subjectId: `subject-${id}`,
    subjectName: `Matéria ${id}`,
    topicName: `Tópico ${id}`,
    activity: "teoria",
    source: "planner",
    allocatedMinutes: 50,
    plannedMinutes: 50,
    priorityScore: 7,
    priorityReason: "Estudo novo.",
    position,
    reviewUrgency: null,
    reviewType: null,
    reviewIntensity: null,
  };
}

function resetMocks() {
  mockAuthUser = { id: "user-1" };
  mockAuthError = null;
  mockChainResult = { data: null, error: null };
  mockInsertResult = { data: null, error: null };
  mockUpdateResult = { data: null, error: null };
  mockBuildResult = {
    activities: [],
    allocatedMinutes: 0,
    availableMinutes: 120,
    unallocatedMinutes: 120,
    discardedTasks: [],
    warnings: [],
  };
  mockCalls.length = 0;
  mockFrom.mockImplementation(defaultMockFrom);
  vi.clearAllMocks();
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTES: createStudySession
// ─────────────────────────────────────────────────────────────────────────────

describe("createStudySession", () => {
  beforeEach(resetMocks);

  async function importModule() {
    return import("./session-service");
  }

  it("1. rejeita quando usuário não autenticado", async () => {
    mockAuthUser = null;
    const { createStudySession } = await importModule();
    await expect(createStudySession({ planId: "plan-1" })).rejects.toThrow(
      "Usuário não autenticado",
    );
  });

  it("2. cria sessão vazia quando não há atividades", async () => {
    mockBuildResult = {
      activities: [],
      allocatedMinutes: 0,
      availableMinutes: 120,
      unallocatedMinutes: 120,
      discardedTasks: [],
      warnings: [],
    };
    mockInsertResult = { data: { id: "session-1" }, error: null };

    const { createStudySession } = await importModule();
    const { sessionId, result } = await createStudySession({ planId: "plan-1" });

    expect(sessionId).toBe("session-1");
    expect(result.activities).toHaveLength(0);
  });

  it("3. cria sessão e vincula tarefas quando há atividades", async () => {
    mockBuildResult = {
      activities: [makeActivity("a", 0), makeActivity("b", 1)],
      allocatedMinutes: 100,
      availableMinutes: 120,
      unallocatedMinutes: 20,
      discardedTasks: [],
      warnings: [],
    };
    mockInsertResult = { data: { id: "session-2" }, error: null };
    mockUpdateResult = { data: null, error: null };

    const { createStudySession } = await importModule();
    const { sessionId, result } = await createStudySession({ planId: "plan-1" });

    expect(sessionId).toBe("session-2");
    expect(result.activities).toHaveLength(2);
    // Deve ter chamado buildStudySession
    expect(mockCalls.some((c) => c.method === "buildStudySession")).toBe(true);
    // Deve ter chamado insert na study_sessions
    expect(mockCalls.some((c) => c.method === "insert")).toBe(true);
    // Deve ter chamado update para vincular tarefas
    expect(mockCalls.some((c) => c.method === "update")).toBe(true);
  });

  it("4. propaga erro do insert", async () => {
    mockBuildResult = {
      activities: [makeActivity("a", 0)],
      allocatedMinutes: 50,
      availableMinutes: 120,
      unallocatedMinutes: 70,
      discardedTasks: [],
      warnings: [],
    };
    mockInsertResult = { data: null, error: new Error("Insert failed") };

    const { createStudySession } = await importModule();
    await expect(createStudySession({ planId: "plan-1" })).rejects.toThrow("Insert failed");
  });

  it("5. propaga erro do update ao vincular tarefas", async () => {
    mockBuildResult = {
      activities: [makeActivity("a", 0)],
      allocatedMinutes: 50,
      availableMinutes: 120,
      unallocatedMinutes: 70,
      discardedTasks: [],
      warnings: [],
    };
    mockInsertResult = { data: { id: "session-3" }, error: null };
    mockUpdateResult = { data: null, error: new Error("Link failed") };

    const { createStudySession } = await importModule();
    await expect(createStudySession({ planId: "plan-1" })).rejects.toThrow("Link failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTES: resumeStudySession
// ─────────────────────────────────────────────────────────────────────────────

describe("resumeStudySession", () => {
  beforeEach(resetMocks);

  async function importModule() {
    return import("./session-service");
  }

  it("6. rejeita quando usuário não autenticado", async () => {
    mockAuthUser = null;
    const { resumeStudySession } = await importModule();
    await expect(resumeStudySession("session-1")).rejects.toThrow("Usuário não autenticado");
  });

  it("7. rejeita quando sessão já foi concluída", async () => {
    mockChainResult = {
      data: {
        id: "session-1",
        user_id: "user-1",
        session_date: "2026-09-01",
        started_at: "2026-09-01T10:00:00Z",
        ended_at: "2026-09-01T12:00:00Z",
        gross_seconds: 7200,
        net_seconds: 6000,
        questions_count: 10,
        correct_count: 8,
        wrong_count: 2,
        notes: null,
      },
      error: null,
    };

    const { resumeStudySession } = await importModule();
    await expect(resumeStudySession("session-1")).rejects.toThrow("Sessão já foi concluída");
  });

  it("8. retorna sessão com atividades quando em andamento", async () => {
    // Primeira chamada: session fetch
    // Segunda chamada: tasks fetch
    mockFrom.mockImplementation((table: string) => {
      trackCall("from", table);
      if (table === "study_sessions") {
        return {
          select: (...args: any[]) => {
            trackCall("select", ...args);
            return createChain(() => ({
              data: {
                id: "session-1",
                user_id: "user-1",
                session_date: "2026-09-01",
                started_at: "2026-09-01T10:00:00Z",
                ended_at: null,
                gross_seconds: 0,
                net_seconds: 0,
                questions_count: 0,
                correct_count: 0,
                wrong_count: 0,
                notes: null,
              },
              error: null,
            }));
          },
        };
      }
      // plan_tasks
      return {
        select: (...args: any[]) => {
          trackCall("select", ...args);
          return createChain(() => ({
            data: [
              {
                id: "task-1",
                topic_id: "topic-1",
                subject_id: "subject-1",
                activity: "teoria",
                activity_type: "teoria",
                planned_minutes: 50,
                actual_minutes: null,
                status: "pendente",
                position: 0,
                subjects: { name: "Direito" },
                topics: { name: "Constitucional" },
              },
            ],
            error: null,
          }));
        },
      };
    });

    const { resumeStudySession } = await importModule();
    const result = await resumeStudySession("session-1");

    expect(result.id).toBe("session-1");
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]!.taskId).toBe("task-1");
    expect(result.activities[0]!.subjectName).toBe("Direito");
    expect(result.activities[0]!.status).toBe("pendente");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTES: startSession
// ─────────────────────────────────────────────────────────────────────────────

describe("startSession", () => {
  beforeEach(resetMocks);

  async function importModule() {
    return import("./session-service");
  }

  it("9. rejeita quando usuário não autenticado", async () => {
    mockAuthUser = null;
    const { startSession } = await importModule();
    await expect(startSession("session-1")).rejects.toThrow("Usuário não autenticado");
  });

  it("10. rejeita quando sessão já foi concluída", async () => {
    mockChainResult = {
      data: { started_at: "2026-09-01T10:00:00Z", ended_at: "2026-09-01T12:00:00Z" },
      error: null,
    };

    const { startSession } = await importModule();
    await expect(startSession("session-1")).rejects.toThrow("Sessão já foi concluída");
  });

  it("11. é idempotente — não atualiza se já iniciada", async () => {
    mockChainResult = {
      data: { started_at: "2026-09-01T10:00:00Z", ended_at: null },
      error: null,
    };

    const { startSession } = await importModule();
    await startSession("session-1");
    // Não deve ter chamado update
    expect(mockCalls.filter((c) => c.method === "update").length).toBe(0);
  });

  it("12. marca started_at quando sessão ainda não foi iniciada", async () => {
    let updated = false;
    mockFrom.mockImplementation((table: string) => {
      trackCall("from", table);
      return {
        select: (...args: any[]) => {
          trackCall("select", ...args);
          return createChain(() => ({
            data: { started_at: null, ended_at: null },
            error: null,
          }));
        },
        update: (...args: any[]) => {
          updated = true;
          trackCall("update", ...args);
          return createUpdateChain();
        },
      };
    });
    mockUpdateResult = { data: null, error: null };

    const { startSession } = await importModule();
    await startSession("session-1");
    expect(updated).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTES: completeActivity
// ─────────────────────────────────────────────────────────────────────────────

describe("completeActivity", () => {
  beforeEach(resetMocks);

  async function importModule() {
    return import("./session-service");
  }

  it("13. rejeita quando usuário não autenticado", async () => {
    mockAuthUser = null;
    const { completeActivity } = await importModule();
    await expect(
      completeActivity({ sessionId: "s1", taskId: "t1", actualMinutes: 45 }),
    ).rejects.toThrow("Usuário não autenticado");
  });

  it("14. rejeita quando tarefa não pertence à sessão", async () => {
    mockChainResult = {
      data: { id: "t1", status: "pendente", session_id: "other-session" },
      error: null,
    };

    const { completeActivity } = await importModule();
    await expect(
      completeActivity({ sessionId: "s1", taskId: "t1", actualMinutes: 45 }),
    ).rejects.toThrow("Tarefa não pertence a esta sessão");
  });

  it("15. retorna alreadyCompleted=true quando tarefa já concluída", async () => {
    mockChainResult = {
      data: { id: "t1", status: "concluida", session_id: "s1" },
      error: null,
    };

    const { completeActivity } = await importModule();
    const result = await completeActivity({
      sessionId: "s1",
      taskId: "t1",
      actualMinutes: 45,
    });
    expect(result.alreadyCompleted).toBe(true);
  });

  it("16. conclui tarefa e retorna alreadyCompleted=false", async () => {
    let taskUpdated = false;
    let sessionUpdated = false;

    mockFrom.mockImplementation((table: string) => {
      trackCall("from", table);

      if (table === "plan_tasks") {
        return {
          select: (...args: any[]) => {
            trackCall("select", ...args);
            return createChain(() => ({
              data: { id: "t1", status: "pendente", session_id: "s1" },
              error: null,
            }));
          },
          update: (...args: any[]) => {
            taskUpdated = true;
            trackCall("update", ...args);
            const chain = createUpdateChain();
            chain.then = (resolve: any) => resolve({ data: null, error: null });
            return chain;
          },
        };
      }

      // study_sessions
      return {
        select: (...args: any[]) => {
          trackCall("select", ...args);
          return createChain(() => ({
            data: { questions_count: 5, correct_count: 3, wrong_count: 2 },
            error: null,
          }));
        },
        update: (...args: any[]) => {
          sessionUpdated = true;
          trackCall("update", ...args);
          const chain = createUpdateChain();
          chain.then = (resolve: any) => resolve({ data: null, error: null });
          return chain;
        },
      };
    });

    const { completeActivity } = await importModule();
    const result = await completeActivity({
      sessionId: "s1",
      taskId: "t1",
      actualMinutes: 45,
      questionsCount: 10,
      correctCount: 8,
      wrongCount: 2,
    });

    expect(result.alreadyCompleted).toBe(false);
    expect(taskUpdated).toBe(true);
    expect(sessionUpdated).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTES: completeSession
// ─────────────────────────────────────────────────────────────────────────────

describe("completeSession", () => {
  beforeEach(resetMocks);

  async function importModule() {
    return import("./session-service");
  }

  it("17. rejeita quando usuário não autenticado", async () => {
    mockAuthUser = null;
    const { completeSession } = await importModule();
    await expect(completeSession({ sessionId: "s1" })).rejects.toThrow("Usuário não autenticado");
  });

  it("18. propaga erro de sessão não encontrada", async () => {
    mockChainResult = { data: null, error: new Error("Not found") };

    const { completeSession } = await importModule();
    await expect(completeSession({ sessionId: "s1" })).rejects.toThrow("Not found");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTES: getSessionStatus
// ─────────────────────────────────────────────────────────────────────────────

describe("getSessionStatus", () => {
  beforeEach(resetMocks);

  async function importModule() {
    return import("./session-service");
  }

  it("19. rejeita quando usuário não autenticado", async () => {
    mockAuthUser = null;
    const { getSessionStatus } = await importModule();
    await expect(getSessionStatus("s1")).rejects.toThrow("Usuário não autenticado");
  });

  it("20. retorna status pending quando não iniciada", async () => {
    mockFrom.mockImplementation((table: string) => {
      trackCall("from", table);
      if (table === "study_sessions") {
        return {
          select: (...args: any[]) => {
            trackCall("select", ...args);
            return createChain(() => ({
              data: {
                id: "s1",
                started_at: null,
                ended_at: null,
                gross_seconds: 0,
                net_seconds: 0,
              },
              error: null,
            }));
          },
        };
      }
      return {
        select: (...args: any[]) => {
          trackCall("select", ...args);
          return createChain(() => ({
            data: [{ id: "t1", status: "pendente", actual_minutes: null, planned_minutes: 50 }],
            error: null,
          }));
        },
      };
    });

    const { getSessionStatus } = await importModule();
    const status = await getSessionStatus("s1");

    expect(status.status).toBe("pending");
    expect(status.totalActivities).toBe(1);
    expect(status.pendingActivities).toBe(1);
    expect(status.completedActivities).toBe(0);
    expect(status.totalAllocatedMinutes).toBe(50);
  });

  it("21. retorna status in_progress quando iniciada", async () => {
    mockFrom.mockImplementation((table: string) => {
      trackCall("from", table);
      if (table === "study_sessions") {
        return {
          select: (...args: any[]) => {
            trackCall("select", ...args);
            return createChain(() => ({
              data: {
                id: "s1",
                started_at: "2026-09-01T10:00:00Z",
                ended_at: null,
                gross_seconds: 0,
                net_seconds: 0,
              },
              error: null,
            }));
          },
        };
      }
      return {
        select: (...args: any[]) => {
          trackCall("select", ...args);
          return createChain(() => ({
            data: [
              { id: "t1", status: "concluida", actual_minutes: 45, planned_minutes: 50 },
              { id: "t2", status: "pendente", actual_minutes: null, planned_minutes: 50 },
            ],
            error: null,
          }));
        },
      };
    });

    const { getSessionStatus } = await importModule();
    const status = await getSessionStatus("s1");

    expect(status.status).toBe("in_progress");
    expect(status.totalActivities).toBe(2);
    expect(status.completedActivities).toBe(1);
    expect(status.pendingActivities).toBe(1);
    expect(status.totalActualMinutes).toBe(45);
    expect(status.totalAllocatedMinutes).toBe(100);
  });

  it("22. retorna status completed quando finalizada", async () => {
    mockFrom.mockImplementation((table: string) => {
      trackCall("from", table);
      if (table === "study_sessions") {
        return {
          select: (...args: any[]) => {
            trackCall("select", ...args);
            return createChain(() => ({
              data: {
                id: "s1",
                started_at: "2026-09-01T10:00:00Z",
                ended_at: "2026-09-01T12:00:00Z",
                gross_seconds: 7200,
                net_seconds: 5400,
              },
              error: null,
            }));
          },
        };
      }
      return {
        select: (...args: any[]) => {
          trackCall("select", ...args);
          return createChain(() => ({
            data: [
              { id: "t1", status: "concluida", actual_minutes: 45, planned_minutes: 50 },
              { id: "t2", status: "concluida", actual_minutes: 45, planned_minutes: 50 },
            ],
            error: null,
          }));
        },
      };
    });

    const { getSessionStatus } = await importModule();
    const status = await getSessionStatus("s1");

    expect(status.status).toBe("completed");
    expect(status.totalActivities).toBe(2);
    expect(status.completedActivities).toBe(2);
    expect(status.pendingActivities).toBe(0);
    expect(status.grossSeconds).toBe(7200);
    expect(status.netSeconds).toBe(5400);
    expect(status.totalActualMinutes).toBe(90);
  });

  it("23. propaga erro de sessão não encontrada", async () => {
    mockChainResult = { data: null, error: new Error("Not found") };

    const { getSessionStatus } = await importModule();
    await expect(getSessionStatus("s1")).rejects.toThrow("Not found");
  });

  it("24. conta atividades em_andamento corretamente", async () => {
    mockFrom.mockImplementation((table: string) => {
      trackCall("from", table);
      if (table === "study_sessions") {
        return {
          select: (...args: any[]) => {
            trackCall("select", ...args);
            return createChain(() => ({
              data: {
                id: "s1",
                started_at: "2026-09-01T10:00:00Z",
                ended_at: null,
                gross_seconds: 0,
                net_seconds: 0,
              },
              error: null,
            }));
          },
        };
      }
      return {
        select: (...args: any[]) => {
          trackCall("select", ...args);
          return createChain(() => ({
            data: [
              { id: "t1", status: "concluida", actual_minutes: 30, planned_minutes: 50 },
              { id: "t2", status: "em_andamento", actual_minutes: null, planned_minutes: 50 },
              { id: "t3", status: "pendente", actual_minutes: null, planned_minutes: 50 },
            ],
            error: null,
          }));
        },
      };
    });

    const { getSessionStatus } = await importModule();
    const status = await getSessionStatus("s1");

    expect(status.inProgressActivities).toBe(1);
    expect(status.completedActivities).toBe(1);
    expect(status.pendingActivities).toBe(1);
    expect(status.totalActualMinutes).toBe(30);
  });

  it("25. lida com tarefas sem planned_minutes ou actual_minutes", async () => {
    mockFrom.mockImplementation((table: string) => {
      trackCall("from", table);
      if (table === "study_sessions") {
        return {
          select: (...args: any[]) => {
            trackCall("select", ...args);
            return createChain(() => ({
              data: {
                id: "s1",
                started_at: null,
                ended_at: null,
                gross_seconds: 0,
                net_seconds: 0,
              },
              error: null,
            }));
          },
        };
      }
      return {
        select: (...args: any[]) => {
          trackCall("select", ...args);
          return createChain(() => ({
            data: [{ id: "t1", status: "concluida", actual_minutes: null, planned_minutes: null }],
            error: null,
          }));
        },
      };
    });

    const { getSessionStatus } = await importModule();
    const status = await getSessionStatus("s1");

    expect(status.totalAllocatedMinutes).toBe(0);
    expect(status.totalActualMinutes).toBe(0);
    expect(status.completedActivities).toBe(1);
  });
});
