/**
 * QUESTION BANK SERVICE — Etapa 6, Fase 2
 *
 * Camada de orquestração entre o Supabase e o engine puro do banco de questões.
 *
 * RESPONSABILIDADES:
 *   - Buscar questões do banco com filtros eficientes (WHERE no Supabase)
 *   - Buscar stats em lote (sem N+1) e combinar em memória
 *   - Delegar filtragem fina e ranking ao engine (filterQuestions, rankQuestionsForStudy)
 *   - Criar e consultar question sets
 *   - Atualizar itens de question sets
 *
 * NÃO FAZ:
 *   - Duplicar regras de filtragem/ranking (fica no engine)
 *   - Alterar Knowledge/Diagnosis/Review/Planner/Scheduler
 *   - Aceitar userId arbitrário (RLS + requireUser)
 *   - Integração completa de respostas com Knowledge/Errors/Review (fase futura)
 *
 * SEGURANÇA:
 *   Todas as leituras/escritas usam o cliente Supabase do usuário logado.
 *   RLS por user_id é a fronteira de segurança.
 *
 * PERFORMANCE:
 *   - Stats buscadas em lote por question_id[] (sem N+1)
 *   - Filtros aplicados no banco quando possível (WHERE)
 *   - Filtragem fina delegada ao engine em memória
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { filterQuestions, rankQuestionsForStudy, computeBankSummary } from "./engine";
import { computeQuestionContentHash, normalizeExamBoard } from "./normalizer";
import type {
  QuestionBankItem,
  QuestionStats,
  QuestionFilter,
  QuestionBankSummary,
  QuestionSet,
  QuestionSetItem,
  QuestionSetType,
  QuestionOrigin,
  QuestionNovelty,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS INTERNOS (rows do banco)
// ─────────────────────────────────────────────────────────────────────────────

type QuestionRow = {
  id: string;
  statement: string;
  alternatives: unknown;
  correct_answer: string | null;
  is_true_false: boolean;
  exam_board: string | null;
  contest_name: string | null;
  contest_id: string | null;
  year: number | null;
  subject_id: string | null;
  topic_id: string | null;
  difficulty: number | null;
  origin: string;
  novelty: string | null;
  tags: string[];
  explanation: string | null;
  is_public: boolean;
};

type StatsRow = {
  question_id: string;
  total_attempts: number;
  correct_count: number;
  wrong_count: number;
  streak_correct: number;
  streak_wrong: number;
  best_time_seconds: number | null;
  avg_time_seconds: number | null;
  last_attempted_at: string | null;
  last_correct_at: string | null;
  last_wrong_at: string | null;
};

type QuestionSetRow = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  contest_id: string | null;
  subject_id: string | null;
  topic_id: string | null;
  time_limit_minutes: number | null;
  is_timed: boolean;
  is_completed: boolean;
  completed_at: string | null;
  total_questions: number;
  correct_count: number;
  wrong_count: number;
  score: number | null;
  tags: string[];
};

type QuestionSetItemRow = {
  id: string;
  set_id: string;
  question_id: string;
  position: number;
  is_answered: boolean;
  is_correct: boolean | null;
  chosen_answer: string | null;
  time_spent_seconds: number | null;
  attempt_id: string | null;
  notes: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSORES
// ─────────────────────────────────────────────────────────────────────────────

function safeNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function toQuestionStats(row: StatsRow): QuestionStats {
  const total = safeNum(row.total_attempts, 0);
  const correct = safeNum(row.correct_count, 0);
  return {
    totalAttempts: total,
    correctCount: correct,
    wrongCount: safeNum(row.wrong_count, 0),
    streakCorrect: safeNum(row.streak_correct, 0),
    streakWrong: safeNum(row.streak_wrong, 0),
    bestTimeSeconds: row.best_time_seconds !== null ? safeNum(row.best_time_seconds, 0) : null,
    avgTimeSeconds: row.avg_time_seconds !== null ? safeNum(row.avg_time_seconds, 0) : null,
    lastAttemptedAt: row.last_attempted_at ?? null,
    lastCorrectAt: row.last_correct_at ?? null,
    lastWrongAt: row.last_wrong_at ?? null,
    accuracy: total > 0 ? Math.max(0, Math.min(1, correct / total)) : 0,
  };
}

export function toQuestionBankItem(
  row: QuestionRow,
  stats: QuestionStats | null,
): QuestionBankItem {
  const alternatives = Array.isArray(row.alternatives) ? row.alternatives : [];
  return {
    questionId: row.id,
    statement: row.statement,
    alternatives,
    correctAnswer: row.correct_answer,
    isTrueFalse: row.is_true_false,
    examBoard: row.exam_board,
    contestName: row.contest_name,
    contestId: row.contest_id,
    year: row.year,
    subjectId: row.subject_id,
    topicId: row.topic_id,
    difficulty: row.difficulty,
    origin: row.origin as QuestionBankItem["origin"],
    novelty: row.novelty as QuestionBankItem["novelty"],
    tags: Array.isArray(row.tags) ? row.tags : [],
    explanation: row.explanation,
    isPublic: row.is_public,
    stats,
  };
}

export function toQuestionSet(row: QuestionSetRow): QuestionSet {
  return {
    setId: row.id,
    name: row.name,
    description: row.description,
    type: row.type as QuestionSetType,
    contestId: row.contest_id,
    subjectId: row.subject_id,
    topicId: row.topic_id,
    timeLimitMinutes: row.time_limit_minutes,
    isTimed: row.is_timed,
    isCompleted: row.is_completed,
    completedAt: row.completed_at,
    totalQuestions: safeNum(row.total_questions, 0),
    correctCount: safeNum(row.correct_count, 0),
    wrongCount: safeNum(row.wrong_count, 0),
    score: row.score !== null ? safeNum(row.score, 0) : null,
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
}

export function toQuestionSetItem(row: QuestionSetItemRow): QuestionSetItem {
  return {
    itemId: row.id,
    setId: row.set_id,
    questionId: row.question_id,
    position: safeNum(row.position, 0),
    isAnswered: row.is_answered,
    isCorrect: row.is_correct,
    chosenAnswer: row.chosen_answer,
    timeSpentSeconds: row.time_spent_seconds !== null ? safeNum(row.time_spent_seconds, 0) : null,
    attemptId: row.attempt_id,
    notes: row.notes,
  };
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

/**
 * Obtém o userId a partir de um cliente Supabase autenticado (server-side).
 * O cliente já carrega o token JWT do usuário, então getUser() funciona.
 */
