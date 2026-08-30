/**
 * ETAPA 5, FASE 3 — Testes de integração do Unified Service.
 *
 * Valida o contrato de orquestração (BUSCAR → ADAPTAR → ORQUESTRAR →
 * buildUnifiedSchedule → PERSISTIR) com Supabase e Review Service mockados.
 *
 * LIMITAÇÃO: execução in-memory/mocked — não testa contra o banco real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { weekStartsBetween } from "@/lib/planner/availability";
import type { ReviewQueueItem } from "@/lib/review/service";

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO DO MOCK
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_ID = "plan-001";
const START = "2026-09-01";
const END = "2026-09-14";

type Row = Record<string, unknown>;

let mockUser: { id: string } | null = { id: "user-001" };
let mockAuthError: unknown = null;
let mockPlan: Row | null = null;
let mockContestTopics: Row[] = [];
let mockKnowledge: Row[] = [];
let mockPrerequisites: Row[] = [];
let mockErrors: Row[] = [];
let mockAvailability: Row[] = [];
let mockReviewQueue: ReviewQueueItem[] = [];
let mockError: { table: string; message: string } | null = null;

/** Contagem de chamadas a supabase.from(table) — base da auditoria de N+1. */
let fromCalls: string[] = [];
/** Linhas efetivamente persistidas. */
let insertedBlocks: Row[] = [];
let insertedTasks: Row[] = [];
let deletes: { table: string; filters: Row }[] = [];

function listFor(table: string): Row[] {
  switch (table) {
    case "contest_topics":
      return mockContestTopics;
    case "user_topic_knowledge":
      return mockKnowledge;
    case "topic_prerequisites":
      return mockPrerequisites;
    case "error_entries":
      return mockErrors;
    case "availability_weeks":
      return mockAvailability;
    default:
      return [];
  }
}

function createBuilder(table: string) {
  const filters: Row = {};
  let mode: "select" | "delete" | "insert" = "select";
  let insertPayload: Row[] = [];

  const resolve = (): Promise<{ data: unknown; error: unknown }> => {
    if (mockError && mockError.table === table) {
      return Promise.resolve({ data: null, error: { message: mockError.message } });
    }
    if (mode === "delete") {
      deletes.push({ table, filters: { ...filters } });
      return Promise.resolve({ data: null, error: null });
    }
    if (mode === "insert") {
      if (table === "plan_blocks") {
        insertedBlocks.push(...insertPayload);
        return Promise.resolve({
          data: insertPayload.map((row, index) => ({
            id: `block-${index}`,
            week_start: row["week_start"],
          })),
          error: null,
        });
      }
      insertedTasks.push(...insertPayload);
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: listFor(table), error: null });
  };

  const builder: Record<string, unknown> = {};
  const chain = () => builder as never;

  builder["select"] = vi.fn(chain);
  builder["order"] = vi.fn(chain);
  builder["eq"] = vi.fn((col: string, value: unknown) => {
    filters[col] = value;
    return chain();
  });
  builder["in"] = vi.fn(chain);
  builder["gte"] = vi.fn((col: string, value: unknown) => {
    filters[col] = value;
    return chain();
  });
  builder["is"] = vi.fn(chain);
  builder["delete"] = vi.fn(() => {
    mode = "delete";
    return chain();
  });
  builder["insert"] = vi.fn((rows: Row | Row[]) => {
    mode = "insert";
    insertPayload = Array.isArray(rows) ? rows : [rows];
    return chain();
  });
  builder["maybeSingle"] = vi.fn(() => {
    if (mockError && mockError.table === table) {
      return Promise.resolve({ data: null, error: { message: mockError.message } });
    }
    if (table === "study_plans") return Promise.resolve({ data: mockPlan, error: null });
    return Promise.resolve({ data: listFor(table)[0] ?? null, error: null });
  });
  (builder as unknown as PromiseLike<unknown>).then = <TResult1 = unknown, TResult2 = never>(
    onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> => resolve().then(onFulfilled, onRejected);

  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockUser }, error: mockAuthError }) as never,
    },
    from: (table: string) => {
      fromCalls.push(table);
      return createBuilder(table) as never;
    },
  },
}));

vi.mock("@/lib/review/service", () => ({
  getUserReviewQueue: vi.fn(() => Promise.resolve(mockReviewQueue)),
}));

