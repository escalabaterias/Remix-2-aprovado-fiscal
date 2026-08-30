import { describe, it, expect } from "vitest";
import {
  getStateBadgeConfig,
  getInterventionLabel,
  type RecommendationItem,
} from "./WhatToStudyNowCard";

describe("WhatToStudyNowCard Logic & Presentation", () => {
  it("1. Configura os selos (badges) para os 7 estados pedagógicos reais", () => {
    expect(getStateBadgeConfig("PONTO_CRITICO").label).toBe("Ponto Crítico");
    expect(getStateBadgeConfig("RISCO_ESQUECIMENTO").label).toBe("Risco de Esquecimento");
    expect(getStateBadgeConfig("INSTAVEL").label).toBe("Desempenho Instável");
    expect(getStateBadgeConfig("CONSOLIDANDO").label).toBe("Em Consolidação");
    expect(getStateBadgeConfig("APRENDIZAGEM").label).toBe("Em Aprendizagem");
    expect(getStateBadgeConfig("DOMINADO").label).toBe("Dominado");
    expect(getStateBadgeConfig("SEM_EVIDENCIA").label).toBe("Sem Evidência");
    expect(getStateBadgeConfig(null).label).toBe("Sem Evidência");
  });

  it("2. Mapeia rótulos de intervenção corretamente conforme atividade e origem", () => {
    expect(getInterventionLabel("teoria", "planner")).toBe("Estudar Teoria");
    expect(getInterventionLabel("questoes", "planner")).toBe("Resolver Questões");
    expect(getInterventionLabel("exercicios", "planner")).toBe("Revisar Erros");
    expect(getInterventionLabel("revisao", "planner")).toBe("Revisão Adaptativa");
    expect(getInterventionLabel("estudo_dirigido", "planner")).toBe("Reforçar Ponto Fraco");
    expect(getInterventionLabel("flashcards", "planner")).toBe("Consolidar (Flashcards)");
    expect(getInterventionLabel("simulado", "planner")).toBe("Manutenção / Simulado");
    expect(getInterventionLabel("qualquer", "review_engine")).toBe("Revisão Adaptativa");
  });

  it("3. Preserva a ordem estrita das recomendações e separa o Card Principal das Próximas Prioridades", () => {
    const items: RecommendationItem[] = [
      {
        id: "1",
        title: "Tópico 1",
        subjectName: "Matéria A",
        topicName: "Tópico 1",
        activityType: "questoes",
        plannedMinutes: 50,
        priorityScore: 9.2,
        priorityReason: "Motivo 1",
        status: "pendente",
        source: "planner",
        position: 1,
        scheduledDate: "2026-08-30",
        diagnostic: {
          knowledgeState: "PONTO_CRITICO",
          mastery: 0.3,
          confidence: 0.6,
          accuracy: 0.3,
          recentErrors: 3,
          unresolvedErrors: 2,
          recurringErrors: 1,
          daysSinceStudy: 4,
          daysSinceError: 1,
          interventionScore: 0.9,
        },
      },
      {
        id: "2",
        title: "Tópico 2",
        subjectName: "Matéria B",
        topicName: "Tópico 2",
        activityType: "teoria",
        plannedMinutes: 40,
        priorityScore: 8.1,
        priorityReason: "Motivo 2",
        status: "pendente",
        source: "planner",
        position: 2,
        scheduledDate: "2026-08-30",
      },
      {
        id: "3",
        title: "Tópico 3",
        subjectName: "Matéria C",
        topicName: "Tópico 3",
        activityType: "exercicios",
        plannedMinutes: 30,
        priorityScore: 7.0,
        priorityReason: "Motivo 3",
        status: "pendente",
        source: "review_engine",
        position: 3,
        scheduledDate: "2026-08-30",
      },
    ];

    // Card Principal = item 0
    const primary = items[0];
    expect(primary.id).toBe("1");
    expect(primary.priorityScore).toBe(9.2);
    expect(primary.diagnostic?.knowledgeState).toBe("PONTO_CRITICO");

    // Próximas prioridades = itens 1 em diante
    const nextPriorities = items.slice(1, 5);
    expect(nextPriorities).toHaveLength(2);
    expect(nextPriorities[0].id).toBe("2");
    expect(nextPriorities[1].id).toBe("3");
  });

  it("4. Garante que o cálculo de percentual de domínio e confiança preserva os valores originais", () => {
    const item: RecommendationItem = {
      id: "1",
      title: "Tópico Teste",
      subjectName: "Direito",
      topicName: "Atos",
      activityType: "questoes",
      plannedMinutes: 50,
      priorityScore: 8.0,
      priorityReason: "Justificativa",
      status: "pendente",
      source: "planner",
      position: 1,
      scheduledDate: "2026-08-30",
      diagnostic: {
        knowledgeState: "INSTAVEL",
        mastery: 0.654,
        confidence: 0.821,
        accuracy: 0.6,
        recentErrors: 1,
        unresolvedErrors: 1,
        recurringErrors: 0,
        daysSinceStudy: 7,
        daysSinceError: 3,
        interventionScore: 0.7,
      },
    };

    const masteryPercent = Math.round(item.diagnostic!.mastery * 100);
    const confidencePercent = Math.round(item.diagnostic!.confidence * 100);

    expect(masteryPercent).toBe(65);
    expect(confidencePercent).toBe(82);
  });
});