async function requireUserFromClient(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new Error("Usuário não autenticado.");
  }
  return data.user.id;
}

const QUESTION_SELECT =
  "id, statement, alternatives, correct_answer, is_true_false, exam_board, contest_name, contest_id, year, subject_id, topic_id, difficulty, origin, novelty, tags, explanation, is_public";

const STATS_SELECT =
  "question_id, total_attempts, correct_count, wrong_count, streak_correct, streak_wrong, best_time_seconds, avg_time_seconds, last_attempted_at, last_correct_at, last_wrong_at";

const QUESTION_SET_SELECT =
  "id, name, description, type, contest_id, subject_id, topic_id, time_limit_minutes, is_timed, is_completed, completed_at, total_questions, correct_count, wrong_count, score, tags";

const QUESTION_SET_ITEM_SELECT =
  "id, set_id, question_id, position, is_answered, is_correct, chosen_answer, time_spent_seconds, attempt_id, notes";

/**
 * Aplica filtros do QuestionFilter como WHERE clauses no Supabase query builder.
 * Filtros que não mapeiam diretamente para colunas (neverAttempted, lastAttemptWrong,
 * searchText com lógica complexa) são deixados para o engine em memória.
 */
export function buildSupabaseFilters(
  query: ReturnType<ReturnType<typeof supabase.from>["select"]>,
  filter: QuestionFilter,
): ReturnType<ReturnType<typeof supabase.from>["select"]> {
  let q = query;

  if (filter.subjectId != null) {
    q = q.eq("subject_id", filter.subjectId);
  }
  if (filter.topicId != null) {
    q = q.eq("topic_id", filter.topicId);
  }
  if (filter.contestId != null) {
    q = q.eq("contest_id", filter.contestId);
  }
  if (filter.examBoard != null) {
    q = q.eq("exam_board", filter.examBoard);
  }
  if (filter.yearMin != null) {
    q = q.gte("year", filter.yearMin);
  }
  if (filter.yearMax != null) {
    q = q.lte("year", filter.yearMax);
  }
  if (filter.difficultyMin != null) {
    q = q.gte("difficulty", filter.difficultyMin);
  }
  if (filter.difficultyMax != null) {
    q = q.lte("difficulty", filter.difficultyMax);
  }
  if (filter.origin != null) {
    q = q.eq("origin", filter.origin);
  }
  if (filter.isTrueFalse != null) {
    q = q.eq("is_true_false", filter.isTrueFalse);
  }
  if (filter.tags != null && filter.tags.length > 0) {
    q = q.overlaps("tags", filter.tags);
  }

  return q;
}