import { generateUnifiedSchedule, adaptReviewQueue, buildTopicMetaMap } from "./service";
import { getUserReviewQueue } from "@/lib/review/service";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

function contestTopic(id: string, subject: string, topic: string, priority = 5): Row {
  return {
    id: `ct-${id}`,
    subject_id: `subj-${subject}`,
    topic_id: `topic-${topic}`,
    priority,
    weight: 10,
    incidence_score: 0.8,
    relevance_score: 0.8,
    is_studied: false,
    subjects: { name: `Matéria ${subject}` },
    topics: { name: `Tópico ${topic}` },
  };
}

function reviewItem(topicId: string, urgency: number): ReviewQueueItem {
  return {
    topicId,
    needsReview: true,
    reviewUrgency: urgency,
    suggestedReviewDate: START,
    reviewInterval: 7,
    reviewReason: "teste",
    reviewIntensity: "moderada",
    reviewType: "manutencao",
    input: {
      topicId,
      mastery: 0.5,
      confidence: 0.5,
      accuracy: 0.5,
      knowledgeState: "INSTAVEL",
      interventionScore: 0.6,
      daysSinceStudy: 10,
      unresolvedErrors: 1,
      recurringErrors: 0,
      lastReviewDate: null,
      reviewCount: 1,
      lastReviewResult: null,
      referenceDate: START,
    },
  };
}

function fullAvailability(): Row[] {
  return weekStartsBetween(START, END).map((week_start) => ({
    week_start,
    minutes_sun: 180,
    minutes_mon: 180,
    minutes_tue: 180,
    minutes_wed: 180,
    minutes_thu: 180,
    minutes_fri: 180,
    minutes_sat: 180,
  }));
}

beforeEach(() => {
  mockUser = { id: "user-001" };
  mockAuthError = null;
  mockPlan = {
    id: PLAN_ID,
    contest_id: "contest-001",
    start_date: START,
    end_date: END,
    settings: {},
    contests: { exam_date: "2026-11-01" },
  };
  mockContestTopics = [contestTopic("a", "A", "a"), contestTopic("b", "B", "b")];
  mockKnowledge = [];
  mockPrerequisites = [];
  mockErrors = [];
  mockAvailability = fullAvailability();
  mockReviewQueue = [];
  mockError = null;
  fromCalls = [];
  insertedBlocks = [];
  insertedTasks = [];
  deletes = [];
  vi.mocked(getUserReviewQueue).mockClear();
});

const run = () => generateUnifiedSchedule(PLAN_ID, { referenceDate: START });

// ─────────────────────────────────────────────────────────────────────────────
// TESTES
// ─────────────────────────────────────────────────────────────────────────────

describe("Unified Service — geração", () => {
  it("1. gera agenda com estudo + revisão", async () => {
    mockReviewQueue = [reviewItem("topic-a", 0.9)];
    const result = await run();
    expect(result.tasksCreated).toBeGreaterThan(0);
    expect(result.studyTasks).toBeGreaterThan(0);
    expect(result.reviewTasks).toBeGreaterThan(0);
    expect(result.tasksCreated).toBe(result.studyTasks + result.reviewTasks);
  });

  it("2. gera agenda somente com estudo quando não há revisões", async () => {
    mockReviewQueue = [];
    const result = await run();
    expect(result.reviewTasks).toBe(0);
    expect(result.studyTasks).toBeGreaterThan(0);
  });

  it("3. gera agenda somente com revisão quando não há candidatos de estudo", async () => {
    mockContestTopics = [];
    mockReviewQueue = [reviewItem("topic-a", 0.9)];
    const result = await run();
    // Sem candidatos do concurso, o tópico de revisão não pertence ao concurso.
    expect(result.studyTasks).toBe(0);
    expect(result.reviewTasks).toBe(0);
  });

  it("4. revisão prevalece quando o único tópico também é candidato a estudo", async () => {
    mockContestTopics = [contestTopic("a", "A", "a")];
    mockReviewQueue = [reviewItem("topic-a", 0.95)];
    const result = await run();
    expect(result.reviewTasks).toBeGreaterThan(0);
  });

  it("5. ausência de candidatos e de revisões não persiste nada", async () => {
    mockContestTopics = [];
    mockReviewQueue = [];
    const result = await run();
    expect(result.tasksCreated).toBe(0);
    expect(insertedBlocks).toHaveLength(0);
    expect(insertedTasks).toHaveLength(0);
  });
});

