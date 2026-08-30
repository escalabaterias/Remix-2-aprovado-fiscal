/**
 * ENTITY RESOLVER — Resolução automática de matéria e tópico
 *
 * Resolve nomes de matéria (subject) e tópico (topic) para IDs existentes
 * no banco, ou cria novas entidades quando não encontra correspondência.
 *
 * Usado durante a importação de questões (ex: Gemini) para converter
 * os labels de texto livre (subjectLabel, topicLabel) em subject_id e topic_id.
 *
 * SEGURANÇA:
 *   - Não aceita userId externo — extrai do token JWT do cliente Supabase.
 *   - RLS por user_id é a fronteira de segurança.
 *
 * NORMALIZAÇÃO:
 *   - Remove espaços extras (trim + collapse whitespace)
 *   - Converte para lowercase
 *   - Remove acentos (normalize NFD + strip combining marks)
 *
 * NÃO FAZ:
 *   - Alterar banco, migrations, Gemini, UI ou outros services.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizeName, normalizeExamBoard } from "./normalizer";

export { normalizeName } from "./normalizer";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS DE RESOLUÇÃO DE ENTIDADES
// ─────────────────────────────────────────────────────────────────────────────

export type ContestResolveInput = {
  name: string;
  organization?: string | null;
  roleTitle?: string | null;
  position?: string | null;
  examBoard?: string | null;
  year?: number | null;
  examDate?: string | null;
  description?: string | null;
};

export type SourceResolveInput = {
  title?: string | null;
  url?: string | null;
  type?: Database["public"]["Enums"]["source_type"] | null;
  origin?: string | null;
  contestId?: string | null;
  subjectId?: string | null;
  topicId?: string | null;
  metadata?: Record<string, unknown> | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Obtém o userId a partir de um cliente Supabase autenticado.
 * Não aceita userId externo — extrai do token JWT.
 */
async function requireUserFromClient(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new Error("Usuário não autenticado.");
  }
  return data.user.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveSubject
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve o nome de uma matéria para um subject_id existente ou cria uma nova.
 *
 * 1. Normaliza o nome recebido.
 * 2. Busca todas as matérias do usuário autenticado.
 * 3. Compara os nomes normalizados.
 * 4. Se encontrar correspondência, retorna o ID existente.
 * 5. Se não encontrar, cria a matéria com o nome original (preservando
 *    capitalização) e retorna o novo ID.
 *
 * Nunca cria duplicata quando a matéria já existe (comparação normalizada).
 *
 * @param name - Nome da matéria (texto livre, ex: "Direito Constitucional").
 * @param client - Cliente Supabase autenticado (com token JWT do usuário).
 * @returns ID da matéria (existente ou recém-criada).
 */
export async function resolveSubject(name: string, client: SupabaseClient): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Nome da matéria não pode ser vazio.");
  }

  const userId = await requireUserFromClient(client);
  const normalizedInput = normalizeName(trimmed);

  // Buscar todas as matérias acessíveis
  const { data: subjects, error: fetchError } = await client.from("subjects").select("id, name");

  if (fetchError) throw fetchError;

  // Procurar correspondência normalizada
  for (const subject of subjects ?? []) {
    if (normalizeName(subject.name) === normalizedInput) {
      return subject.id;
    }
  }

  // Não encontrou — criar nova matéria
  const { data: created, error: createError } = await client
    .from("subjects")
    .insert({
      created_by: userId,
      name: trimmed,
    })
    .select("id")
    .single();

  if (createError) throw createError;

  return created.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveContest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve o nome de um concurso para um contest_id existente ou cria um novo.
 *
 * Se receber um objeto com metadados complementares (órgão, cargo, banca, ano),
 * enriquece o registro de concurso existente quando houver campos não preenchidos,
 * ou preenche os campos na criação.
 *
 * Nunca cria duplicata quando o concurso já existe (comparação normalizada).
 *
 * @param inputOrName - Nome do concurso (string) ou ContestResolveInput.
 * @param client - Cliente Supabase autenticado.
 * @returns ID do concurso (existente ou recém-criado).
 */