/**
 * Busca stats em lote para um conjunto de question_ids.
 * Retorna Map<questionId, QuestionStats> — sem N+1.
 */
async function fetchStatsInBatch(questionIds: string[]): Promise<Map<string, QuestionStats>> {
  const map = new Map<string, QuestionStats>();
  if (questionIds.length === 0) return map;

  // Supabase IN aceita arrays; para listas muito grandes, batch por 500
  for (let i = 0; i < questionIds.length; i += 500) {
    const batch = questionIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from("question_stats")
      .select(STATS_SELECT)
      .in("question_id", batch);

    if (error) throw error;
    for (const row of (data ?? []) as StatsRow[]) {
      map.set(row.question_id, toQuestionStats(row));
    }
  }

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. fetchQuestions
// ─────────────────────────────────────────────────────────────────────────────

export type FetchQuestionsOptions = {
  filter?: QuestionFilter;
  limit?: number;
  offset?: number;
};

/**
 * Busca questões do banco com filtros.
 *
 * Estratégia:
 *   1. Aplica filtros mapeáveis no Supabase (WHERE) para reduzir payload.
 *   2. Busca stats em lote (1 query, sem N+1).
 *   3. Monta QuestionBankItem[] em memória.
 *   4. Aplica filtros finos via engine (neverAttempted, lastAttemptWrong, searchText, novelty).
 *
 * Queries: 2 (questions + question_stats).
 */
export async function fetchQuestions(
  options: FetchQuestionsOptions = {},
): Promise<QuestionBankItem[]> {
  await requireUser();

  const { filter = {}, limit, offset } = options;

  // 1. Query base com filtros aplicáveis no banco
  let query = supabase.from("questions").select(QUESTION_SELECT);
  query = buildSupabaseFilters(query, filter) as typeof query;

  if (offset != null && offset > 0) {
    query = query.range(offset, offset + (limit ?? 1000) - 1);
  } else if (limit != null) {
    query = query.limit(limit);
  }

  const { data: questionRows, error: qError } = await query;
  if (qError) throw qError;
  if (!questionRows || questionRows.length === 0) return [];

  const rows = questionRows as QuestionRow[];

  // 2. Buscar stats em lote
  const questionIds = rows.map((r) => r.id);
  const statsMap = await fetchStatsInBatch(questionIds);

  // 3. Montar QuestionBankItem[]
  const items = rows.map((row) => toQuestionBankItem(row, statsMap.get(row.id) ?? null));

  // 4. Filtragem fina via engine (filtros que não foram para o Supabase)
  const needsEngineFineFilter =
    filter.neverAttempted != null ||
    filter.lastAttemptWrong != null ||
    filter.novelty != null ||
    (filter.searchText != null && filter.searchText.trim() !== "");

  if (needsEngineFineFilter) {
    return filterQuestions(items, filter);
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. fetchRankedQuestions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca questões filtradas e ordena por prioridade de estudo.
 *
 * Queries: 2 (via fetchQuestions).
 */
export async function fetchRankedQuestions(
  options: FetchQuestionsOptions & { referenceDate?: string } = {},
): Promise<QuestionBankItem[]> {
  const { referenceDate, ...fetchOpts } = options;
  const items = await fetchQuestions(fetchOpts);
  const refDate = referenceDate ?? new Date().toISOString().slice(0, 10);
  return rankQuestionsForStudy(items, refDate);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. fetchQuestionStats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca estatísticas de uma questão específica para o usuário autenticado.
 *
 * Queries: 1.
 */
export async function fetchQuestionStats(questionId: string): Promise<QuestionStats | null> {
  await requireUser();

  const { data, error } = await supabase
    .from("question_stats")
    .select(STATS_SELECT)
    .eq("question_id", questionId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return toQuestionStats(data as StatsRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. fetchBankSummary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gera resumo completo do banco de questões do usuário.
 * Busca todas as questões + stats e delega ao engine.
 *
 * Queries: 2 (questions + question_stats).
 */
export async function fetchBankSummary(): Promise<QuestionBankSummary> {
  const items = await fetchQuestions();
  return computeBankSummary(items);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. createQuestionSet
// ─────────────────────────────────────────────────────────────────────────────

export type CreateQuestionSetInput = {
  name: string;
  description?: string | null;
  type: QuestionSetType;
  contestId?: string | null;
  subjectId?: string | null;
  topicId?: string | null;
  timeLimitMinutes?: number | null;
  isTimed?: boolean;
  tags?: string[];
  /** IDs das questões a incluir (na ordem desejada) */
  questionIds: string[];
};

/**
 * Cria um question_set com seus itens em lote.
 *
 * Queries: 2 (INSERT question_sets + INSERT question_set_items).
 */
export async function createQuestionSet(
  input: CreateQuestionSetInput,
): Promise<{ set: QuestionSet; items: QuestionSetItem[] }> {
  const userId = await requireUser();

  // 1. Inserir o set
  const { data: setData, error: setError } = await supabase
    .from("question_sets")
    .insert({
      user_id: userId,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      contest_id: input.contestId ?? null,
      subject_id: input.subjectId ?? null,
      topic_id: input.topicId ?? null,
      time_limit_minutes: input.timeLimitMinutes ?? null,
      is_timed: input.isTimed ?? false,
      tags: input.tags ?? [],
      total_questions: input.questionIds.length,
    })
    .select(QUESTION_SET_SELECT)
    .single();

  if (setError) throw setError;

  const set = toQuestionSet(setData as QuestionSetRow);

  // 2. Inserir itens em lote
  if (input.questionIds.length === 0) {
    return { set, items: [] };
  }

  const itemRows = input.questionIds.map((qId, index) => ({
    user_id: userId,
    set_id: set.setId,
    question_id: qId,
    position: index,
  }));

  const { data: itemData, error: itemError } = await supabase
    .from("question_set_items")
    .insert(itemRows)
    .select(QUESTION_SET_ITEM_SELECT);

  if (itemError) throw itemError;

  const items = ((itemData ?? []) as QuestionSetItemRow[]).map(toQuestionSetItem);

  return { set, items };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. getQuestionSet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca um question_set com seus itens.
 *
 * Queries: 2 (question_sets + question_set_items), em paralelo.
 */
export async function getQuestionSet(
  setId: string,
): Promise<{ set: QuestionSet; items: QuestionSetItem[] } | null> {
  await requireUser();

  const [setResult, itemsResult] = await Promise.all([
    supabase.from("question_sets").select(QUESTION_SET_SELECT).eq("id", setId).maybeSingle(),
    supabase
      .from("question_set_items")
      .select(QUESTION_SET_ITEM_SELECT)
      .eq("set_id", setId)
      .order("position", { ascending: true }),
  ]);

  if (setResult.error) throw setResult.error;
  if (itemsResult.error) throw itemsResult.error;

  if (!setResult.data) return null;

  const set = toQuestionSet(setResult.data as QuestionSetRow);
  const items = ((itemsResult.data ?? []) as QuestionSetItemRow[]).map(toQuestionSetItem);

  return { set, items };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. getUserQuestionSets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista todos os question_sets do usuário autenticado.
 * Filtro opcional por tipo.
 *
 * Queries: 1.
 */
export async function getUserQuestionSets(type?: QuestionSetType): Promise<QuestionSet[]> {
  await requireUser();

  let query = supabase
    .from("question_sets")
    .select(QUESTION_SET_SELECT)
    .order("created_at", { ascending: false });

  if (type != null) {
    query = query.eq("type", type);
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as QuestionSetRow[]).map(toQuestionSet);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. updateQuestionSetItem
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateQuestionSetItemInput = {
  itemId: string;
  isAnswered?: boolean;
  isCorrect?: boolean | null;
  chosenAnswer?: string | null;
  timeSpentSeconds?: number | null;
  attemptId?: string | null;
  notes?: string | null;
};

/**
 * Atualiza um item dentro de um question_set.
 *
 * Queries: 1.
 */
export async function updateQuestionSetItem(
  input: UpdateQuestionSetItemInput,
): Promise<QuestionSetItem> {
  await requireUser();

  const updateFields: {
    is_answered?: boolean;
    is_correct?: boolean | null;
    chosen_answer?: string | null;
    time_spent_seconds?: number | null;
    attempt_id?: string | null;
    notes?: string | null;
  } = {};
  if (input.isAnswered !== undefined) updateFields.is_answered = input.isAnswered;
  if (input.isCorrect !== undefined) updateFields.is_correct = input.isCorrect;
  if (input.chosenAnswer !== undefined) updateFields.chosen_answer = input.chosenAnswer;
  if (input.timeSpentSeconds !== undefined)
    updateFields.time_spent_seconds = input.timeSpentSeconds;
  if (input.attemptId !== undefined) updateFields.attempt_id = input.attemptId;
  if (input.notes !== undefined) updateFields.notes = input.notes;

  const { data, error } = await supabase
    .from("question_set_items")
    .update(updateFields)
    .eq("id", input.itemId)
    .select(QUESTION_SET_ITEM_SELECT)
    .single();

  if (error) throw error;

  return toQuestionSetItem(data as QuestionSetItemRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. createQuestion
// ─────────────────────────────────────────────────────────────────────────────

export type CreateQuestionInput = {
  /** Enunciado da questão */
  statement: string;
  /** Alternativas (JSON) */
  alternatives?: unknown[];
  /** Resposta correta */
  correctAnswer?: string | null;
  /** Se é verdadeiro/falso */
  isTrueFalse?: boolean;
  /** Banca examinadora */
  examBoard?: string | null;
  /** Nome do concurso (texto livre) */
  contestName?: string | null;
  /** ID do concurso vinculado */
  contestId?: string | null;
  /** ID da fonte vinculada */
  sourceId?: string | null;
  /** Ano da prova */
  year?: number | null;
  /** ID da matéria */
  subjectId?: string | null;
  /** ID do tópico */
  topicId?: string | null;
  /** Dificuldade (1-5) */
  difficulty?: number | null;
  /** Origem */
  origin?: QuestionOrigin;
  /** Novidade */
  novelty?: QuestionNovelty | null;
  /** Tags */
  tags?: string[];
  /** Explicação/gabarito comentado */
  explanation?: string | null;
  /** Se é pública */
  isPublic?: boolean;
  /** Metadados adicionais em JSONB (ex: cargo/position, órgão/organization, content_hash) */
  metadata?: Record<string, unknown>;
};

/**
 * Insere uma nova questão na tabela `questions` para o usuário autenticado.
 * Usa o cliente Supabase do browser (client-side).
 *
 * Realiza deduplicação automática verificando o hash determinístico
 * do conteúdo (statement + alternatives). Se já existir, retorna o item existente.
 *
 * Retorna o QuestionBankItem criado ou existente.
 *
 * Queries: 1-2 (SELECT deduplicação + INSERT questions se nova).
 */
export async function createQuestion(input: CreateQuestionInput): Promise<QuestionBankItem> {
  const userId = await requireUser();

  const hash =
    (input.metadata?.content_hash as string) ||
    computeQuestionContentHash(
      input.statement,
      (input.alternatives as Array<{
        letter?: string;
        text?: string;
        isCorrect?: boolean | null;
      }>) ?? [],
    );

  // 1. Verificação de deduplicação via metadata->>content_hash
  const { data: existing } = await supabase
    .from("questions")
    .select(QUESTION_SELECT)
    .filter("metadata->>content_hash", "eq", hash)
    .maybeSingle();

  if (existing) {
    return toQuestionBankItem(existing as QuestionRow, null);
  }

  const finalMetadata = {
    ...(input.metadata ?? {}),
    content_hash: hash,
  };

  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    statement: input.statement,
    alternatives: input.alternatives ?? [],
    correct_answer: input.correctAnswer ?? null,
    is_true_false: input.isTrueFalse ?? false,
    exam_board: normalizeExamBoard(input.examBoard),
    contest_name: input.contestName ?? null,
    contest_id: input.contestId ?? null,
    source_id: input.sourceId ?? null,
    year: input.year ?? null,
    subject_id: input.subjectId ?? null,
    topic_id: input.topicId ?? null,
    difficulty: input.difficulty ?? null,
    origin: input.origin ?? "manual",
    novelty: input.novelty ?? null,
    tags: input.tags ?? [],
    explanation: input.explanation ?? null,
    is_public: input.isPublic ?? false,
    metadata: finalMetadata,
  };

  const { data, error } = await supabase
    .from("questions")
    .insert(insertPayload)
    .select(QUESTION_SELECT)
    .single();

  if (error) throw error;

  return toQuestionBankItem(data as QuestionRow, null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. createQuestionWithClient (server-side)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insere uma nova questão na tabela `questions` usando um cliente Supabase
 * autenticado fornecido externamente (server-side).
 *
 * Realiza deduplicação automática verificando o hash determinístico
 * do conteúdo (statement + alternatives). Se já existir, retorna o item existente.
 *
 * O cliente já carrega o token JWT do usuário no header Authorization,
 * fazendo com que auth.uid() funcione e o RLS seja respeitado.
 *
 * Retorna o QuestionBankItem criado ou existente.
 *
 * Queries: 1-2 (SELECT deduplicação + INSERT questions se nova).
 */
export async function createQuestionWithClient(
  input: CreateQuestionInput,
  client: SupabaseClient,
): Promise<QuestionBankItem> {
  const userId = await requireUserFromClient(client);

  const hash =
    (input.metadata?.content_hash as string) ||
    computeQuestionContentHash(
      input.statement,
      (input.alternatives as Array<{
        letter?: string;
        text?: string;
        isCorrect?: boolean | null;
      }>) ?? [],
    );

  // 1. Verificação de deduplicação via metadata->>content_hash
  const { data: existing } = await client
    .from("questions")
    .select(QUESTION_SELECT)
    .filter("metadata->>content_hash", "eq", hash)
    .maybeSingle();

  if (existing) {
    return toQuestionBankItem(existing as QuestionRow, null);
  }

  const finalMetadata = {
    ...(input.metadata ?? {}),
    content_hash: hash,
  };

  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    statement: input.statement,
    alternatives: input.alternatives ?? [],
    correct_answer: input.correctAnswer ?? null,
    is_true_false: input.isTrueFalse ?? false,
    exam_board: normalizeExamBoard(input.examBoard),
    contest_name: input.contestName ?? null,
    contest_id: input.contestId ?? null,
    source_id: input.sourceId ?? null,
    year: input.year ?? null,
    subject_id: input.subjectId ?? null,
    topic_id: input.topicId ?? null,
    difficulty: input.difficulty ?? null,
    origin: input.origin ?? "manual",
    novelty: input.novelty ?? null,
    tags: input.tags ?? [],
    explanation: input.explanation ?? null,
    is_public: input.isPublic ?? false,
    metadata: finalMetadata,
  };

  const { data, error } = await client
    .from("questions")
    .insert(insertPayload)
    .select(QUESTION_SELECT)
    .single();

  // Throw the raw Supabase PostgrestError so that callers (gemini-service)
  // can inspect code, details and hint for diagnostics.
  if (error) throw error;

  return toQuestionBankItem(data as QuestionRow, null);
}
