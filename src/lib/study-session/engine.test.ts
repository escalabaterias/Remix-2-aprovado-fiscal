/**
 * TESTES DO MOTOR DE SESSÃO DE ESTUDO — Fase 1
 * Motor puro: sem banco, sem mocks de rede.
 */

import { describe, expect, it } from "vitest";

import { buildSession, DEFAULT_SESSION_CONFIG } from "./engine";
import type { SessionTaskInput, SessionConfig } from "./types";

// ── Fixtures ────────────────────────────────────────────────────────────────

function task(
  id: string,
  score: number,
  overrides: Partial<SessionTaskInput> = {},
): SessionTaskInput {
  return {
    taskId: `task-${id}`,
    topicId: `topic-${id}`,
    subjectId: "s1",
    subjectName: "Matéria S1",
    topicName: `Tópico ${id}`,
    activity: "teoria",
    source: "planner",
    plannedMinutes: 50,
    priorityScore: score,
    priorityReason: "Estudo novo.",
    reviewUrgency: null,
    reviewType: null,
    reviewIntensity: null,
    ...overrides,
  };
}

function reviewTask(
  id: string,
  urgency: number,
  overrides: Partial<SessionTaskInput> = {},
): SessionTaskInput {
  return task(id, 5, {
    source: "review_engine",
    activity: "revisao",
    reviewUrgency: urgency,
    reviewType: "manutencao",
    reviewIntensity: "moderada",
    plannedMinutes: 35,
    ...overrides,
  });
}

function cfg(overrides: Partial<SessionConfig> = {}): Partial<SessionConfig> {
  return { ...overrides };
}

// ── Testes: casos básicos ──────────────────────────────────────────────────

