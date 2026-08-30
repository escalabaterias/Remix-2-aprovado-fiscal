/**
 * TESTES DO STUDY SESSION SERVICE — Fase 2
 *
 * Testa a camada de serviço que conecta o engine ao Supabase.
 * Mocks completos do cliente Supabase (auth + from/select/eq/order).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import { adaptRowToSessionTask } from "./service";
import type { SessionTaskInput } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// MOCK DO SUPABASE
// ─────────────────────────────────────────────────────────────────────────────

type MockRow = {
  id: string;
  topic_id: string | null;
  subject_id: string | null;
  activity: string | null;
  activity_type: string | null;
  source: string;
  planned_minutes: number | null;
  priority_score: number | null;
  priority_reason: string | null;
  scheduled_date: string | null;
  review_event_id: string | null;
  subjects: { name: string } | null;
  topics: { name: string } | null;
};

let mockAuthUser: { id: string } | null = { id: "user-1" };
let mockAuthError: Error | null = null;
let mockQueryData: MockRow[] = [];
let mockQueryError: Error | null = null;

const mockOrder = vi.fn().mockImplementation(() => ({
  order: mockOrder,
  then: (resolve: (v: unknown) => void) =>
    resolve({ data: mockQueryData, error: mockQueryError }),
}));

const mockEq = vi.fn().mockImplementation(() => ({
  eq: mockEq,
  order: mockOrder,
  then: (resolve: (v: unknown) => void) =>
    resolve({ data: mockQueryData, error: mockQueryError }),
}));

const mockSelect = vi.fn().mockImplementation(() => ({
  eq: mockEq,
  order: mockOrder,
  then: (resolve: (v: unknown) => void) =>
    resolve({ data: mockQueryData, error: mockQueryError }),
}));

const mockFrom = vi.fn().mockImplementation(() => ({
  select: mockSelect,
}));

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

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "task-1",
    topic_id: "topic-1",
    subject_id: "subject-1",
    activity: "teoria",
    activity_type: "teoria",
    source: "planner",
    planned_minutes: 50,
    priority_score: 7,
    priority_reason: "Estudo novo.",
    scheduled_date: "2026-09-01",
    review_event_id: null,
    subjects: { name: "Direito Constitucional" },
    topics: { name: "Princípios Fundamentais" },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTES: adaptRowToSessionTask (função pura, exportada)
// ─────────────────────────────────────────────────────────────────────────────

describe("adaptRowToSessionTask", () => {
  it("1. converte row de estudo novo corretamente", () => {
    const row = makeRow();
    const result = adaptRowToSessionTask(row);
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe("task-1");
    expect(result!.topicId).toBe("topic-1");
    expect(result!.subjectId).toBe("subject-1");
    expect(result!.subjectName).toBe("Direito Constitucional");
    expect(result!.topicName).toBe("Princípios Fundamentais");
    expect(result!.activity).toBe("teoria");
    expect(result!.source).toBe("planner");
    expect(result!.plannedMinutes).toBe(50);
    expect(result!.priorityScore).toBe(7);
    expect(result!.priorityReason).toBe("Estudo novo.");
    expect(result!.reviewUrgency).toBeNull();
    expect(result!.reviewType).toBeNull();
    expect(result!.reviewIntensity).toBeNull();
  });

  it("2. converte row de revisão corretamente", () => {
    const row = makeRow({
      source: "review_engine",
      activity: "revisao",
      planned_minutes: 30,
      priority_score: 8,
    });
    const result = adaptRowToSessionTask(row);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("review_engine");
    expect(result!.reviewUrgency).toBe(0.8); // 8/10
    expect(result!.reviewType).toBe("consolidacao");
    expect(result!.reviewIntensity).toBe("moderada");
  });

  it("3. retorna null quando topic_id é null", () => {
    const row = makeRow({ topic_id: null });
    const result = adaptRowToSessionTask(row);
    expect(result).toBeNull();
  });

  it("4. fallback para 'teoria' quando activity é inválida", () => {
    const row = makeRow({ activity: "invalida", activity_type: null });
    const result = adaptRowToSessionTask(row);
    expect(result!.activity).toBe("teoria");
  });

  it("5. usa activity_type quando activity é null", () => {
    const row = makeRow({ activity: null, activity_type: "questoes" });
    const result = adaptRowToSessionTask(row);
    expect(result!.activity).toBe("questoes");
  });

  it("6. fallback em subject/topic names quando joins são null", () => {
    const row = makeRow({ subjects: null, topics: null });
    const result = adaptRowToSessionTask(row);
    expect(result!.subjectName).toBe("Matéria");
    expect(result!.topicName).toBe("Tópico");
  });

  it("7. planned_minutes null → 0", () => {
    const row = makeRow({ planned_minutes: null });
    const result = adaptRowToSessionTask(row);
    expect(result!.plannedMinutes).toBe(0);
  });

  it("8. priority_score null → 0", () => {
    const row = makeRow({ priority_score: null });
    const result = adaptRowToSessionTask(row);
    expect(result!.priorityScore).toBe(0);
  });

  it("9. source 'manual' preservada", () => {
    const row = makeRow({ source: "manual" });
    const result = adaptRowToSessionTask(row);
    expect(result!.source).toBe("manual");
  });

  it("10. source desconhecida → planner", () => {
    const row = makeRow({ source: "unknown_source" });
    const result = adaptRowToSessionTask(row);
    expect(result!.source).toBe("planner");
  });

  it("11. revisão com exercicios → tipo erro_direcionado", () => {
    const row = makeRow({ source: "review_engine", activity: "exercicios" });
    const result = adaptRowToSessionTask(row);
    expect(result!.reviewType).toBe("erro_direcionado");
  });

  it("12. revisão com flashcards → tipo manutencao", () => {
    const row = makeRow({ source: "review_engine", activity: "flashcards" });
    const result = adaptRowToSessionTask(row);
    expect(result!.reviewType).toBe("manutencao");
  });

  it("13. revisão com 10min → intensidade leve", () => {
    const row = makeRow({ source: "review_engine", planned_minutes: 10 });
    const result = adaptRowToSessionTask(row);
    expect(result!.reviewIntensity).toBe("leve");
  });

  it("14. revisão com 50min → intensidade intensiva", () => {
    const row = makeRow({ source: "review_engine", planned_minutes: 50 });
    const result = adaptRowToSessionTask(row);
    expect(result!.reviewIntensity).toBe("intensiva");
  });

  it("15. subject_id null → string vazia", () => {
    const row = makeRow({ subject_id: null });
    const result = adaptRowToSessionTask(row);
    expect(result!.subjectId).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTES: fetchSessionTasks e buildStudySession (integração com mock Supabase)
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchSessionTasks", () => {
  beforeEach(() => {
    mockAuthUser = { id: "user-1" };
    mockAuthError = null;
    mockQueryData = [];
    mockQueryError = null;
    vi.clearAllMocks();
  });

  // Importação dinâmica para que o mock já esteja ativo
  async function importService() {
    return import("./service");
  }

  it("16. rejeita quando usuário não autenticado", async () => {
    mockAuthUser = null;
    const { fetchSessionTasks } = await importService();
    await expect(fetchSessionTasks("plan-1")).rejects.toThrow("Usuário não autenticado");
  });

  it("17. retorna array vazio quando não há tarefas", async () => {
    mockQueryData = [];
    const { fetchSessionTasks } = await importService();
    const result = await fetchSessionTasks("plan-1");
    expect(result).toEqual([]);
  });

  it("18. adapta e retorna tarefas do banco", async () => {
    mockQueryData = [
      makeRow({ id: "t1", priority_score: 9 }),
      makeRow({ id: "t2", priority_score: 5, source: "review_engine", activity: "revisao" }),
    ];
    const { fetchSessionTasks } = await importService();
    const result = await fetchSessionTasks("plan-1");
    expect(result).toHaveLength(2);
    expect(result[0]!.taskId).toBe("t1");
    expect(result[1]!.taskId).toBe("t2");
    expect(result[1]!.source).toBe("review_engine");
  });

  it("19. propaga erro do Supabase", async () => {
    mockQueryError = new Error("DB error");
    const { fetchSessionTasks } = await importService();
    await expect(fetchSessionTasks("plan-1")).rejects.toThrow("DB error");
  });
});

describe("buildStudySession", () => {
  beforeEach(() => {
    mockAuthUser = { id: "user-1" };
    mockAuthError = null;
    mockQueryData = [];
    mockQueryError = null;
    vi.clearAllMocks();
  });

  async function importService() {
    return import("./service");
  }

  it("20. retorna SessionResult com atividades montadas", async () => {
    mockQueryData = [
      makeRow({ id: "t1", planned_minutes: 50, priority_score: 9 }),
      makeRow({ id: "t2", planned_minutes: 30, priority_score: 6 }),
    ];
    const { buildStudySession } = await importService();
    const result = await buildStudySession("plan-1", {
      sessionConfig: { availableMinutes: 120 },
    });
    expect(result.activities.length).toBeGreaterThan(0);
    expect(result.allocatedMinutes).toBeGreaterThan(0);
    expect(result.availableMinutes).toBe(120);
  });
});
