/**
 * Módulo de análise de erros — Etapa 3.1
 *
 * Funções determinísticas para análise de recorrência e padrões de erro.
 * Todas operam sobre arrays de registros (não fazem queries diretamente).
 * A camada de serviço busca os dados do Supabase e passa para cá.
 */

export type ErrorRecord = {
  id: string;
  userId: string;
  topicId: string | null;
  subjectId: string | null;
  category: string | null;
  isResolved: boolean;
  resolvedAt: string | null;
  occurredAt: string;
  attemptId: string | null;
  questionId: string | null;
};

export type ErrorAnalysis = {
  totalErrors: number;
  unresolvedErrors: number;
  recurringErrors: number;
  lastErrorDate: string | null;
  daysSinceLastError: number | null;
  categoryFrequency: Map<string, number>;
  topCategory: string | null;
};

/**
 * Analisa erros de um tópico específico para um usuário.
 */
export function analyzeTopicErrors(
  errors: ErrorRecord[],
  topicId: string,
  referenceDate: string,
): ErrorAnalysis {
  const topicErrors = errors.filter((e) => e.topicId === topicId);
  const unresolved = topicErrors.filter((e) => !e.isResolved);
  const recurring = countRecurringErrors(topicErrors);

  const categoryFreq = new Map<string, number>();
  for (const e of topicErrors) {
    if (e.category) {
      categoryFreq.set(e.category, (categoryFreq.get(e.category) ?? 0) + 1);
    }
  }

  let topCategory: string | null = null;
  let topCount = 0;
  for (const [cat, count] of categoryFreq) {
    if (count > topCount) {
      topCount = count;
      topCategory = cat;
    }
  }

  const sorted = topicErrors.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  const lastErrorDate = sorted[0]?.occurredAt ?? null;

  let daysSinceLastError: number | null = null;
  if (lastErrorDate) {
    const diff = new Date(referenceDate).getTime() - new Date(lastErrorDate).getTime();
    daysSinceLastError = Math.max(0, Math.round(diff / 86_400_000));
  }

  return {
    totalErrors: topicErrors.length,
    unresolvedErrors: unresolved.length,
    recurringErrors: recurring,
    lastErrorDate,
    daysSinceLastError,
    categoryFrequency: categoryFreq,
    topCategory,
  };
}

/**
 * Conta erros recorrentes: um erro é recorrente quando existe um erro anterior
 * no mesmo tópico + mesma categoria que já foi resolvido.
 *
 * Isso significa: o aluno errou, resolveu o problema, e voltou a errar.
 * Um simples segundo erro NÃO é recorrente se o primeiro nunca foi resolvido.
 */
export function countRecurringErrors(errors: ErrorRecord[]): number {
  // Agrupa por (topicId, category)
  const groups = new Map<string, ErrorRecord[]>();
  for (const e of errors) {
    if (!e.topicId || !e.category) continue;
    const key = `${e.topicId}::${e.category}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  let count = 0;
  for (const [, group] of groups) {
    // Ordena cronologicamente
    const sorted = [...group].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );

    // Para cada erro, verifica se existe um erro anterior resolvido
    let hasResolvedBefore = false;
    for (const error of sorted) {
      if (hasResolvedBefore && !error.isResolved) {
        // Este é um erro recorrente: apareceu após um resolvido
        count++;
      }
      if (error.isResolved) {
        hasResolvedBefore = true;
      }
    }
  }

  return count;
}

/**
 * Verifica se um erro específico é recorrente (tem precedente resolvido
 * no mesmo tópico + categoria).
 */
export function isRecurringError(error: ErrorRecord, allErrors: ErrorRecord[]): boolean {
  if (!error.topicId || !error.category) return false;

  const prior = allErrors.filter(
    (e) =>
      e.id !== error.id &&
      e.topicId === error.topicId &&
      e.category === error.category &&
      e.userId === error.userId &&
      e.isResolved &&
      new Date(e.occurredAt).getTime() < new Date(error.occurredAt).getTime(),
  );

  return prior.length > 0;
}

/**
 * Retorna as categorias de erro mais frequentes para um usuário,
 * ordenadas por frequência decrescente.
 */
export function topErrorCategories(
  errors: ErrorRecord[],
  limit: number = 5,
): { category: string; count: number }[] {
  const freq = new Map<string, number>();
  for (const e of errors) {
    if (e.category) {
      freq.set(e.category, (freq.get(e.category) ?? 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Intervalo médio entre erros (em dias) para um tópico.
 */
export function averageErrorInterval(errors: ErrorRecord[], topicId: string): number | null {
  const topicErrors = errors
    .filter((e) => e.topicId === topicId)
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

  if (topicErrors.length < 2) return null;

  let totalDays = 0;
  for (let i = 1; i < topicErrors.length; i++) {
    const diff =
      new Date(topicErrors[i]!.occurredAt).getTime() -
      new Date(topicErrors[i - 1]!.occurredAt).getTime();
    totalDays += diff / 86_400_000;
  }

  return totalDays / (topicErrors.length - 1);
}