describe("buildSession — casos básicos", () => {
  it("1. zero tarefas retorna sessão vazia", () => {
    const r = buildSession([], cfg({ availableMinutes: 120 }));
    expect(r.activities).toEqual([]);
    expect(r.allocatedMinutes).toBe(0);
    expect(r.unallocatedMinutes).toBe(120);
    expect(r.discardedTasks).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("2. uma tarefa cabe inteira na sessão", () => {
    const r = buildSession([task("a", 7)], cfg({ availableMinutes: 120 }));
    expect(r.activities).toHaveLength(1);
    expect(r.activities[0]!.allocatedMinutes).toBe(50);
    expect(r.activities[0]!.position).toBe(0);
    expect(r.allocatedMinutes).toBe(50);
    expect(r.unallocatedMinutes).toBe(70);
  });

  it("3. múltiplas tarefas alocadas em ordem de prioridade", () => {
    const tasks = [task("a", 3), task("b", 8), task("c", 5)];
    const r = buildSession(
      tasks,
      cfg({ availableMinutes: 200, interleaveSubjects: false, maxSubjectShare: 1 }),
    );
    expect(r.activities).toHaveLength(3);
    expect(r.activities[0]!.taskId).toBe("task-b");
    expect(r.activities[1]!.taskId).toBe("task-c");
    expect(r.activities[2]!.taskId).toBe("task-a");
  });

  it("4. tarefa parcial quando tempo restante é menor que o planejado", () => {
    const r = buildSession(
      [task("a", 7, { plannedMinutes: 50 }), task("b", 5, { plannedMinutes: 50 })],
      cfg({ availableMinutes: 80, interleaveSubjects: false, maxSubjectShare: 1 }),
    );
    expect(r.activities).toHaveLength(2);
    expect(r.activities[0]!.allocatedMinutes).toBe(50);
    expect(r.activities[1]!.allocatedMinutes).toBe(30);
    expect(r.allocatedMinutes).toBe(80);
    expect(r.unallocatedMinutes).toBe(0);
  });

  it("5. descarta tarefa se tempo restante é menor que minActivityMinutes", () => {
    const r = buildSession(
      [task("a", 7, { plannedMinutes: 50 }), task("b", 5, { plannedMinutes: 50 })],
      cfg({
        availableMinutes: 55,
        minActivityMinutes: 10,
        interleaveSubjects: false,
        maxSubjectShare: 1,
      }),
    );
    expect(r.activities).toHaveLength(1);
    expect(r.discardedTasks).toHaveLength(1);
    expect(r.discardedTasks[0]!.taskId).toBe("task-b");
  });
});

// ── Testes: disponibilidade zero ou inválida ───────────────────────────────

describe("buildSession — disponibilidade zero/inválida", () => {
  it("6. disponibilidade zero descarta tudo", () => {
    const r = buildSession([task("a", 7)], cfg({ availableMinutes: 0 }));
    expect(r.activities).toEqual([]);
    expect(r.discardedTasks).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
  });

  it("7. disponibilidade negativa trata como zero", () => {
    const r = buildSession([task("a", 7)], cfg({ availableMinutes: -30 }));
    expect(r.activities).toEqual([]);
    expect(r.discardedTasks).toHaveLength(1);
  });

  it("8. NaN/Infinity em availableMinutes trata como zero", () => {
    const r1 = buildSession([task("a", 7)], cfg({ availableMinutes: NaN }));
    expect(r1.activities).toEqual([]);
    const r2 = buildSession([task("a", 7)], cfg({ availableMinutes: Infinity }));
    // Infinity → safeNumber trata como Infinity que é finito? Não.
    // safeNumber retorna fallback quando não-finito.
    expect(r2.activities).toEqual([]);
  });
});

// ── Testes: tarefas inválidas ──────────────────────────────────────────────

describe("buildSession — tarefas inválidas", () => {
  it("9. tarefa sem taskId é descartada", () => {
    const t = task("a", 7);
    (t as any).taskId = "";
    const r = buildSession([t], cfg({ availableMinutes: 120 }));
    expect(r.activities).toEqual([]);
    expect(r.discardedTasks).toHaveLength(1);
  });

  it("10. tarefa sem topicId é descartada", () => {
    const t = task("a", 7);
    (t as any).topicId = "";
    const r = buildSession([t], cfg({ availableMinutes: 120 }));
    expect(r.activities).toEqual([]);
    expect(r.discardedTasks).toHaveLength(1);
  });

  it("11. tarefa com plannedMinutes < minActivityMinutes é descartada", () => {
    const r = buildSession(
      [task("a", 7, { plannedMinutes: 5 })],
      cfg({ availableMinutes: 120, minActivityMinutes: 10 }),
    );
    expect(r.activities).toEqual([]);
    expect(r.discardedTasks).toHaveLength(1);
  });

  it("12. NaN em priorityScore não quebra, usa fallback 0", () => {
    const r = buildSession(
      [task("a", NaN), task("b", 5)],
      cfg({ availableMinutes: 120, interleaveSubjects: false }),
    );
    expect(r.activities).toHaveLength(2);
    // b (score 5) vem antes de a (score 0 fallback)
    expect(r.activities[0]!.taskId).toBe("task-b");
    expect(r.activities[0]!.priorityScore).toBe(5);
    expect(r.activities[1]!.priorityScore).toBe(0);
  });
});

// ── Testes: ordering strategies ────────────────────────────────────────────

describe("buildSession — ordering strategies", () => {
  it("13. review_first: revisões vêm antes de estudo novo", () => {
    const tasks = [task("study", 9), reviewTask("rev", 0.5, { priorityScore: 4 })];
    const r = buildSession(
      tasks,
      cfg({
        availableMinutes: 200,
        ordering: "review_first",
        interleaveSubjects: false,
        maxSubjectShare: 1,
      }),
    );
    expect(r.activities[0]!.taskId).toBe("task-rev");
    expect(r.activities[1]!.taskId).toBe("task-study");
  });

  it("14. study_first: estudo novo vem antes de revisões", () => {
    const tasks = [reviewTask("rev", 0.9, { priorityScore: 9 }), task("study", 3)];
    const r = buildSession(
      tasks,
      cfg({
        availableMinutes: 200,
        ordering: "study_first",
        interleaveSubjects: false,
        maxSubjectShare: 1,
      }),
    );
    expect(r.activities[0]!.taskId).toBe("task-study");
    expect(r.activities[1]!.taskId).toBe("task-rev");
  });

  it("15. priority: mistura revisão e estudo por score puro", () => {
    const tasks = [task("study", 9), reviewTask("rev", 0.9, { priorityScore: 3 })];
    const r = buildSession(
      tasks,
      cfg({
        availableMinutes: 200,
        ordering: "priority",
        interleaveSubjects: false,
        maxSubjectShare: 1,
      }),
    );
    expect(r.activities[0]!.taskId).toBe("task-study"); // score 9 > 3
    expect(r.activities[1]!.taskId).toBe("task-rev");
  });

  it("16. review_first: revisão urgente (>=0.8) vem antes de revisão normal", () => {
    const tasks = [
      reviewTask("normal", 0.3, { priorityScore: 8 }),
      reviewTask("urgent", 0.9, { priorityScore: 4 }),
    ];
    const r = buildSession(
      tasks,
      cfg({
        availableMinutes: 200,
        ordering: "review_first",
        interleaveSubjects: false,
        maxSubjectShare: 1,
      }),
    );
    expect(r.activities[0]!.taskId).toBe("task-urgent");
    expect(r.activities[1]!.taskId).toBe("task-normal");
  });
});

// ── Testes: teto por matéria ───────────────────────────────────────────────

describe("buildSession — teto por matéria", () => {
  it("17. maxSubjectShare limita uma matéria dominante", () => {
    const tasks = [
      task("a1", 9, { subjectId: "s1", subjectName: "S1", plannedMinutes: 60 }),
      task("a2", 8, { subjectId: "s1", subjectName: "S1", plannedMinutes: 60 }),
      task("b1", 7, { subjectId: "s2", subjectName: "S2", plannedMinutes: 60 }),
    ];
    const r = buildSession(
      tasks,
      cfg({
        availableMinutes: 200,
        maxSubjectShare: 0.5,
        interleaveSubjects: false,
      }),
    );
    const s1Minutes = r.activities
      .filter((a) => a.subjectId === "s1")
      .reduce((sum, a) => sum + a.allocatedMinutes, 0);
    expect(s1Minutes).toBeLessThanOrEqual(200 * 0.5);
  });

  it("18. maxSubjectShare=1 permite qualquer distribuição", () => {
    const tasks = [
      task("a1", 9, { subjectId: "s1", plannedMinutes: 50 }),
      task("a2", 8, { subjectId: "s1", plannedMinutes: 50 }),
      task("a3", 7, { subjectId: "s1", plannedMinutes: 50 }),
    ];
    const r = buildSession(
      tasks,
      cfg({
        availableMinutes: 150,
        maxSubjectShare: 1,
        interleaveSubjects: false,
      }),
    );
    expect(r.activities).toHaveLength(3);
    expect(r.allocatedMinutes).toBe(150);
  });

  it("19. tarefa descartada quando teto da matéria atingido", () => {
    const tasks = [
      task("a1", 9, { subjectId: "s1", subjectName: "S1", plannedMinutes: 50 }),
      task("a2", 8, { subjectId: "s1", subjectName: "S1", plannedMinutes: 50 }),
    ];
    const r = buildSession(
      tasks,
      cfg({
        availableMinutes: 100,
        maxSubjectShare: 0.5,
        interleaveSubjects: false,
      }),
    );
    expect(r.activities).toHaveLength(1);
    expect(r.discardedTasks).toHaveLength(1);
    expect(r.discardedTasks[0]!.reason).toContain("Teto de matéria");
  });
});

// ── Testes: intercalação de matérias ───────────────────────────────────────

describe("buildSession — intercalação de matérias", () => {
  it("20. interleaveSubjects=true alterna matérias diferentes", () => {
    const tasks = [
      task("a1", 9, { subjectId: "s1", subjectName: "S1" }),
      task("a2", 8, { subjectId: "s1", subjectName: "S1" }),
      task("b1", 7, { subjectId: "s2", subjectName: "S2" }),
      task("b2", 6, { subjectId: "s2", subjectName: "S2" }),
    ];
    const r = buildSession(
      tasks,
      cfg({
        availableMinutes: 300,
        maxSubjectShare: 1,
        interleaveSubjects: true,
        ordering: "priority",
      }),
    );
    // Round-robin: s1, s2, s1, s2
    expect(r.activities[0]!.subjectId).toBe("s1");
    expect(r.activities[1]!.subjectId).toBe("s2");
    expect(r.activities[2]!.subjectId).toBe("s1");
    expect(r.activities[3]!.subjectId).toBe("s2");
  });

  it("21. interleaveSubjects=false agrupa por prioridade pura", () => {
    const tasks = [
      task("a1", 9, { subjectId: "s1", subjectName: "S1" }),
      task("a2", 7, { subjectId: "s1", subjectName: "S1" }),
      task("b1", 8, { subjectId: "s2", subjectName: "S2" }),
    ];
    const r = buildSession(
      tasks,
      cfg({
        availableMinutes: 300,
        maxSubjectShare: 1,
        interleaveSubjects: false,
        ordering: "priority",
      }),
    );
    expect(r.activities[0]!.taskId).toBe("task-a1"); // score 9
    expect(r.activities[1]!.taskId).toBe("task-b1"); // score 8
    expect(r.activities[2]!.taskId).toBe("task-a2"); // score 7
  });

  it("22. intercalação com 3 matérias", () => {
    const tasks = [
      task("a1", 9, { subjectId: "s1", subjectName: "S1" }),
      task("b1", 8, { subjectId: "s2", subjectName: "S2" }),
      task("c1", 7, { subjectId: "s3", subjectName: "S3" }),
      task("a2", 6, { subjectId: "s1", subjectName: "S1" }),
      task("b2", 5, { subjectId: "s2", subjectName: "S2" }),
      task("c2", 4, { subjectId: "s3", subjectName: "S3" }),
    ];
    const r = buildSession(
      tasks,
      cfg({
        availableMinutes: 400,
        maxSubjectShare: 1,
        interleaveSubjects: true,
        ordering: "priority",
      }),
    );
    // Round-robin: s1(a1), s2(b1), s3(c1), s1(a2), s2(b2), s3(c2)
    expect(r.activities[0]!.subjectId).toBe("s1");
    expect(r.activities[1]!.subjectId).toBe("s2");
    expect(r.activities[2]!.subjectId).toBe("s3");
    expect(r.activities[3]!.subjectId).toBe("s1");
    expect(r.activities[4]!.subjectId).toBe("s2");
    expect(r.activities[5]!.subjectId).toBe("s3");
  });
});

// ── Testes: preservação de campos da entrada ───────────────────────────────

describe("buildSession — preservação de campos", () => {
  it("23. preserva reviewType, reviewIntensity, reviewUrgency em revisões", () => {
    const r = buildSession(
      [
        reviewTask("rev", 0.75, {
          reviewType: "erro_direcionado",
          reviewIntensity: "intensiva",
          activity: "exercicios",
        }),
      ],
      cfg({ availableMinutes: 120 }),
    );
    const a = r.activities[0]!;
    expect(a.reviewType).toBe("erro_direcionado");
    expect(a.reviewIntensity).toBe("intensiva");
    expect(a.reviewUrgency).toBe(0.75);
    expect(a.activity).toBe("exercicios");
    expect(a.source).toBe("review_engine");
  });

  it("24. estudo novo tem reviewUrgency=null, reviewType=null", () => {
    const r = buildSession([task("study", 7)], cfg({ availableMinutes: 120 }));
    const a = r.activities[0]!;
    expect(a.reviewUrgency).toBeNull();
    expect(a.reviewType).toBeNull();
    expect(a.reviewIntensity).toBeNull();
    expect(a.source).toBe("planner");
  });

  it("25. priorityScore e priorityReason preservados", () => {
    const r = buildSession(
      [task("a", 7.5, { priorityReason: "Muito importante" })],
      cfg({ availableMinutes: 120 }),
    );
    expect(r.activities[0]!.priorityScore).toBe(7.5);
    expect(r.activities[0]!.priorityReason).toBe("Muito importante");
  });
});

// ── Testes: métricas e warnings ────────────────────────────────────────────

describe("buildSession — métricas e warnings", () => {
  it("26. métricas de minutos são coerentes", () => {
    const r = buildSession(
      [task("a", 9, { plannedMinutes: 50 }), task("b", 7, { plannedMinutes: 50 })],
      cfg({ availableMinutes: 80, maxSubjectShare: 1, interleaveSubjects: false }),
    );
    expect(r.allocatedMinutes).toBe(r.activities.reduce((s, a) => s + a.allocatedMinutes, 0));
    expect(r.unallocatedMinutes).toBe(r.availableMinutes - r.allocatedMinutes);
    expect(r.allocatedMinutes + r.unallocatedMinutes).toBe(r.availableMinutes);
  });

  it("27. warning gerado quando tarefas são descartadas", () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      task(`t${i}`, 9 - i, { plannedMinutes: 50 }),
    );
    const r = buildSession(
      tasks,
      cfg({ availableMinutes: 100, maxSubjectShare: 1, interleaveSubjects: false }),
    );
    expect(r.discardedTasks.length).toBeGreaterThan(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("28. sem warning quando tudo cabe", () => {
    const r = buildSession([task("a", 7, { plannedMinutes: 30 })], cfg({ availableMinutes: 120 }));
    expect(r.warnings).toEqual([]);
  });
});

// ── Testes: determinismo ───────────────────────────────────────────────────

describe("buildSession — determinismo", () => {
  it("29. mesmos inputs geram mesma saída", () => {
    const tasks = [
      task("a", 9, { subjectId: "s1" }),
      task("b", 7, { subjectId: "s2" }),
      reviewTask("c", 0.8, { subjectId: "s3" }),
      task("d", 5, { subjectId: "s1" }),
      reviewTask("e", 0.5, { subjectId: "s2" }),
    ];
    const c = cfg({ availableMinutes: 200, maxSubjectShare: 0.5, interleaveSubjects: true });
    const a = buildSession(tasks, c);
    const b = buildSession(tasks, c);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("30. muitas tarefas permanecem determinísticas", () => {
    const tasks = Array.from({ length: 50 }, (_, i) =>
      task(`t${i}`, 9 - i * 0.1, {
        subjectId: `s${i % 5}`,
        subjectName: `Matéria ${i % 5}`,
        plannedMinutes: 30 + (i % 20),
      }),
    );
    const c = cfg({ availableMinutes: 300, maxSubjectShare: 0.4, interleaveSubjects: true });
    const a = buildSession(tasks, c);
    const b = buildSession(tasks, c);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.activities.length).toBeGreaterThan(0);
  });
});

// ── Testes: edge cases ─────────────────────────────────────────────────────

describe("buildSession — edge cases", () => {
  it("31. tarefa com plannedMinutes exatamente igual a minActivityMinutes é aceita", () => {
    const r = buildSession(
      [task("a", 7, { plannedMinutes: 10 })],
      cfg({ availableMinutes: 120, minActivityMinutes: 10 }),
    );
    expect(r.activities).toHaveLength(1);
  });

  it("32. config parcial usa defaults", () => {
    const r = buildSession([task("a", 7)]);
    expect(r.availableMinutes).toBe(DEFAULT_SESSION_CONFIG.availableMinutes);
    expect(r.activities).toHaveLength(1);
  });

  it("33. apenas revisões, sem estudo novo", () => {
    const tasks = [reviewTask("r1", 0.9), reviewTask("r2", 0.5)];
    const r = buildSession(tasks, cfg({ availableMinutes: 120, maxSubjectShare: 1 }));
    expect(r.activities.every((a) => a.source === "review_engine")).toBe(true);
    expect(r.activities).toHaveLength(2);
  });

  it("34. apenas estudo novo, sem revisões", () => {
    const tasks = [task("a", 9), task("b", 7)];
    const r = buildSession(tasks, cfg({ availableMinutes: 120, maxSubjectShare: 1 }));
    expect(r.activities.every((a) => a.source === "planner")).toBe(true);
  });

  it("35. posição (position) é sequencial e 0-based", () => {
    const tasks = [task("a", 9), task("b", 7), task("c", 5)];
    const r = buildSession(
      tasks,
      cfg({
        availableMinutes: 300,
        maxSubjectShare: 1,
        interleaveSubjects: false,
      }),
    );
    r.activities.forEach((a, i) => expect(a.position).toBe(i));
  });

  it("36. mistura de matérias com teto apertado distribui bem", () => {
    const tasks = [
      task("a1", 10, { subjectId: "s1", subjectName: "S1", plannedMinutes: 40 }),
      task("a2", 9, { subjectId: "s1", subjectName: "S1", plannedMinutes: 40 }),
      task("b1", 8, { subjectId: "s2", subjectName: "S2", plannedMinutes: 40 }),
      task("b2", 7, { subjectId: "s2", subjectName: "S2", plannedMinutes: 40 }),
      task("c1", 6, { subjectId: "s3", subjectName: "S3", plannedMinutes: 40 }),
    ];
    const r = buildSession(
      tasks,
      cfg({
        availableMinutes: 120,
        maxSubjectShare: 0.4,
        interleaveSubjects: true,
        ordering: "priority",
      }),
    );
    // Cada matéria pode ter no máximo 48min (0.4 * 120)
    const bySubject = new Map<string, number>();
    for (const a of r.activities) {
      bySubject.set(a.subjectId, (bySubject.get(a.subjectId) ?? 0) + a.allocatedMinutes);
    }
    for (const [, m] of bySubject) {
      expect(m).toBeLessThanOrEqual(120 * 0.4);
    }
    // Pelo menos 2 matérias representadas
    expect(bySubject.size).toBeGreaterThanOrEqual(2);
  });
});