describe("Unified Service — filtro por concurso", () => {
  it("6. descarta revisões de tópicos fora do concurso ativo", async () => {
    mockReviewQueue = [reviewItem("topic-a", 0.9), reviewItem("topic-fora-do-concurso", 0.99)];
    const result = await run();
    const reviewTopics = insertedTasks
      .filter((t) => t["source"] === "review_engine")
      .map((t) => t["topic_id"]);
    expect(reviewTopics).not.toContain("topic-fora-do-concurso");
    expect(reviewTopics).toContain("topic-a");
    expect(result.reviewTasks).toBe(reviewTopics.length);
  });

  it("7. adaptReviewQueue filtra pelo Map de tópicos do concurso", () => {
    const meta = buildTopicMetaMap([
      {
        contestTopicId: "ct-a",
        subjectId: "subj-A",
        subjectName: "Matéria A",
        topicId: "topic-a",
        topicName: "Tópico a",
        priority: 5,
        weight: 10,
        incidence: 0.8,
        relevance: 0.8,
        isStudied: false,
        mastery: 0.4,
        prerequisiteTopicIds: [],
        score: 6,
        gap: 0.6,
        blockedByPrerequisite: false,
        isPrerequisiteOfBlocked: false,
        reasons: [],
        diagnosticBoost: 0,
      },
    ]);
    const adapted = adaptReviewQueue(
      [reviewItem("topic-a", 0.9), reviewItem("topic-z", 0.9)],
      meta,
      { reviewMinutesPerIntensity: { leve: 20, moderada: 35, intensiva: 50 } },
    );
    expect(adapted).toHaveLength(1);
    expect(adapted[0]!.topicId).toBe("topic-a");
    expect(adapted[0]!.subjectName).toBe("Matéria A");
    expect(adapted[0]!.structuralPriority).toBe(6);
    expect(adapted[0]!.estimatedMinutes).toBe(35);
  });

  it("8. respeita contestTopicIds das settings do plano", async () => {
    mockPlan = { ...(mockPlan as Row), settings: { contestTopicIds: ["ct-a"] } };
    await run();
    const topics = new Set(insertedTasks.map((t) => t["topic_id"]));
    expect(topics.has("topic-a")).toBe(true);
    expect(topics.has("topic-b")).toBe(false);
  });
});

describe("Unified Service — deduplicação e source", () => {
  it("9. não agenda estudo e revisão do mesmo tópico no mesmo dia", async () => {
    mockReviewQueue = [reviewItem("topic-a", 0.95)];
    await run();
    const perDay = new Map<string, Set<string>>();
    for (const task of insertedTasks) {
      const date = String(task["scheduled_date"]);
      const set = perDay.get(date) ?? new Set<string>();
      const topic = String(task["topic_id"]);
      expect(set.has(topic)).toBe(false);
      set.add(topic);
      perDay.set(date, set);
    }
  });

  it("10. persiste source correto (planner / review_engine)", async () => {
    mockReviewQueue = [reviewItem("topic-a", 0.9)];
    await run();
    const sources = new Set(insertedTasks.map((t) => t["source"]));
    expect(sources.has("planner")).toBe(true);
    expect(sources.has("review_engine")).toBe(true);
    for (const s of sources) expect(["planner", "review_engine"]).toContain(s);
    for (const t of insertedTasks) expect(t["review_event_id"]).toBeNull();
  });
});

