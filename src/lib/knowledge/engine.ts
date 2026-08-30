/**
 * MOTOR DETERMINÍSTICO DE CONHECIMENTO — Etapa 3.1
 *
 * Recebe o estado atual do domínio de um tópico e uma tentativa,
 * retorna o novo estado calculado.
 *
 * FÓRMULA (v2 — EMA limitado + ancoragem por evidência):
 *
 *   alpha      = min( 2 / (min(totalQuestions, 50) + 2), ALPHA_MAX = 0.5 )
 *   alpha_eff  = min( alpha * multiplicador_dificuldade, ALPHA_MAX )
 *   ema        = old_mastery + alpha_eff * (target - old_mastery)
 *                  onde target = 1 para acerto, 0 para erro
 *   accuracy   = correctQuestions / totalQuestions (após a tentativa)
 *   w          = totalQuestions / (totalQuestions + 20)
 *   blended    = (1 - w) * ema + w * accuracy
 *   teto       = 0.60 + 0.40 * confidence   (teto por evidência)
 *   mastery    = min(blended, teto)
 *
 *   confidence = 1 - e^(-totalQuestions / 10)
 *
 * MULTIPLICADOR DE DIFICULDADE
 *   Acerto: difícil 1.2 · média 1.0 · fácil 0.8
 *   Erro:   fácil 1.2 · média 1.0 · difícil 0.8
 *   (para erros o target é 0, então a dificuldade age via alpha efetivo)
 *
 * POR QUE A ANCORAGEM
 *   O EMA puro é dependente de ordem: uma sequência final de erros derrubava
 *   um aluno com 85% de acerto em 100 questões para ~0.55, e um alpha sem teto
 *   levava mastery a 1.0 na primeira resposta correta. A ancoragem pelo
 *   desempenho histórico, com peso crescente na quantidade de evidência,
 *   corrige ambos os desvios sem abandonar a sensibilidade à tendência recente.

 *
 * PROPRIEDADES:
 *   - Mastery sempre entre 0 e 1
 *   - Confidence sempre entre 0 e 1
 *   - Alpha diminui com amostra maior (estabilidade)
 *   - Questão isolada não destrói domínio alto
 *   - Poucas questões certas não dão domínio máximo
 *   - Determinístico: mesmo input → mesmo output
 *   - Sem dependência externa (puro)
 */

export type Difficulty = "facil" | "media" | "dificil";

export type KnowledgeState = {
  mastery: number;
  confidence: number;
  totalQuestions: number;
  correctQuestions: number;
  lastStudiedAt: string | null;
};

export type AttemptInput = {
  isCorrect: boolean;
  difficulty: Difficulty;
  errorCategory: string | null;
  attemptId: string;
  timestamp: string;
};

export type KnowledgeUpdate = {
  newState: KnowledgeState;
  masteryBefore: number;
  masteryAfter: number;
  confidence: number;
  reason: string;
};

/** Estado inicial para um tópico sem histórico. */
export const INITIAL_STATE: KnowledgeState = {
  mastery: 0,
  confidence: 0,
  totalQuestions: 0,
  correctQuestions: 0,
  lastStudiedAt: null,
};

const MAX_SAMPLE = 50;

/**
 * Teto do alpha efetivo (EMA).
 * Um EMA matematicamente válido exige alpha <= 1; pedagogicamente,
 * nenhuma única resposta deve mover o domínio mais da metade da
 * distância até o alvo. Sem este teto, a primeira resposta correta
 * levava alpha = 2 → clamp 1 → mastery = 1 (domínio máximo com 1 questão).
 */
const ALPHA_MAX = 0.5;

/**
 * Constante de ancoragem por evidência.
 * Define quantas questões são necessárias para que a acurácia histórica
 * pese metade do mastery final (n = K → peso 0.5).
 */
const EVIDENCE_ANCHOR_K = 20;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Fator de suavização (alpha) baseado no tamanho da amostra.
 * Diminui conforme a amostra cresce, estabilizando o mastery.
 *
 * Com 0 questões: alpha = 2/2 = 1.0 → limitado por ALPHA_MAX (0.5)
 * Com 1 questão:  alpha = 2/3 ≈ 0.67 → limitado por ALPHA_MAX (0.5)
 * Com 5 questões: alpha = 2/7 ≈ 0.29
 * Com 10 questões: alpha = 2/12 ≈ 0.17
 * Com 50+ questões: alpha = 2/52 ≈ 0.038
 */
function computeAlpha(totalQuestions: number): number {
  const n = Math.min(totalQuestions, MAX_SAMPLE);
  return Math.min(2 / (n + 2), ALPHA_MAX);
}

/**
 * Peso da acurácia histórica no mastery final.
 * Cresce com a quantidade de evidência: pouca evidência → o mastery
 * fica dominado pela trajetória recente (EMA) e não pode ser inflado
 * por uma acurácia de 100% obtida em 2 questões; muita evidência →
 * o desempenho histórico agregado ancora o mastery, impedindo que uma
 * sequência recente de erros ou acertos distorça o domínio real.
 */