export async function resolveContest(
  inputOrName: string | ContestResolveInput,
  client: SupabaseClient,
): Promise<string> {
  const name = typeof inputOrName === "string" ? inputOrName : inputOrName.name;
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Nome do concurso não pode ser vazio.");
  }

  const inputObj = typeof inputOrName === "object" ? inputOrName : null;
  const organization = inputObj?.organization?.trim() || null;
  const roleTitle = inputObj?.roleTitle?.trim() || inputObj?.position?.trim() || null;
  const examBoard = normalizeExamBoard(inputObj?.examBoard);
  const examDate = inputObj?.examDate?.trim() || (inputObj?.year ? `${inputObj.year}-01-01` : null);
  const description = inputObj?.description?.trim() || null;

  const userId = await requireUserFromClient(client);
  const normalizedInput = normalizeName(trimmed);

  // Buscar todos os concursos acessíveis
  const { data: contests, error: fetchError } = await client
    .from("contests")
    .select("id, name, organization, role_title, exam_board, exam_date, description");

  if (fetchError) throw fetchError;

  // Procurar correspondência normalizada
  for (const contest of contests ?? []) {
    if (normalizeName(contest.name) === normalizedInput) {
      // Se houver metadados novos e o concurso existente tiver campos vazios, atualiza
      const updates: Record<string, unknown> = {};
      if (organization && !contest.organization) updates.organization = organization;
      if (roleTitle && !contest.role_title) updates.role_title = roleTitle;
      if (examBoard && !contest.exam_board) updates.exam_board = examBoard;
      if (examDate && !contest.exam_date) updates.exam_date = examDate;
      if (description && !contest.description) updates.description = description;

      if (Object.keys(updates).length > 0) {
        await client.from("contests").update(updates).eq("id", contest.id);
      }

      return contest.id;
    }
  }

  // Não encontrou — criar novo concurso com metadados estruturados
  const { data: created, error: createError } = await client
    .from("contests")
    .insert({
      user_id: userId,
      name: trimmed,
      status: "futuro",
      organization: organization || null,
      role_title: roleTitle || null,
      exam_board: examBoard || null,
      exam_date: examDate || null,
      description: description || null,
    })
    .select("id")
    .single();

  if (createError) throw createError;

  return created.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveSource
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve ou cria um registro de fonte (sources) vinculado à questão.
 *
 * @param input - Dados da fonte a ser resolvida/criada.
 * @param client - Cliente Supabase autenticado.
 * @returns ID da fonte criada/existente, ou null se não houver dados de fonte.
 */
export async function resolveSource(
  input: SourceResolveInput,
  client: SupabaseClient,
): Promise<string | null> {
  const trimmedTitle = input.title?.trim() || null;
  const trimmedUrl = input.url?.trim() || null;

  // Se não tem nem título nem URL, não há fonte a resolver
  if (!trimmedTitle && !trimmedUrl) {
    return null;
  }

  const userId = await requireUserFromClient(client);

  // Buscar fontes acessíveis do usuário
  const { data: sources, error: fetchError } = await client
    .from("sources")
    .select("id, title, url")
    .eq("user_id", userId);

  if (fetchError) throw fetchError;

  const targetTitleNorm = trimmedTitle ? normalizeName(trimmedTitle) : null;
  const targetUrl = trimmedUrl ? trimmedUrl.toLowerCase() : null;

  for (const source of sources ?? []) {
    if (
      (targetTitleNorm && normalizeName(source.title) === targetTitleNorm) ||
      (targetUrl && source.url && source.url.toLowerCase() === targetUrl)
    ) {
      return source.id;
    }
  }

  // Inserir nova fonte
  const { data: created, error: createError } = await client
    .from("sources")
    .insert({
      user_id: userId,
      title: trimmedTitle || "Fonte da Questão",
      type: input.type ?? "prova",
      origin: input.origin ?? "imagem_print",
      url: trimmedUrl,
      contest_id: input.contestId ?? null,
      subject_id: input.subjectId ?? null,
      topic_id: input.topicId ?? null,
      metadata: (input.metadata ??
        {}) as Database["public"]["Tables"]["sources"]["Insert"]["metadata"],
      reliability: 1.0,
    })
    .select("id")
    .single();

  if (createError) throw createError;

  return created.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveTopic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve o nome de um tópico para um topic_id existente ou cria um novo,
 * vinculado à matéria informada.
 *
 * 1. Normaliza o nome recebido.
 * 2. Busca todos os tópicos dentro da matéria (subject_id).
 * 3. Compara os nomes normalizados.
 * 4. Se encontrar correspondência, retorna o ID existente.
 * 5. Se não encontrar, cria o tópico com kind = "topico" (padrão do projeto)
 *    e retorna o novo ID.
 *
 * Nunca cria duplicata dentro da mesma matéria (comparação normalizada).
 *
 * @param name - Nome do tópico (texto livre, ex: "Princípios Fundamentais").
 * @param subjectId - ID da matéria à qual o tópico pertence.
 * @param client - Cliente Supabase autenticado (com token JWT do usuário).
 * @returns ID do tópico (existente ou recém-criado).
 */
export async function resolveTopic(
  name: string,
  subjectId: string,
  client: SupabaseClient,
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Nome do tópico não pode ser vazio.");
  }
  if (!subjectId) {
    throw new Error("ID da matéria é obrigatório para resolver o tópico.");
  }

  const userId = await requireUserFromClient(client);
  const normalizedInput = normalizeName(trimmed);

  // Buscar tópicos dentro da matéria
  const { data: topics, error: fetchError } = await client
    .from("topics")
    .select("id, name")
    .eq("subject_id", subjectId);

  if (fetchError) throw fetchError;

  // Procurar correspondência normalizada
  for (const topic of topics ?? []) {
    if (normalizeName(topic.name) === normalizedInput) {
      return topic.id;
    }
  }

  // Não encontrou — criar novo tópico vinculado à matéria
  // Usa kind = "topico" (padrão do projeto, conforme enum topic_kind)
  const { data: created, error: createError } = await client
    .from("topics")
    .insert({
      created_by: userId,
      subject_id: subjectId,
      name: trimmed,
      kind: "topico",
    })
    .select("id")
    .single();

  if (createError) throw createError;

  return created.id;
}