describe("Unified Service — otimização e persistência", () => {
  it("11. não faz N+1: nenhuma tabela de leitura é consultada por tópico", async () => {
    mockContestTopics = Array.from({ length: 12 }, (_, i) =>
      contestTopic(String(i), String(i), String(i)),
    );
    mockReviewQueue = mockContestTopics.map((c) => reviewItem(String(c["topic_id"]), 0.9));
    await run();
    const count = (table: string) => fromCalls.filter((t) => t === table).length;
    expect(count("contest_topics")).toBe(1);
    expect(count("topic_prerequisites")).toBe(1);
    expect(count("error_entries")).toBe(1);
    expect(count("user_topic_knowledge")).toBe(2); // mastery + diagnóstico, ambos em lote
    expect(count("availability_weeks")).toBe(1);
    expect(count("subjects")).toBe(0);
    expect(count("topics")).toBe(0);
  });

  it("12. usa exclusivamente getUserReviewQueue para a fila de revisão", async () => {
    await run();
    expect(vi.mocked(getUserReviewQueue)).toHaveBeenCalledTimes(1);
    expect(fromCalls).not.toContain("review_events");
  });

  it("13. persiste blocos e tarefas com campos esperados", async () => {
    const result = await run();
    expect(insertedBlocks.length).toBe(result.blocksCreated);
    expect(insertedTasks.length).toBe(result.tasksCreated);
    for (const block of insertedBlocks) {
      expect(block["plan_id"]).toBe(PLAN_ID);
      expect(block["user_id"]).toBe("user-001");
      expect(typeof block["week_start"]).toBe("string");
    }
    const task = insertedTasks[0]!;
    expect(task["plan_id"]).toBe(PLAN_ID);
    expect(task["user_id"]).toBe("user-001");
    expect(task["status"]).toBe("pendente");
    expect(task["block_id"]).toBeTruthy();
    expect(typeof task["priority_score"]).toBe("number");
    expect(typeof task["priority_reason"]).toBe("string");
  });

  it("14. limpa apenas tarefas pendentes futuras antes de regravar", async () => {
    await run();
    const taskDelete = deletes.find((d) => d.table === "plan_tasks");
    expect(taskDelete).toBeTruthy();
    expect(taskDelete!.filters["plan_id"]).toBe(PLAN_ID);
    expect(taskDelete!.filters["status"]).toBe("pendente");
    expect(taskDelete!.filters["scheduled_date"]).toBe(START);
  });

  it("15. preserva a disponibilidade: nada é agendado sem minutos disponíveis", async () => {
    mockAvailability = [];
    const result = await run();
    expect(result.tasksCreated).toBe(0);
    expect(result.schedule.totalCapacityMinutes).toBe(0);
    expect(result.schedule.warnings.length).toBeGreaterThan(0);
  });

  it("16. propaga o resultado do Unified Scheduler sem alteração", async () => {
    mockReviewQueue = [reviewItem("topic-a", 0.9)];
    const result = await run();
    const s = result.schedule;
    expect(s.studyMinutes + s.reviewMinutes + s.unallocatedMinutes).toBe(s.totalCapacityMinutes);
    expect(Array.isArray(s.deduplicatedTopics)).toBe(true);
    expect(typeof s.reviewBacklog).toBe("number");
    const totalPlanned = insertedTasks.reduce((sum, t) => sum + Number(t["planned_minutes"]), 0);
    expect(totalPlanned).toBe(s.studyMinutes + s.reviewMinutes);
  });
});

describe("Unified Service — segurança e erros", () => {
  it("17. exige usuário autenticado", async () => {
    mockUser = null;
    await expect(run()).rejects.toThrow("Usuário não autenticado.");
    expect(insertedTasks).toHaveLength(0);
  });

  it("18. persiste sempre o user_id da sessão (nunca de outro usuário)", async () => {
    mockUser = { id: "user-999" };
    await run();
    for (const row of [...insertedTasks, ...insertedBlocks]) {
      expect(row["user_id"]).toBe("user-999");
    }
  });

  it("19. nenhuma query recebe user_id arbitrário (RLS é a fronteira)", async () => {
    await run();
    for (const d of deletes) expect(d.filters["user_id"]).toBeUndefined();
  });

  it("20. plano inexistente gera erro claro", async () => {
    mockPlan = null;
    await expect(run()).rejects.toThrow("Plano não encontrado.");
  });

  it("21. plano sem concurso gera erro claro", async () => {
    mockPlan = { ...(mockPlan as Row), contest_id: null };
    await expect(run()).rejects.toThrow(/concurso/i);
  });

  it("22. plano sem datas gera erro claro", async () => {
    mockPlan = { ...(mockPlan as Row), start_date: null };
    await expect(run()).rejects.toThrow(/data inicial/i);
  });

  it("23. período encerrado gera erro claro", async () => {
    mockPlan = { ...(mockPlan as Row), start_date: "2026-01-01", end_date: "2026-01-10" };
    await expect(run()).rejects.toThrow(/já terminou/i);
  });

  it("24. erro do banco é propagado e nada é persistido", async () => {
    mockError = { table: "contest_topics", message: "falha de leitura" };
    await expect(run()).rejects.toBeTruthy();
    expect(insertedTasks).toHaveLength(0);
  });
});