export function accuracyWeight(totalQuestions: number): number {
  if (totalQuestions <= 0) return 0;
  return totalQuestions / (totalQuestions + EVIDENCE_ANCHOR_K);
}

/**
 * Piso do teto de domínio declarável sem evidência.
 * Com 0 questões o teto é 0.60 e cresce com a confidence até 1.0.
 */
const EVIDENCE_CEILING_BASE = 0.6;

/**
 * Teto de mastery admissível para a evidência disponível.
 * Regra pedagógica: o sistema não pode declarar domínio consolidado
 * enquanto a evidência for insuficiente, mesmo com 100% de acerto.
 *
 *   teto = 0.60 + 0.40 * confidence
 *
 * Exemplos: 2 questões → 0.67 · 5 → 0.76 · 10 → 0.85 · 30 → 0.98
 */
export function masteryCeiling(totalQuestions: number): number {
  return clamp01(
    EVIDENCE_CEILING_BASE + (1 - EVIDENCE_CEILING_BASE) * computeConfidence(totalQuestions),
  );
}

/**
 * Multiplicador de dificuldade.
 * Amplifica ou atenua o impacto da tentativa.
 */
function difficultyMultiplier(difficulty: Difficulty, isCorrect: boolean): number {
  if (isCorrect) {
    switch (difficulty) {
      case "dificil":
        return 1.2; // acerto em difícil vale mais
      case "facil":
        return 0.8; // acerto em fácil vale menos
      default:
        return 1.0;
    }
  } else {
    switch (difficulty) {
      case "facil":
        return 1.2; // erro em fácil penaliza mais
      case "dificil":
        return 0.8; // erro em difícil penaliza menos
      default:
        return 1.0;
    }
  }
}

/**
 * Confidence: função logística sobre quantidade de questões.
 * Escala 0..1.
 *
 * Exemplos:
 *   0 questões → 0
 *   2 questões → ~0.18
 *   5 questões → ~0.39
 *   10 questões → ~0.63
 *   20 questões → ~0.86
 *   50 questões → ~0.99
 */
export function computeConfidence(totalQuestions: number): number {
  if (totalQuestions <= 0) return 0;
  return clamp01(1 - Math.exp(-totalQuestions / 10));
}

/**
 * Calcula o novo estado de conhecimento após uma tentativa.
 *
 * Determinístico: dado o mesmo estado + input, retorna sempre o mesmo resultado.
 */
export function updateKnowledge(current: KnowledgeState, attempt: AttemptInput): KnowledgeUpdate {
  const newTotal = current.totalQuestions + 1;
  const newCorrect = current.correctQuestions + (attempt.isCorrect ? 1 : 0);

  const alpha = computeAlpha(current.totalQuestions);
  const mult = difficultyMultiplier(attempt.difficulty, attempt.isCorrect);
  const alphaEff = Math.min(clamp01(alpha * mult), ALPHA_MAX);

  const target = attempt.isCorrect ? 1 : 0;
  const oldMastery = current.mastery;

  // 1) Trajetória recente (EMA), limitada por ALPHA_MAX: nenhuma resposta
  //    isolada leva o domínio ao máximo nem o destrói.
  const ema = clamp01(oldMastery + alphaEff * (target - oldMastery));

  // 2) Ancoragem por evidência: quanto mais questões, mais o desempenho
  //    histórico agregado (accuracy) pesa no mastery final.
  const accuracy = newCorrect / newTotal;
  const w = accuracyWeight(newTotal);
  const blended = clamp01((1 - w) * ema + w * accuracy);

  // 3) Teto por evidência: pouca evidência nunca declara domínio consolidado.
  const newMastery = Math.min(blended, masteryCeiling(newTotal));
  const confidence = computeConfidence(newTotal);

  const reason = attempt.isCorrect
    ? `Acerto em questão ${attempt.difficulty} (alpha=${alphaEff.toFixed(3)})`
    : `Erro em questão ${attempt.difficulty}${attempt.errorCategory ? ` — ${attempt.errorCategory}` : ""} (alpha=${alphaEff.toFixed(3)})`;

  const newState: KnowledgeState = {
    mastery: newMastery,
    confidence,
    totalQuestions: newTotal,
    correctQuestions: newCorrect,
    lastStudiedAt: attempt.timestamp,
  };

  return {
    newState,
    masteryBefore: oldMastery,
    masteryAfter: newMastery,
    confidence,
    reason,
  };
}

/**
 * Processa uma sequência de tentativas sobre um estado inicial.
 * Útil para recálculo ou testes.
 */
export function replayAttempts(
  initial: KnowledgeState,
  attempts: AttemptInput[],
): KnowledgeUpdate[] {
  const updates: KnowledgeUpdate[] = [];
  let state = initial;
  for (const attempt of attempts) {
    const update = updateKnowledge(state, attempt);
    updates.push(update);
    state = update.newState;
  }
  return updates;
}
