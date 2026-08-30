import { describe, it, expect } from "vitest";
import {
  updateKnowledge,
  replayAttempts,
  computeConfidence,
  INITIAL_STATE,
  type KnowledgeState,
  type AttemptInput,
} from "./engine";

const mkAttempt = (
  isCorrect: boolean,
  difficulty: "facil" | "media" | "dificil" = "media",
  errorCategory: string | null = null,
  index: number = 0,
): AttemptInput => ({
  isCorrect,
  difficulty,
  errorCategory,
  attemptId: `attempt-${index}`,
  timestamp: new Date(2026, 0, 1 + index).toISOString(),
});

describe("knowledge engine", () => {
  // Teste 1: Novo aluno sem histórico
  it("1 — initial state has zero mastery and zero confidence", () => {
    expect(INITIAL_STATE.mastery).toBe(0);
    expect(INITIAL_STATE.confidence).toBe(0);
    expect(INITIAL_STATE.totalQuestions).toBe(0);
    expect(INITIAL_STATE.correctQuestions).toBe(0);
  });

  // Teste 2: Primeiro acerto
  it("2 — first correct answer increases mastery from 0", () => {
    const result = updateKnowledge(INITIAL_STATE, mkAttempt(true, "media", null, 0));
    expect(result.masteryAfter).toBeGreaterThan(0);
    expect(result.masteryAfter).toBeLessThanOrEqual(1);
    expect(result.newState.totalQuestions).toBe(1);
    expect(result.newState.correctQuestions).toBe(1);
  });

  // Teste 3: Primeiro erro
  it("3 — first wrong answer keeps mastery at 0", () => {
    const result = updateKnowledge(INITIAL_STATE, mkAttempt(false, "media", "desconhecimento", 0));
    // Starting from 0, error keeps it at 0 (alpha * (0 - 0) = 0)
    expect(result.masteryAfter).toBe(0);
    expect(result.newState.totalQuestions).toBe(1);
    expect(result.newState.correctQuestions).toBe(0);
  });

  // Teste 4: Sequência de acertos
  it("4 — sequence of correct answers raises mastery progressively", () => {
    const attempts = Array.from({ length: 10 }, (_, i) => mkAttempt(true, "media", null, i));
    const updates = replayAttempts(INITIAL_STATE, attempts);
    // Mastery should increase monotonically
    for (let i = 1; i < updates.length; i++) {
      expect(updates[i]!.masteryAfter).toBeGreaterThanOrEqual(updates[i - 1]!.masteryAfter);
    }
    // After 10 correct answers, mastery should be high
    expect(updates[updates.length - 1]!.masteryAfter).toBeGreaterThan(0.7);
  });

  // Teste 5: Sequência de erros
  it("5 — sequence of errors keeps mastery low", () => {
    // Start from a mid-level mastery
    const state: KnowledgeState = {
      mastery: 0.5,
      confidence: 0.3,
      totalQuestions: 5,
      correctQuestions: 3,
      lastStudiedAt: null,
    };
    const attempts = Array.from({ length: 10 }, (_, i) =>
      mkAttempt(false, "media", "confusao_conceitual", i),
    );
    const updates = replayAttempts(state, attempts);
    // Mastery should decrease
    expect(updates[updates.length - 1]!.masteryAfter).toBeLessThan(0.3);
  });

  // Teste 6: Alternância acerto/erro
  it("6 — alternating correct/error stabilizes mastery around 0.5", () => {
    const attempts = Array.from({ length: 20 }, (_, i) =>
      mkAttempt(i % 2 === 0, "media", i % 2 !== 0 ? "interpretacao" : null, i),
    );
    const updates = replayAttempts(INITIAL_STATE, attempts);
    const finalMastery = updates[updates.length - 1]!.masteryAfter;
    // Should be roughly around 0.3-0.7 (middle ground)
    expect(finalMastery).toBeGreaterThan(0.2);
    expect(finalMastery).toBeLessThan(0.8);
  });

  // Teste 7: Muitas questões com alta taxa de acerto
  it("7 — many questions with high accuracy yields high mastery", () => {
    // 85 correct out of 100
    const attempts: AttemptInput[] = [];
    for (let i = 0; i < 100; i++) {
      attempts.push(mkAttempt(i < 85, "media", i >= 85 ? "desatencao" : null, i));
    }
    const updates = replayAttempts(INITIAL_STATE, attempts);
    const final = updates[updates.length - 1]!;
    expect(final.masteryAfter).toBeGreaterThan(0.6);
  });

  // Teste 8: Muitas questões com baixa taxa de acerto
  it("8 — many questions with low accuracy yields low mastery", () => {
    // 20 correct out of 100
    const attempts: AttemptInput[] = [];
    for (let i = 0; i < 100; i++) {
      attempts.push(mkAttempt(i < 20, "media", i >= 20 ? "desconhecimento" : null, i));
    }
    const updates = replayAttempts(INITIAL_STATE, attempts);
    const final = updates[updates.length - 1]!;
    expect(final.masteryAfter).toBeLessThan(0.4);
  });

  // Teste 9: Poucas questões e confidence baixa
  it("9 — few questions produce low confidence", () => {
    const attempts = [mkAttempt(true, "media", null, 0), mkAttempt(true, "media", null, 1)];
    const updates = replayAttempts(INITIAL_STATE, attempts);
    const final = updates[updates.length - 1]!;
    expect(final.confidence).toBeLessThan(0.3);
    // Mastery can be somewhat high but confidence is low
    expect(final.masteryAfter).toBeGreaterThan(0);
  });

  // Teste 10: Grande histórico e confidence alta
  it("10 — large history produces high confidence", () => {
    const attempts = Array.from({ length: 50 }, (_, i) => mkAttempt(true, "media", null, i));
    const updates = replayAttempts(INITIAL_STATE, attempts);
    const final = updates[updates.length - 1]!;
    expect(final.confidence).toBeGreaterThan(0.95);
  });

  // Teste 11: Erro recorrente (o engine calcula o domínio, recorrência é no módulo errors)
  it("11 — error after recovery lowers mastery again", () => {
    // Build up mastery, then error
    const buildUp = Array.from({ length: 10 }, (_, i) => mkAttempt(true, "media", null, i));
    const upUpdates = replayAttempts(INITIAL_STATE, buildUp);
    const peakState = upUpdates[upUpdates.length - 1]!.newState;
    const peakMastery = peakState.mastery;

    // Now error
    const errorResult = updateKnowledge(
      peakState,
      mkAttempt(false, "media", "confusao_conceitual", 10),
    );
    expect(errorResult.masteryAfter).toBeLessThan(peakMastery);
  });

  // Teste 12: Erro resolvido seguido de novo erro
  it("12 — new error after previous recovery reduces mastery", () => {
    // Simulate: build up → error → recovery (more correct) → new error
    const phase1 = Array.from({ length: 5 }, (_, i) => mkAttempt(true, "media", null, i));
    const phase2 = [mkAttempt(false, "media", "interpretacao", 5)];
    const phase3 = Array.from({ length: 5 }, (_, i) => mkAttempt(true, "media", null, 6 + i));
    const phase4 = [mkAttempt(false, "media", "interpretacao", 11)];

    const all = [...phase1, ...phase2, ...phase3, ...phase4];
    const updates = replayAttempts(INITIAL_STATE, all);

    const beforeSecondError = updates[updates.length - 2]!.masteryAfter;
    const afterSecondError = updates[updates.length - 1]!.masteryAfter;
    expect(afterSecondError).toBeLessThan(beforeSecondError);
  });

  // Teste 13: Questão difícil
  it("13 — correct answer on hard question gives bigger boost", () => {
    const state: KnowledgeState = {
      mastery: 0.5,
      confidence: 0.5,
      totalQuestions: 10,
      correctQuestions: 5,
      lastStudiedAt: null,
    };
    const easyResult = updateKnowledge(state, mkAttempt(true, "facil", null, 0));
    const hardResult = updateKnowledge(state, mkAttempt(true, "dificil", null, 1));
    expect(hardResult.masteryAfter).toBeGreaterThan(easyResult.masteryAfter);
  });

  // Teste 14: Questão fácil
  it("14 — error on easy question penalizes more", () => {
    const state: KnowledgeState = {
      mastery: 0.5,
      confidence: 0.5,
      totalQuestions: 10,
      correctQuestions: 5,
      lastStudiedAt: null,
    };
    const easyError = updateKnowledge(state, mkAttempt(false, "facil", "desatencao", 0));
    const hardError = updateKnowledge(state, mkAttempt(false, "dificil", "desconhecimento", 1));
    expect(easyError.masteryAfter).toBeLessThan(hardError.masteryAfter);
  });

  // Teste 15: Atualização do domínio gera snapshot histórico
  it("15 — update produces snapshot data for history", () => {
    const result = updateKnowledge(INITIAL_STATE, mkAttempt(true, "media", null, 0));
    expect(result.masteryBefore).toBe(0);
    expect(result.masteryAfter).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reason).toBeTruthy();
    expect(result.newState.totalQuestions).toBe(1);
  });

  // Teste 16: Snapshot anterior nunca é sobrescrito
  it("16 — previous snapshot data is preserved in sequence", () => {
    const attempts = Array.from({ length: 5 }, (_, i) => mkAttempt(true, "media", null, i));
    const updates = replayAttempts(INITIAL_STATE, attempts);

    // Each update has its own masteryBefore/After pair
    for (let i = 1; i < updates.length; i++) {
      expect(updates[i]!.masteryBefore).toBe(updates[i - 1]!.masteryAfter);
    }

    // Original updates are not mutated
    const firstSnapshot = updates[0]!;
    expect(firstSnapshot.masteryBefore).toBe(0);
  });

  // Teste 17: Atualização mantém mastery entre 0 e 1
  it("17 — mastery stays between 0 and 1 in all scenarios", () => {
    const scenarios: AttemptInput[][] = [
      // All correct
      Array.from({ length: 100 }, (_, i) => mkAttempt(true, "dificil", null, i)),
      // All wrong
      Array.from({ length: 100 }, (_, i) => mkAttempt(false, "facil", "desconhecimento", i)),
      // Mixed
      Array.from({ length: 100 }, (_, i) => mkAttempt(Math.random() > 0.5, "media", null, i)),
    ];

    for (const attempts of scenarios) {
      const updates = replayAttempts(INITIAL_STATE, attempts);
      for (const u of updates) {
        expect(u.masteryAfter).toBeGreaterThanOrEqual(0);
        expect(u.masteryAfter).toBeLessThanOrEqual(1);
      }
    }
  });

  // Teste 18: Atualização mantém confidence entre 0 e 1
  it("18 — confidence stays between 0 and 1", () => {
    for (let n = 0; n <= 200; n++) {
      const c = computeConfidence(n);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  // Teste 19: Reprocessar a mesma tentativa não duplica histórico
  it("19 — idempotency: same attempt produces same result", () => {
    const attempt = mkAttempt(true, "media", null, 0);
    const result1 = updateKnowledge(INITIAL_STATE, attempt);
    const result2 = updateKnowledge(INITIAL_STATE, attempt);

    // Same input → same output (deterministic)
    expect(result1.masteryAfter).toBe(result2.masteryAfter);
    expect(result1.confidence).toBe(result2.confidence);
    expect(result1.newState.totalQuestions).toBe(result2.newState.totalQuestions);

    // If processed again on the RESULT state, it would change.
    // Idempotency in the DB is via attempt_id check in the RPC.
    // Here we verify the engine is deterministic.
  });

  // Teste 20: Tentativas de usuários diferentes permanecem isoladas
  it("20 — different starting states produce different results", () => {
    const userA: KnowledgeState = {
      mastery: 0.8,
      confidence: 0.9,
      totalQuestions: 50,
      correctQuestions: 40,
      lastStudiedAt: null,
    };
    const userB: KnowledgeState = {
      mastery: 0.2,
      confidence: 0.5,
      totalQuestions: 10,
      correctQuestions: 2,
      lastStudiedAt: null,
    };

    const attempt = mkAttempt(true, "media", null, 0);
    const resultA = updateKnowledge(userA, attempt);
    const resultB = updateKnowledge(userB, attempt);

    // Different users (states) produce different results
    expect(resultA.masteryAfter).not.toBe(resultB.masteryAfter);
    // User A has higher mastery and it stays higher
    expect(resultA.masteryAfter).toBeGreaterThan(resultB.masteryAfter);
  });
});

describe("knowledge engine — stability", () => {
  it("high-mastery student losing 1 question does not crash mastery", () => {
    // 100 questions, 85 correct → mastery should be high
    const attempts: AttemptInput[] = [];
    for (let i = 0; i < 85; i++) attempts.push(mkAttempt(true, "media", null, i));
    for (let i = 85; i < 100; i++) attempts.push(mkAttempt(false, "media", "desatencao", i));

    const updates = replayAttempts(INITIAL_STATE, attempts);
    const stateAt100 = updates[updates.length - 1]!.newState;

    // One more error
    const oneMoreError = updateKnowledge(stateAt100, mkAttempt(false, "media", "desatencao", 100));

    // Mastery should not drop drastically
    const drop = stateAt100.mastery - oneMoreError.masteryAfter;
    expect(drop).toBeLessThan(0.05); // Less than 5% drop
    expect(oneMoreError.masteryAfter).toBeGreaterThan(0.4);
  });

  it("2 correct answers do not give maximum mastery", () => {
    const attempts = [mkAttempt(true, "media", null, 0), mkAttempt(true, "media", null, 1)];
    const updates = replayAttempts(INITIAL_STATE, attempts);
    const final = updates[updates.length - 1]!;
    expect(final.masteryAfter).toBeLessThan(0.9);
    expect(final.confidence).toBeLessThan(0.3);
  });
});

describe("knowledge engine — ownership & counter integrity", () => {
  // Teste 21: Ownership — o engine é puro e não faz queries,
  // mas validamos que o serviço passa o user_id correto para a RPC.
  // A validação real acontece no banco (RPC verifica question_attempts.user_id = auth.uid()).
  // Este teste garante que o engine não mistura estados entre usuários.
  it("21 — processing attempt with wrong user state produces different result (ownership isolation)", () => {
    // Simula: usuário A tem mastery alto, usuário B tem mastery baixo.
    // Se alguém tentasse processar o attempt do B usando o estado do A,
    // o resultado seria diferente do que se processasse com o estado correto.
    const stateUserA: KnowledgeState = {
      mastery: 0.9,
      confidence: 0.95,
      totalQuestions: 50,
      correctQuestions: 45,
      lastStudiedAt: null,
    };
    const stateUserB: KnowledgeState = {
      mastery: 0.1,
      confidence: 0.3,
      totalQuestions: 5,
      correctQuestions: 1,
      lastStudiedAt: null,
    };

    const attemptOfB = mkAttempt(true, "media", null, 0);

    // Processando com o estado correto (B)
    const correctResult = updateKnowledge(stateUserB, attemptOfB);
    // Processando com o estado errado (A) — isso é o que a RPC impede
    const wrongResult = updateKnowledge(stateUserA, attemptOfB);

    // Os resultados devem ser diferentes, provando que usar o estado errado
    // produz dados incorretos — por isso a RPC valida ownership no banco.
    expect(correctResult.masteryAfter).not.toBe(wrongResult.masteryAfter);
    expect(correctResult.newState.totalQuestions).not.toBe(wrongResult.newState.totalQuestions);

    // O resultado correto deve ter mastery mais baixo (partiu de 0.1)
    expect(correctResult.masteryAfter).toBeLessThan(wrongResult.masteryAfter);
  });

  // Teste 22: Counter regression — totalQuestions e correctQuestions nunca diminuem
  it("22 — totalQuestions and correctQuestions never decrease across any sequence", () => {
    const scenarios: AttemptInput[][] = [
      // Todos acertos
      Array.from({ length: 50 }, (_, i) => mkAttempt(true, "media", null, i)),
      // Todos erros
      Array.from({ length: 50 }, (_, i) => mkAttempt(false, "facil", "desconhecimento", i)),
      // Alternados
      Array.from({ length: 50 }, (_, i) =>
        mkAttempt(
          i % 2 === 0,
          i % 3 === 0 ? "dificil" : "media",
          i % 2 !== 0 ? "interpretacao" : null,
          i,
        ),
      ),
      // Sequência de erros após muitos acertos
      [
        ...Array.from({ length: 30 }, (_, i) => mkAttempt(true, "media", null, i)),
        ...Array.from({ length: 20 }, (_, i) => mkAttempt(false, "facil", "desatencao", 30 + i)),
      ],
    ];

    for (const attempts of scenarios) {
      const updates = replayAttempts(INITIAL_STATE, attempts);
      for (let i = 1; i < updates.length; i++) {
        const prev = updates[i - 1]!.newState;
        const curr = updates[i]!.newState;
        expect(curr.totalQuestions).toBeGreaterThanOrEqual(prev.totalQuestions);
        expect(curr.correctQuestions).toBeGreaterThanOrEqual(prev.correctQuestions);
      }
    }
  });

  // Teste 23: correctQuestions nunca ultrapassa totalQuestions
  it("23 — correctQuestions never exceeds totalQuestions", () => {
    const scenarios: AttemptInput[][] = [
      Array.from({ length: 100 }, (_, i) => mkAttempt(true, "dificil", null, i)),
      Array.from({ length: 100 }, (_, i) => mkAttempt(false, "facil", "desconhecimento", i)),
      Array.from({ length: 100 }, (_, i) => mkAttempt(Math.random() > 0.3, "media", null, i)),
    ];

    for (const attempts of scenarios) {
      const updates = replayAttempts(INITIAL_STATE, attempts);
      for (const u of updates) {
        expect(u.newState.correctQuestions).toBeLessThanOrEqual(u.newState.totalQuestions);
        expect(u.newState.correctQuestions).toBeGreaterThanOrEqual(0);
        expect(u.newState.totalQuestions).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // Teste 24: totalQuestions incrementa exatamente 1 por tentativa
  it("24 — totalQuestions increments by exactly 1 per attempt", () => {
    const attempts = Array.from({ length: 30 }, (_, i) =>
      mkAttempt(
        i % 3 !== 0,
        i % 2 === 0 ? "dificil" : "facil",
        i % 3 === 0 ? "desatencao" : null,
        i,
      ),
    );
    const updates = replayAttempts(INITIAL_STATE, attempts);

    let prevTotal = INITIAL_STATE.totalQuestions;
    for (const u of updates) {
      expect(u.newState.totalQuestions).toBe(prevTotal + 1);
      prevTotal = u.newState.totalQuestions;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROTEÇÃO DA REGRA DE MASTERY (v2 — EMA limitado + ancoragem por evidência)
// ─────────────────────────────────────────────────────────────────────────────

describe("knowledge engine — proteção da regra pedagógica de mastery", () => {
  it("P1 — 1 acerto não produz mastery máximo", () => {
    const r = updateKnowledge(INITIAL_STATE, mkAttempt(true, "dificil", null, 0));
    expect(r.masteryAfter).toBeLessThan(0.7);
    expect(r.masteryAfter).toBeGreaterThan(0);
  });

  it("P2 — 2 acertos não produzem mastery máximo (nem em questão difícil)", () => {
    const updates = replayAttempts(INITIAL_STATE, [
      mkAttempt(true, "dificil", null, 0),
      mkAttempt(true, "dificil", null, 1),
    ]);
    const final = updates[updates.length - 1]!;
    expect(final.masteryAfter).toBeLessThan(0.9);
    expect(final.masteryAfter).toBeLessThan(1);
  });

  it("P3 — poucas questões (<=5) com 100% de acerto não geram domínio artificial", () => {
    for (let n = 1; n <= 5; n++) {
      const attempts = Array.from({ length: n }, (_, i) => mkAttempt(true, "media", null, i));
      const updates = replayAttempts(INITIAL_STATE, attempts);
      const final = updates[updates.length - 1]!;
      expect(final.masteryAfter).toBeLessThan(0.95);
      expect(final.confidence).toBeLessThan(0.5);
    }
  });

  it("P4 — alta acurácia com evidência suficiente produz mastery elevado", () => {
    const attempts: AttemptInput[] = [];
    for (let i = 0; i < 40; i++) {
      attempts.push(mkAttempt(i % 10 !== 0, "media", i % 10 === 0 ? "desatencao" : null, i));
    }
    const updates = replayAttempts(INITIAL_STATE, attempts);
    const final = updates[updates.length - 1]!;
    // 36/40 = 90% de acerto com evidência alta
    expect(final.masteryAfter).toBeGreaterThan(0.7);
    expect(final.confidence).toBeGreaterThan(0.95);
  });

  it("P5 — mastery é independente da ordem no limite da evidência alta", () => {
    // Mesmo conjunto (85 acertos / 15 erros), ordens opostas:
    // a ancoragem impede divergência absurda entre os dois extremos.
    const correctFirst: AttemptInput[] = [];
    for (let i = 0; i < 85; i++) correctFirst.push(mkAttempt(true, "media", null, i));
    for (let i = 85; i < 100; i++) correctFirst.push(mkAttempt(false, "media", "desatencao", i));

    const errorsFirst: AttemptInput[] = [];
    for (let i = 0; i < 15; i++) errorsFirst.push(mkAttempt(false, "media", "desatencao", i));
    for (let i = 15; i < 100; i++) errorsFirst.push(mkAttempt(true, "media", null, i));

    const a = replayAttempts(INITIAL_STATE, correctFirst).at(-1)!.masteryAfter;
    const b = replayAttempts(INITIAL_STATE, errorsFirst).at(-1)!.masteryAfter;

    expect(a).toBeGreaterThan(0.6);
    expect(b).toBeGreaterThan(0.6);
    expect(Math.abs(a - b)).toBeLessThan(0.25);
  });

  it("P6 — determinismo: replays idênticos produzem valores idênticos", () => {
    const attempts = Array.from({ length: 30 }, (_, i) =>
      mkAttempt(
        i % 3 !== 0,
        i % 2 === 0 ? "dificil" : "facil",
        i % 3 === 0 ? "desatencao" : null,
        i,
      ),
    );
    const run1 = replayAttempts(INITIAL_STATE, attempts).map((u) => u.masteryAfter);
    const run2 = replayAttempts(INITIAL_STATE, attempts).map((u) => u.masteryAfter);
    expect(run1).toEqual(run2);
  });

  it("P7 — mastery permanece em [0,1] com o alpha limitado", () => {
    const attempts = Array.from({ length: 200 }, (_, i) =>
      mkAttempt(i % 4 !== 0, i % 2 === 0 ? "dificil" : "facil", null, i),
    );
    for (const u of replayAttempts(INITIAL_STATE, attempts)) {
      expect(u.masteryAfter).toBeGreaterThanOrEqual(0);
      expect(u.masteryAfter).toBeLessThanOrEqual(1);
      expect(Number.isFinite(u.masteryAfter)).toBe(true);
    }
  });
});
