/**
 * TESTES UNITÁRIOS — createQuestion()
 *
 * Testa a função createQuestion do question bank service.
 * O Supabase é mockado para isolar a lógica de orquestração.
 *
 * Cenários cobertos:
 *   - Criação com dados válidos (campos completos e mínimos)
 *   - Usuário não autenticado
 *   - Erro retornado pelo Supabase
 *   - Envio correto dos campos para a tabela questions
 *   - Uso do user_id do usuário autenticado
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// MOCK DO SUPABASE
// ─────────────────────────────────────────────────────────────────────────────

const singleMock = vi.fn();
const selectMock = vi.fn(() => ({ single: singleMock }));
const insertMock = vi.fn(() => ({ select: selectMock }));
const fromMock = vi.fn(() => ({ insert: insertMock }));
const getUserMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: () => getUserMock() },
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import { createQuestion } from "./service";
import type { CreateQuestionInput } from "./service";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const FAKE_USER_ID = "user-abc-123";

function authenticatedUser() {
  getUserMock.mockResolvedValue({
    data: { user: { id: FAKE_USER_ID } },
    error: null,
  });
}

function unauthenticatedUser() {
  getUserMock.mockResolvedValue({
    data: { user: null },
    error: { message: "not authenticated" },
  });
}

function makeFullInput(): CreateQuestionInput {
  return {
    statement: "Qual é a capital do Brasil?",
    alternatives: ["Brasília", "São Paulo", "Rio de Janeiro", "Salvador"],
    correctAnswer: "Brasília",
    isTrueFalse: false,
    examBoard: "CESPE",
    contestName: "Concurso TRF5",
    contestId: "contest-1",
    year: 2025,
    subjectId: "sub-1",
    topicId: "top-1",
    difficulty: 3,
    origin: "prova_oficial",
    novelty: "conhecida",
    tags: ["constitucional", "geografia"],
    explanation: "A capital do Brasil é Brasília desde 1960.",
    isPublic: true,
  };
}

function makeInsertedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "q-new-1",
    statement: "Qual é a capital do Brasil?",
    alternatives: ["Brasília", "São Paulo", "Rio de Janeiro", "Salvador"],
    correct_answer: "Brasília",
    is_true_false: false,
    exam_board: "CESPE",
    contest_name: "Concurso TRF5",
    contest_id: "contest-1",
    year: 2025,
    subject_id: "sub-1",
    topic_id: "top-1",
    difficulty: 3,
    origin: "prova_oficial",
    novelty: "conhecida",
    tags: ["constitucional", "geografia"],
    explanation: "A capital do Brasil é Brasília desde 1960.",
    is_public: true,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTES
// ─────────────────────────────────────────────────────────────────────────────

describe("createQuestion", () => {
  // ─── Criação com dados válidos ────────────────────────────────────────────

  describe("criação com dados válidos", () => {
    it("cria questão com todos os campos preenchidos", async () => {
      authenticatedUser();
      const row = makeInsertedRow();
      singleMock.mockResolvedValue({ data: row, error: null });

      const result = await createQuestion(makeFullInput());

      expect(result.questionId).toBe("q-new-1");
      expect(result.statement).toBe("Qual é a capital do Brasil?");
      expect(result.alternatives).toEqual(["Brasília", "São Paulo", "Rio de Janeiro", "Salvador"]);
      expect(result.correctAnswer).toBe("Brasília");
      expect(result.isTrueFalse).toBe(false);
      expect(result.examBoard).toBe("CESPE");
      expect(result.contestName).toBe("Concurso TRF5");
      expect(result.contestId).toBe("contest-1");
      expect(result.year).toBe(2025);
      expect(result.subjectId).toBe("sub-1");
      expect(result.topicId).toBe("top-1");
      expect(result.difficulty).toBe(3);
      expect(result.origin).toBe("prova_oficial");
      expect(result.novelty).toBe("conhecida");
      expect(result.tags).toEqual(["constitucional", "geografia"]);
      expect(result.explanation).toBe("A capital do Brasil é Brasília desde 1960.");
      expect(result.isPublic).toBe(true);
      expect(result.stats).toBeNull();
    });

    it("cria questão com apenas o campo obrigatório (statement)", async () => {
      authenticatedUser();
      const row = makeInsertedRow({
        id: "q-min",
        statement: "Pergunta mínima",
        alternatives: [],
        correct_answer: null,
        is_true_false: false,
        exam_board: null,
        contest_name: null,
        contest_id: null,
        year: null,
        subject_id: null,
        topic_id: null,
        difficulty: null,
        origin: "manual",
        novelty: null,
        tags: [],
        explanation: null,
        is_public: false,
      });
      singleMock.mockResolvedValue({ data: row, error: null });

      const result = await createQuestion({ statement: "Pergunta mínima" });

      expect(result.questionId).toBe("q-min");
      expect(result.statement).toBe("Pergunta mínima");
      expect(result.alternatives).toEqual([]);
      expect(result.correctAnswer).toBeNull();
      expect(result.origin).toBe("manual");
      expect(result.isPublic).toBe(false);
      expect(result.stats).toBeNull();
    });
  });

  // ─── Usuário não autenticado ──────────────────────────────────────────────

  describe("usuário não autenticado", () => {
    it("lança erro quando não há usuário logado", async () => {
      unauthenticatedUser();

      await expect(createQuestion({ statement: "Qualquer pergunta" })).rejects.toThrow(
        "Usuário não autenticado.",
      );
    });

    it("não chama supabase.from quando não autenticado", async () => {
      unauthenticatedUser();

      await expect(createQuestion({ statement: "Qualquer pergunta" })).rejects.toThrow();

      expect(fromMock).not.toHaveBeenCalled();
    });
  });

  // ─── Erro retornado pelo Supabase ─────────────────────────────────────────

  describe("erro retornado pelo Supabase", () => {
    it("propaga erro do insert", async () => {
      authenticatedUser();
      const supabaseError = {
        message: "duplicate key value violates unique constraint",
        code: "23505",
      };
      singleMock.mockResolvedValue({ data: null, error: supabaseError });

      await expect(createQuestion(makeFullInput())).rejects.toEqual(supabaseError);
    });

    it("propaga erro genérico do Supabase", async () => {
      authenticatedUser();
      const supabaseError = {
        message: 'relation "questions" does not exist',
        code: "42P01",
      };
      singleMock.mockResolvedValue({ data: null, error: supabaseError });

      await expect(createQuestion({ statement: "Teste" })).rejects.toEqual(supabaseError);
    });
  });

  // ─── Envio correto dos campos ─────────────────────────────────────────────

  describe("envio correto dos campos para a tabela questions", () => {
    it("passa todos os campos no insert quando fornecidos", async () => {
      authenticatedUser();
      singleMock.mockResolvedValue({
        data: makeInsertedRow(),
        error: null,
      });

      await createQuestion(makeFullInput());

      expect(fromMock).toHaveBeenCalledWith("questions");
      expect(insertMock).toHaveBeenCalledTimes(1);

      const insertedPayload = insertMock.mock.calls[0]![0];
      expect(insertedPayload).toEqual({
        user_id: FAKE_USER_ID,
        statement: "Qual é a capital do Brasil?",
        alternatives: ["Brasília", "São Paulo", "Rio de Janeiro", "Salvador"],
        correct_answer: "Brasília",
        is_true_false: false,
        exam_board: "CESPE",
        contest_name: "Concurso TRF5",
        contest_id: "contest-1",
        year: 2025,
        subject_id: "sub-1",
        topic_id: "top-1",
        difficulty: 3,
        origin: "prova_oficial",
        novelty: "conhecida",
        tags: ["constitucional", "geografia"],
        explanation: "A capital do Brasil é Brasília desde 1960.",
        is_public: true,
      });
    });

    it("aplica defaults corretos quando campos opcionais são omitidos", async () => {
      authenticatedUser();
      singleMock.mockResolvedValue({
        data: makeInsertedRow({
          id: "q-defaults",
          statement: "Só o enunciado",
          alternatives: [],
          correct_answer: null,
          is_true_false: false,
          exam_board: null,
          contest_name: null,
          contest_id: null,
          year: null,
          subject_id: null,
          topic_id: null,
          difficulty: null,
          origin: "manual",
          novelty: null,
          tags: [],
          explanation: null,
          is_public: false,
        }),
        error: null,
      });

      await createQuestion({ statement: "Só o enunciado" });

      const insertedPayload = insertMock.mock.calls[0]![0];
      expect(insertedPayload).toEqual({
        user_id: FAKE_USER_ID,
        statement: "Só o enunciado",
        alternatives: [],
        correct_answer: null,
        is_true_false: false,
        exam_board: null,
        contest_name: null,
        contest_id: null,
        year: null,
        subject_id: null,
        topic_id: null,
        difficulty: null,
        origin: "manual",
        novelty: null,
        tags: [],
        explanation: null,
        is_public: false,
      });
    });

    it("chama select com os campos corretos e single()", async () => {
      authenticatedUser();
      singleMock.mockResolvedValue({
        data: makeInsertedRow(),
        error: null,
      });

      await createQuestion(makeFullInput());

      expect(selectMock).toHaveBeenCalledTimes(1);
      const selectArg = selectMock.mock.calls[0]![0] as string;
      // Verifica que seleciona os campos principais
      expect(selectArg).toContain("id");
      expect(selectArg).toContain("statement");
      expect(selectArg).toContain("alternatives");
      expect(selectArg).toContain("correct_answer");
      expect(selectArg).toContain("origin");
      expect(selectArg).toContain("tags");
      expect(singleMock).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Uso do user_id do usuário autenticado ────────────────────────────────

  describe("uso do user_id do usuário autenticado", () => {
    it("insere com o user_id retornado por getUser", async () => {
      authenticatedUser();
      singleMock.mockResolvedValue({
        data: makeInsertedRow(),
        error: null,
      });

      await createQuestion({ statement: "Teste user_id" });

      const insertedPayload = insertMock.mock.calls[0]![0];
      expect(insertedPayload.user_id).toBe(FAKE_USER_ID);
    });

    it("usa user_id diferente para usuários diferentes", async () => {
      const otherUserId = "user-xyz-999";
      getUserMock.mockResolvedValue({
        data: { user: { id: otherUserId } },
        error: null,
      });
      singleMock.mockResolvedValue({
        data: makeInsertedRow(),
        error: null,
      });

      await createQuestion({ statement: "Teste outro user" });

      const insertedPayload = insertMock.mock.calls[0]![0];
      expect(insertedPayload.user_id).toBe(otherUserId);
    });

    it("não aceita user_id arbitrário no input (campo não existe)", () => {
      // Verificação de design: CreateQuestionInput não tem campo userId.
      // O user_id vem exclusivamente de requireUser().
      const input = makeFullInput();
      expect("userId" in input).toBe(false);
      expect("user_id" in input).toBe(false);
    });
  });

  // ─── Retorno como QuestionBankItem ────────────────────────────────────────

  describe("retorno como QuestionBankItem", () => {
    it("retorna stats null para questão recém-criada", async () => {
      authenticatedUser();
      singleMock.mockResolvedValue({
        data: makeInsertedRow(),
        error: null,
      });

      const result = await createQuestion(makeFullInput());

      expect(result.stats).toBeNull();
    });

    it("trata alternatives não-array no retorno do banco", async () => {
      authenticatedUser();
      singleMock.mockResolvedValue({
        data: makeInsertedRow({ alternatives: "not-array" }),
        error: null,
      });

      const result = await createQuestion(makeFullInput());

      expect(result.alternatives).toEqual([]);
    });

    it("trata tags não-array no retorno do banco", async () => {
      authenticatedUser();
      singleMock.mockResolvedValue({
        data: makeInsertedRow({ tags: null }),
        error: null,
      });

      const result = await createQuestion(makeFullInput());

      expect(result.tags).toEqual([]);
    });
  });
});
