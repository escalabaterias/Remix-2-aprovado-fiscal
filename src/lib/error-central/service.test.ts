import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// MOCK DO SUPABASE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mock do cliente Supabase seguindo o padrão do projeto:
 * supabase.from(table).select(...).eq(...).order(...) etc.
 *
 * Cada chamada a .from() registra a tabela e retorna um builder chainable.
 * Os testes configuram os retornos via mockImplementation no builder.
 */

type MockResult = { data: unknown; error: unknown };

const pendingResults = new Map<string, MockResult[]>();
const callIndex = new Map<string, number>();

function resetMockResults() {
  pendingResults.clear();
  callIndex.clear();
}

function setMockResult(table: string, result: MockResult, index = 0) {
  if (!pendingResults.has(table)) pendingResults.set(table, []);
  const arr = pendingResults.get(table)!;
  arr[index] = result;
}

function getMockResult(table: string): MockResult {
  const idx = callIndex.get(table) ?? 0;
  callIndex.set(table, idx + 1);
  const arr = pendingResults.get(table) ?? [];
  return arr[idx] ?? { data: [], error: null };
}

function createChainableBuilder(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const chainMethods = [
    "select",
    "eq",
    "in",
    "gte",
    "lte",
    "order",
    "limit",
    "range",
    "overlaps",
    "update",
    "insert",
    "delete",
  ];

  for (const method of chainMethods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }

  // Terminal methods resolve to result
  builder.then = (resolve: (v: MockResult) => void) => {
    resolve(getMockResult(table));
  };

  // maybeSingle wraps result.data as single item or null
  builder.maybeSingle = vi.fn().mockImplementation(() => {
    const result = getMockResult(table);
    const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
    return Promise.resolve({ data, error: result.error });
  });

  builder.single = vi.fn().mockImplementation(() => {
    const result = getMockResult(table);
    const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
    return Promise.resolve({ data, error: result.error });
  });

  // Make the builder itself a thenable (for await)
  // Already handled by .then above, but also support direct await
  const originalThen = builder.then;
  Object.defineProperty(builder, "then", {
    value: (onResolve: (v: MockResult) => void, onReject?: (e: unknown) => void) => {
      try {
        const result = getMockResult(table);
        if (result.error && onReject) {
          onReject(result.error);
        } else if (onResolve) {
          onResolve(result);
        }
      } catch (e) {
        if (onReject) onReject(e);
      }
      return Promise.resolve();
    },
    writable: true,
    configurable: true,
  });

  return builder;
}

const mockAuth = {
  getUser: vi.fn().mockResolvedValue({
    data: { user: { id: "user-mock" } },
    error: null,
  }),
};

const mockSupabase = {
  auth: mockAuth,
  from: vi.fn().mockImplementation((table: string) => createChainableBuilder(table)),
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: mockSupabase,
}));

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS (depois do mock)
// ─────────────────────────────────────────────────────────────────────────────

import {
  fetchPrioritizedErrors,
  fetchTopicErrorSummaries,
  fetchErrorDetail,
  resolveErrorEntry,
} from "./service";

// ─────────────────────────────────────────────────────────────────────────────
// FACTORIES
// ─────────────────────────────────────────────────────────────────────────────

const REF_DATE = "2026-08-30T12:00:00Z";

function mkErrorRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "err-1",
    user_id: "user-mock",
    topic_id: "topic-1",
    subject_id: "sub-1",
    category: "conhecimento",
    is_resolved: false,
    resolved_at: null,
    occurred_at: "2026-08-28T10:00:00Z",
    attempt_id: "att-1",
    question_id: "q-1",
    ...overrides,
  };
}

function mkKnowledgeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    topic_id: "topic-1",
    mastery: 0.5,
    confidence: 0.6,
    total_questions: 10,
    correct_questions: 5,
    last_studied_at: "2026-08-25T10:00:00Z",
    ...overrides,
  };
}

function mkDetailRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...mkErrorRow(),
    diagnosis: "Falta de base conceitual",
    notes: "Revisar teoria",
    intervention: "Exercícios focados",
    topics: { name: "Direito Tributário", subject_id: "sub-1", subjects: { name: "Direito" } },
    subjects: { name: "Direito" },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetMockResults();
  vi.clearAllMocks();
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: "user-mock" } },
    error: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. fetchPrioritizedErrors
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchPrioritizedErrors", () => {
  it("retorna array vazio quando não há erros", async () => {
    setMockResult("error_entries", { data: [], error: null });
    setMockResult("user_topic_knowledge", { data: [], error: null });

    const result = await fetchPrioritizedErrors({}, REF_DATE);
    expect(result).toEqual([]);
  });

  it("retorna erros priorizados com score entre 0 e 1", async () => {
    const errors = [
      mkErrorRow({ id: "e1", occurred_at: "2026-08-29T10:00:00Z" }),
      mkErrorRow({ id: "e2", occurred_at: "2026-08-20T10:00:00Z", is_resolved: true }),
    ];
    setMockResult("error_entries", { data: errors, error: null });
    setMockResult("user_topic_knowledge", {
      data: [mkKnowledgeRow()],
      error: null,
    });

    const result = await fetchPrioritizedErrors({}, REF_DATE);
    expect(result).toHaveLength(2);
    for (const p of result) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(1);
    }
    // Primeiro deve ter score maior (mais recente + não resolvido)
    expect(result[0]!.score).toBeGreaterThanOrEqual(result[1]!.score);
  });

  it("propaga erro do Supabase", async () => {
    setMockResult("error_entries", {
      data: null,
      error: { message: "RLS violation" },
    });
    setMockResult("user_topic_knowledge", { data: [], error: null });

    await expect(fetchPrioritizedErrors({}, REF_DATE)).rejects.toEqual({
      message: "RLS violation",
    });
  });

  it("lança erro se usuário não autenticado", async () => {
    mockAuth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Not authenticated" },
    });

    await expect(fetchPrioritizedErrors()).rejects.toThrow("Usuário não autenticado.");
  });

  it("usa KnowledgeMap para amplificar mastery impact", async () => {
    const errors = [
      mkErrorRow({ id: "e-low", topic_id: "topic-low" }),
      mkErrorRow({ id: "e-high", topic_id: "topic-high" }),
    ];
    setMockResult("error_entries", { data: errors, error: null });
    setMockResult("user_topic_knowledge", {
      data: [
        mkKnowledgeRow({ topic_id: "topic-low", mastery: 0.1, confidence: 0.9 }),
        mkKnowledgeRow({ topic_id: "topic-high", mastery: 0.9, confidence: 0.9 }),
      ],
      error: null,
    });

    const result = await fetchPrioritizedErrors({}, REF_DATE);
    const lowTopic = result.find((r) => r.error.topicId === "topic-low")!;
    const highTopic = result.find((r) => r.error.topicId === "topic-high")!;
    expect(lowTopic.factors.masteryImpact).toBeGreaterThan(highTopic.factors.masteryImpact);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. fetchTopicErrorSummaries
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchTopicErrorSummaries", () => {
  it("retorna array vazio quando não há erros", async () => {
    setMockResult("error_entries", { data: [], error: null });
    setMockResult("user_topic_knowledge", { data: [], error: null });

    const result = await fetchTopicErrorSummaries({}, REF_DATE);
    expect(result).toEqual([]);
  });

  it("agrupa erros por tópico e retorna nomes", async () => {
    const errors = [
      mkErrorRow({ id: "s1", topic_id: "topic-A" }),
      mkErrorRow({ id: "s2", topic_id: "topic-A" }),
      mkErrorRow({ id: "s3", topic_id: "topic-B" }),
    ];
    setMockResult("error_entries", { data: errors, error: null });
    setMockResult("user_topic_knowledge", { data: [], error: null });
    setMockResult("topics", {
      data: [
        { id: "topic-A", name: "Impostos", subject_id: "sub-1", subjects: { name: "Tributário" } },
        {
          id: "topic-B",
          name: "Obrigações",
          subject_id: "sub-1",
          subjects: { name: "Tributário" },
        },
      ],
      error: null,
    });

    const result = await fetchTopicErrorSummaries({}, REF_DATE);
    expect(result).toHaveLength(2);

    const topicA = result.find((s) => s.topicId === "topic-A");
    expect(topicA).toBeDefined();
    expect(topicA!.errorCount).toBe(2);
    expect(topicA!.topicName).toBe("Impostos");
    expect(topicA!.subjectName).toBe("Tributário");
  });

  it("propaga erro do Supabase na query de tópicos", async () => {
    const errors = [mkErrorRow({ id: "s1", topic_id: "topic-A" })];
    setMockResult("error_entries", { data: errors, error: null });
    setMockResult("user_topic_knowledge", { data: [], error: null });
    setMockResult("topics", { data: null, error: { message: "Table not found" } });

    await expect(fetchTopicErrorSummaries({}, REF_DATE)).rejects.toEqual({
      message: "Table not found",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. fetchErrorDetail
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchErrorDetail", () => {
  it("retorna null se erro não encontrado", async () => {
    setMockResult("error_entries", { data: [], error: null }, 0);

    const result = await fetchErrorDetail("not-found", REF_DATE);
    expect(result).toBeNull();
  });

  it("retorna detalhe com score e nomes", async () => {
    // First call: detail query (maybeSingle)
    setMockResult(
      "error_entries",
      {
        data: [mkDetailRow()],
        error: null,
      },
      0,
    );
    // Second call: all errors of the topic
    setMockResult(
      "error_entries",
      {
        data: [mkErrorRow()],
        error: null,
      },
      1,
    );
    setMockResult("user_topic_knowledge", {
      data: [mkKnowledgeRow()],
      error: null,
    });

    const result = await fetchErrorDetail("err-1", REF_DATE);
    expect(result).not.toBeNull();
    expect(result!.error.id).toBe("err-1");
    expect(result!.topicName).toBe("Direito Tributário");
    expect(result!.subjectName).toBe("Direito");
    expect(result!.diagnosis).toBe("Falta de base conceitual");
    expect(result!.prioritized.score).toBeGreaterThanOrEqual(0);
    expect(result!.prioritized.score).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. resolveErrorEntry
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveErrorEntry", () => {
  it("chama update no Supabase", async () => {
    setMockResult("error_entries", { data: null, error: null });

    await resolveErrorEntry("err-to-resolve");

    // Verifica que supabase.from foi chamado com 'error_entries'
    expect(mockSupabase.from).toHaveBeenCalledWith("error_entries");
  });

  it("propaga erro do Supabase", async () => {
    setMockResult("error_entries", {
      data: null,
      error: { message: "Update failed" },
    });

    await expect(resolveErrorEntry("err-fail")).rejects.toEqual({
      message: "Update failed",
    });
  });

  it("lança erro se usuário não autenticado", async () => {
    mockAuth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Not authenticated" },
    });

    await expect(resolveErrorEntry("err-x")).rejects.toThrow("Usuário não autenticado.");
  });
});
