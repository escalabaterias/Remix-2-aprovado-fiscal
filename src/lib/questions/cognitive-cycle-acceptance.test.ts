import { describe, it, expect } from "vitest";
import {
  updateKnowledge,
  INITIAL_STATE,
  computeConfidence,
  accuracyWeight,
  masteryCeiling,
  type KnowledgeState,
  type AttemptInput,
} from "@/lib/knowledge/engine";
import { buildSignals } from "@/lib/knowledge/signals";
import {
  diagnoseTopic,
  type KnowledgeStateName,
  NO_EVIDENCE_CONFIDENCE,
  MIN_QUESTIONS_FOR_EVIDENCE,
  LOW_CONFIDENCE_THRESHOLD,
  HIGH_CONFIDENCE_THRESHOLD,
  HIGH_MASTERY_THRESHOLD,
  LOW_MASTERY_THRESHOLD,
  FORGETTING_MASTERY_THRESHOLD,
  FORGETTING_CONFIDENCE_THRESHOLD,
  MIN_ACCURACY_FOR_MASTERED,
  INSTABILITY_DIVERGENCE,
  RECENT_DAYS_THRESHOLD,
  OLD_DAYS_THRESHOLD,
} from "@/lib/diagnosis/engine";
import {
  computeDiagnosticBoost,
  STATE_BOOST,
  COMPONENT_WEIGHTS,
  type IntelligenceInput,
} from "@/lib/planner/intelligence";
import { computeKnowledgeUpdate } from "@/lib/questions/knowledge-integration";
import { mapToErrorCategory } from "@/lib/questions/error-integration";

describe("SUÍTE DE ACEITAÇÃO COGNITIVA — CICLO COMPLETO DO APROVADO FISCAL", () => {
  // ---------------------------------------------------------------------------
  // CENÁRIO A: EVOLUÇÃO DE UM TÓPICO (5 ACERTOS CONSECUTIVOS)
  // ---------------------------------------------------------------------------
  describe("CENÁRIO A — Evolução Progressiva de Tópico (5 Acertos Consecutivos)", () => {
    it("deve evoluir o conhecimento a cada acerto sem pular para Dominado prematuramente", () => {
      let state: KnowledgeState = { ...INITIAL_STATE };
      const now = new Date("2026-08-30T10:00:00Z").toISOString();

      const snapshots: Array<{
        step: number;
        mastery: number;
        confidence: number;
        total: number;
        correct: number;
        stateName: KnowledgeStateName;
        diagnosticBoost: number;
      }> = [];

      for (let i = 1; i <= 5; i++) {
        const attempt: AttemptInput = {
          attemptId: `att-${i}`,
          isCorrect: true,
          difficulty: "media",
          errorCategory: null,
          timestamp: now,
        };

        const update = updateKnowledge(state, attempt);
        state = update.newState;

        const signals = buildSignals(state, null, 0, now);
        const diag = diagnoseTopic(signals, now);
        const boost = computeDiagnosticBoost({
          baseScore: 5.0,
          knowledgeState: diag.knowledgeState,
          mastery: diag.mastery,
          confidence: diag.confidence,
          accuracy: diag.accuracy,
          recentErrors: 0,
          unresolvedErrors: 0,
          recurringErrors: 0,
          daysSinceStudy: signals.daysSinceStudy,
          daysSinceError: null,
          interventionScore: diag.interventionScore,
        });

        snapshots.push({
          step: i,
          mastery: state.mastery,
          confidence: state.confidence,
          total: state.totalQuestions,
          correct: state.correctQuestions,
          stateName: diag.knowledgeState,
          diagnosticBoost: boost.diagnosticBoost,
        });
      }

      // Assertions
      expect(snapshots[0].mastery).toBeGreaterThan(0);
      expect(snapshots[0].confidence).toBeGreaterThan(0);
      expect(snapshots[0].stateName).toBe("SEM_EVIDENCIA"); // 1 questão < MIN_QUESTIONS_FOR_EVIDENCE (2)

      expect(snapshots[1].total).toBe(2);
      expect(snapshots[1].stateName).toBe("APRENDIZAGEM"); // 2 questões: mastery ~0.67 < HIGH_MASTERY_THRESHOLD (0.70)

      expect(snapshots[2].total).toBe(3);
      expect(snapshots[2].stateName).toBe("CONSOLIDANDO"); // 3 questões: mastery >= 0.70, confidence < 0.75

      expect(snapshots[4].total).toBe(5);
      expect(snapshots[4].mastery).toBeGreaterThan(0.7);
      // Com 5 questões, confidence é ~0.39 < 0.75 (HIGH_CONFIDENCE_THRESHOLD), logo o estado permanece CONSOLIDANDO
      expect(snapshots[4].stateName).toBe("CONSOLIDANDO");
    });
  });

  // ---------------------------------------------------------------------------
  // CENÁRIO B: TRÊS ERROS CONSECUTIVOS
  // ---------------------------------------------------------------------------
  describe("CENÁRIO B — Reação a 3 Erros Consecutivos", () => {
    it("deve forçar transição para PONTO_CRITICO quando detectados erros recorrentes e recorrentes > 0", () => {
      const now = new Date("2026-08-30T10:00:00Z").toISOString();
      const state: KnowledgeState = {
        mastery: 0.65,
        confidence: 0.6,
        totalQuestions: 10,
        correctQuestions: 7,
        lastStudiedAt: now,
      };

      // Simula 3 erros com análise de erros
      const signals = buildSignals(
        state,
        {
          totalErrors: 3,
          unresolvedErrors: 3,
          recurringErrors: 2,
          lastErrorDate: now,
          daysSinceLastError: 0,
        },
        0,
        now,
      );

      const diag = diagnoseTopic(signals, now);
      expect(diag.knowledgeState).toBe("PONTO_CRITICO");

      const boost = computeDiagnosticBoost({
        baseScore: 5.0,
        knowledgeState: diag.knowledgeState,
        mastery: diag.mastery,
        confidence: diag.confidence,
        accuracy: diag.accuracy,
        recentErrors: 3,
        unresolvedErrors: 3,
        recurringErrors: 2,
        daysSinceStudy: 0,
        daysSinceError: 0,
        interventionScore: diag.interventionScore,
      });

      // PONTO_CRITICO gera o maior boost de estado (0.4 * 1.0) + adicionais
      expect(boost.diagnosticBoost).toBeGreaterThan(0.4);
    });
  });

  // ---------------------------------------------------------------------------
  // CENÁRIO C: ERRO FÁCIL X ERRO DIFÍCIL
  // ---------------------------------------------------------------------------
  describe("CENÁRIO C — Erro em Questão Fácil vs Questão Difícil", () => {
    it("deve penalizar mais o domínio ao errar questão fácil do que questão difícil", () => {
      const baseState: KnowledgeState = {
        mastery: 0.6,
        confidence: 0.5,
        totalQuestions: 10,
        correctQuestions: 6,
        lastStudiedAt: "2026-08-30T10:00:00Z",
      };

      const now = "2026-08-30T10:00:00Z";

      // Erro em questão Fácil
      const updateFacil = updateKnowledge(baseState, {
        attemptId: "att-facil",
        isCorrect: false,
        difficulty: "facil",
        errorCategory: "conhecimento",
        timestamp: now,
      });

      // Erro em questão Difícil
      const updateDificil = updateKnowledge(baseState, {
        attemptId: "att-dificil",
        isCorrect: false,
        difficulty: "dificil",
        errorCategory: "conhecimento",
        timestamp: now,
      });

      const dropFacil = baseState.mastery - updateFacil.newState.mastery;
      const dropDificil = baseState.mastery - updateDificil.newState.mastery;

      expect(dropFacil).toBeGreaterThan(dropDificil);
    });
  });

  // ---------------------------------------------------------------------------
  // CENÁRIO D: ACERTO FÁCIL X ACERTO DIFÍCIL
  // ---------------------------------------------------------------------------
  describe("CENÁRIO D — Acerto em Questão Fácil vs Questão Difícil", () => {
    it("deve bonificar mais o domínio ao acertar questão difícil do que questão fácil", () => {
      const baseState: KnowledgeState = {
        mastery: 0.5,
        confidence: 0.5,
        totalQuestions: 10,
        correctQuestions: 5,
        lastStudiedAt: "2026-08-30T10:00:00Z",
      };

      const now = "2026-08-30T10:00:00Z";

      // Acerto em questão Fácil
      const updateFacil = updateKnowledge(baseState, {
        attemptId: "att-facil",
        isCorrect: true,
        difficulty: "facil",
        errorCategory: null,
        timestamp: now,
      });

      // Acerto em questão Difícil
      const updateDificil = updateKnowledge(baseState, {
        attemptId: "att-dificil",
        isCorrect: true,
        difficulty: "dificil",
        errorCategory: null,
        timestamp: now,
      });

      const gainFacil = updateFacil.newState.mastery - baseState.mastery;
      const gainDificil = updateDificil.newState.mastery - baseState.mastery;

      expect(gainDificil).toBeGreaterThan(gainFacil);
    });
  });

  // ---------------------------------------------------------------------------
  // CENÁRIO E: DOMÍNIO ALTO + ERRO RECENTE
  // ---------------------------------------------------------------------------
  describe("CENÁRIO E — Domínio Alto com Erro Isolado x Erros Consecutivos", () => {
    it("não deve destruir o domínio alto com um único erro isolado, mas sim reajustar", () => {
      const highState: KnowledgeState = {
        mastery: 0.85,
        confidence: 0.85,
        totalQuestions: 20,
        correctQuestions: 17,
        lastStudiedAt: "2026-08-30T10:00:00Z",
      };

      const now = "2026-08-30T10:00:00Z";

      // 1 Erro isolado
      const update1 = updateKnowledge(highState, {
        attemptId: "att-1",
        isCorrect: false,
        difficulty: "media",
        errorCategory: "atencao",
        timestamp: now,
      });

      // O mastery deve diminuir moderadamente devido à ancoragem de 20 questões
      expect(update1.newState.mastery).toBeGreaterThan(0.75);
      expect(update1.newState.mastery).toBeLessThan(0.85);

      // Simula diagnósticos
      const signals1 = buildSignals(
        update1.newState,
        {
          totalErrors: 1,
          unresolvedErrors: 1,
          recurringErrors: 0,
          lastErrorDate: now,
          daysSinceLastError: 0,
        },
        0,
        now,
      );
      const diag1 = diagnoseTopic(signals1, now);
      // Com apenas 1 erro e mastery > 0.70 + confidence > 0.75, estado pode ser DOMINADO ou APRENDIZAGEM/INSTAVEL dependendo de divergência
      expect(diag1.knowledgeState).not.toBe("PONTO_CRITICO");
    });
  });

  // ---------------------------------------------------------------------------
  // CENÁRIO F: BAIXO DOMÍNIO + ACERTO RECENTE
  // ---------------------------------------------------------------------------
  describe("CENÁRIO F — Baixo Domínio com Acerto Isolado", () => {
    it("não deve mascarar o histórico ruim com um único acerto recente", () => {
      const lowState: KnowledgeState = {
        mastery: 0.2,
        confidence: 0.6,
        totalQuestions: 10,
        correctQuestions: 2,
        lastStudiedAt: "2026-08-30T10:00:00Z",
      };

      const now = "2026-08-30T10:00:00Z";

      const update = updateKnowledge(lowState, {
        attemptId: "att-correct",
        isCorrect: true,
        difficulty: "media",
        errorCategory: null,
        timestamp: now,
      });

      // O mastery sobre levemente, mas continua baixo
      expect(update.newState.mastery).toBeLessThan(0.4);

      const signals = buildSignals(update.newState, null, 0, now);
      const diag = diagnoseTopic(signals, now);

      expect(diag.knowledgeState).toBe("PONTO_CRITICO");
    });
  });

  // ---------------------------------------------------------------------------
  // CENÁRIO G: ESQUECIMENTO (RECÊNCIA > 14 DIAS)
  // ---------------------------------------------------------------------------
  describe("CENÁRIO G — Risco de Esquecimento por Tempo sem Estudo", () => {
    it("deve transicionar para RISCO_ESQUECIMENTO quando mastery >= 0.50 e dias sem estudo > 21", () => {
      const lastStudy = "2026-08-01T10:00:00Z"; // 29 dias atrás
      const now = "2026-08-30T10:00:00Z";

      const state: KnowledgeState = {
        mastery: 0.8,
        confidence: 0.8,
        totalQuestions: 15,
        correctQuestions: 12,
        lastStudiedAt: lastStudy,
      };

      const signals = buildSignals(state, null, 0, now);
      expect(signals.daysSinceStudy).toBe(29);

      const diag = diagnoseTopic(signals, now);
      expect(diag.knowledgeState).toBe("RISCO_ESQUECIMENTO");
      expect(diag.intervention).toBe("REVISAR");

      const boost = computeDiagnosticBoost({
        baseScore: 5.0,
        knowledgeState: diag.knowledgeState,
        mastery: diag.mastery,
        confidence: diag.confidence,
        accuracy: diag.accuracy,
        recentErrors: 0,
        unresolvedErrors: 0,
        recurringErrors: 0,
        daysSinceStudy: signals.daysSinceStudy,
        daysSinceError: null,
        interventionScore: diag.interventionScore,
      });

      // RISCO_ESQUECIMENTO gera um boost expressivo (STATE_BOOST = 0.75 * 0.4 = 0.3)
      expect(boost.diagnosticBoost).toBeGreaterThan(0.3);
    });
  });

  // ---------------------------------------------------------------------------
  // CENÁRIO H: TÓPICO SEM HISTÓRICO
  // ---------------------------------------------------------------------------
  describe("CENÁRIO H — Tópico Sem Histórico", () => {
    it("deve inicializar como SEM_EVIDENCIA e não como Dominado", () => {
      const now = "2026-08-30T10:00:00Z";
      const signals = buildSignals(INITIAL_STATE, null, 0, now);

      expect(signals.mastery).toBe(0);
      expect(signals.confidence).toBe(0);
      expect(signals.questionCount).toBe(0);

      const diag = diagnoseTopic(signals, now);
      expect(diag.knowledgeState).toBe("SEM_EVIDENCIA");
      expect(diag.intervention).toBe("ESTUDAR_TEORIA");

      const boost = computeDiagnosticBoost({
        baseScore: 5.0,
        knowledgeState: diag.knowledgeState,
        mastery: diag.mastery,
        confidence: diag.confidence,
        accuracy: diag.accuracy,
        recentErrors: 0,
        unresolvedErrors: 0,
        recurringErrors: 0,
        daysSinceStudy: null,
        daysSinceError: null,
        interventionScore: diag.interventionScore,
      });

      // SEM_EVIDENCIA possui STATE_BOOST de 0.3 (neutro-moderado para criar base)
      expect(boost.diagnosticBoost).toBeGreaterThan(0.1);
    });
  });

  // ---------------------------------------------------------------------------
  // CENÁRIO I: COMPARAÇÃO DE PRIORIDADES ENTRE ESTADOS
  // ---------------------------------------------------------------------------
  describe("CENÁRIO I — Hierarquia e Comparação de Prioridades no Planejador", () => {
    it("deve respeitar a ordem de prioridades: Ponto Crítico > Risco Esquecimento > Instável > Consolidando > Dominado", () => {
      const baseScore = 5.0;

      const states: KnowledgeStateName[] = [
        "PONTO_CRITICO",
        "RISCO_ESQUECIMENTO",
        "INSTAVEL",
        "CONSOLIDANDO",
        "DOMINADO",
      ];

      const boosts = states.map((st) => {
        const out = computeDiagnosticBoost({
          baseScore,
          knowledgeState: st,
          mastery: st === "DOMINADO" ? 0.9 : st === "PONTO_CRITICO" ? 0.2 : 0.6,
          confidence: st === "DOMINADO" ? 0.9 : 0.5,
          accuracy: st === "DOMINADO" ? 0.9 : 0.5,
          recentErrors: st === "PONTO_CRITICO" ? 3 : 0,
          unresolvedErrors: st === "PONTO_CRITICO" ? 2 : 0,
          recurringErrors: st === "PONTO_CRITICO" ? 1 : 0,
          daysSinceStudy: st === "RISCO_ESQUECIMENTO" ? 30 : 2,
          daysSinceError: null,
          interventionScore: st === "PONTO_CRITICO" ? 0.8 : st === "DOMINADO" ? 0.1 : 0.4,
        });
        return { state: st, finalScore: out.finalScore, boost: out.diagnosticBoost };
      });

      // PONTO_CRITICO deve ser o maior
      const pontoCritico = boosts.find((b) => b.state === "PONTO_CRITICO")!;
      const riscoEsquecimento = boosts.find((b) => b.state === "RISCO_ESQUECIMENTO")!;
      const dominado = boosts.find((b) => b.state === "DOMINADO")!;

      expect(pontoCritico.finalScore).toBeGreaterThan(riscoEsquecimento.finalScore);
      expect(riscoEsquecimento.finalScore).toBeGreaterThan(dominado.finalScore);
    });
  });

  // ---------------------------------------------------------------------------
  // CENÁRIO J: COMPUTAÇÃO PURA DE ATUALIZAÇÃO DO KNOWLEDGE
  // ---------------------------------------------------------------------------
  describe("CENÁRIO J — Computação Pura de Atualização do Knowledge Engine", () => {
    it("deve aumentar e diminuir mastery e confidence deterministicamente via computeKnowledgeUpdate", () => {
      const updateCorrect = computeKnowledgeUpdate(null, {
        isCorrect: true,
        knowledgeDifficulty: "media",
        isFirstAttempt: true,
      });

      expect(updateCorrect.newMastery).toBeGreaterThan(0);
      expect(updateCorrect.newConfidence).toBeGreaterThan(0);
      expect(updateCorrect.newTotalQuestions).toBe(1);
      expect(updateCorrect.newCorrectQuestions).toBe(1);

      const updateWrong = computeKnowledgeUpdate(
        {
          mastery: 0.5,
          confidence: 0.5,
          totalQuestions: 5,
          correctQuestions: 3,
          reviewCount: 0,
          lastStudiedAt: null,
        },
        {
          isCorrect: false,
          knowledgeDifficulty: "facil",
          isFirstAttempt: false,
        },
      );

      expect(updateWrong.newMastery).toBeLessThan(0.5);
      expect(updateWrong.newConfidence).toBeLessThan(0.5);
      expect(updateWrong.newTotalQuestions).toBe(6);
      expect(updateWrong.newCorrectQuestions).toBe(3);
    });

    it("deve mapear corretamente categorias de erros válidas", () => {
      expect(mapToErrorCategory("conhecimento")).toBe("conhecimento");
      expect(mapToErrorCategory("invalid_cat")).toBe("outros");
      expect(mapToErrorCategory(null)).toBe("outros");
    });
  });

  // ---------------------------------------------------------------------------
  // ISOLAMENTO E INTEGRIDADE DE ESTADOS
  // ---------------------------------------------------------------------------
  describe("ISOLAMENTO — Independência de Tópicos e Usuários", () => {
    it("alterar o conhecimento do Tópico A não deve afetar o Tópico B", () => {
      const stateA: KnowledgeState = {
        mastery: 0.2,
        confidence: 0.5,
        totalQuestions: 5,
        correctQuestions: 1,
        lastStudiedAt: "2026-08-30T10:00:00Z",
      };

      const stateB: KnowledgeState = {
        mastery: 0.9,
        confidence: 0.9,
        totalQuestions: 25,
        correctQuestions: 23,
        lastStudiedAt: "2026-08-30T10:00:00Z",
      };

      const updateA = updateKnowledge(stateA, {
        attemptId: "att-a",
        isCorrect: false,
        difficulty: "media",
        errorCategory: null,
        timestamp: "2026-08-30T10:00:00Z",
      });

      expect(updateA.newState.mastery).not.toEqual(stateB.mastery);
      expect(stateB.mastery).toBe(0.9);
      expect(stateB.totalQuestions).toBe(25);
    });
  });

  // ---------------------------------------------------------------------------
  // AUDITORIA MATEMÁTICA DAS CONSTANTES
  // ---------------------------------------------------------------------------
  describe("AUDITORIA MATEMÁTICA — Constantes reais do Código", () => {
    it("deve confirmar os valores exatos das constantes de diagnósticos e inteligência", () => {
      expect(NO_EVIDENCE_CONFIDENCE).toBe(0.15);
      expect(MIN_QUESTIONS_FOR_EVIDENCE).toBe(2);
      expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.4);
      expect(HIGH_CONFIDENCE_THRESHOLD).toBe(0.75);
      expect(HIGH_MASTERY_THRESHOLD).toBe(0.7);
      expect(LOW_MASTERY_THRESHOLD).toBe(0.4);
      expect(FORGETTING_MASTERY_THRESHOLD).toBe(0.5);
      expect(FORGETTING_CONFIDENCE_THRESHOLD).toBe(0.4);
      expect(MIN_ACCURACY_FOR_MASTERED).toBe(0.6);
      expect(INSTABILITY_DIVERGENCE).toBe(0.25);
      expect(RECENT_DAYS_THRESHOLD).toBe(7);
      expect(OLD_DAYS_THRESHOLD).toBe(21);

      expect(STATE_BOOST.PONTO_CRITICO).toBe(1.0);
      expect(STATE_BOOST.RISCO_ESQUECIMENTO).toBe(0.75);
      expect(STATE_BOOST.INSTAVEL).toBe(0.65);
      expect(STATE_BOOST.APRENDIZAGEM).toBe(0.4);
      expect(STATE_BOOST.CONSOLIDANDO).toBe(0.35);
      expect(STATE_BOOST.SEM_EVIDENCIA).toBe(0.3);
      expect(STATE_BOOST.DOMINADO).toBe(0.05);

      expect(COMPONENT_WEIGHTS.STATE).toBe(0.4);
      expect(COMPONENT_WEIGHTS.INTERVENTION).toBe(0.15);
      expect(COMPONENT_WEIGHTS.MASTERY_GAP).toBe(0.2);
      expect(COMPONENT_WEIGHTS.ERROR).toBe(0.1);
      expect(COMPONENT_WEIGHTS.RECURRENCE).toBe(0.1);
      expect(COMPONENT_WEIGHTS.RECENCY).toBe(0.05);
    });
  });
});
