import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACTIVITY_LABELS } from "@/lib/domain";
import {
  createStudySession,
  startSession,
  completeActivity,
  completeSession,
  getSessionStatus,
  type StudySessionRecord,
  type SessionStatus,
  type SessionActivityRecord,
} from "@/lib/study-session/session-service";
import type { SessionActivity, SessionResult } from "@/lib/study-session/types";

export const Route = createFileRoute("/_authenticated/estudo/")({
  head: () => ({
    meta: [
      { title: "Sessão de Estudo — Aprovado Fiscal" },
      {
        name: "description",
        content:
          "Inicie e execute sessões de estudo baseadas no seu plano, acompanhando o progresso em tempo real.",
      },
      { property: "og:title", content: "Sessão de Estudo — Aprovado Fiscal" },
      {
        property: "og:description",
        content: "Sessão de estudo guiada pelo plano.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EstudoPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatMinutes(min: number): string {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function activityLabel(activity: string): string {
  return ACTIVITY_LABELS[activity as keyof typeof ACTIVITY_LABELS] ?? activity ?? "Estudo";
}

function sourceLabel(source: string): string {
  if (source === "review_engine") return "Revisão";
  if (source === "manual") return "Manual";
  return "Plano";
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

function EstudoPage() {
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
  const [sessionRecord, setSessionRecord] = useState<StudySessionRecord | null>(null);

  // ── Buscar planos ativos ──────────────────────────────────────────────
  const { data: plans, isLoading: loadingPlans } = useQuery({
    queryKey: ["active-plans-for-session"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("study_plans")
        .select("id, name, contest_id, start_date, end_date, is_active, contests(name)")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── Buscar sessão ativa (em andamento, não concluída) ─────────────────
  const { data: existingSession, isLoading: loadingExisting } = useQuery({
    queryKey: ["existing-active-session"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return null;

      const { data, error } = await supabase
        .from("study_sessions")
        .select("id, session_date, started_at, ended_at")
        .eq("user_id", user.user.id)
        .is("ended_at", null)
        .eq("activity", "sessao_estudo")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  // Se encontrou sessão existente não concluída, carrega automaticamente
  useEffect(() => {
    if (existingSession && !activeSessionId) {
      setActiveSessionId(existingSession.id);
    }
  }, [existingSession, activeSessionId]);

  // ── Buscar status da sessão ativa ─────────────────────────────────────
  const { data: sessionStatus, refetch: refetchStatus } = useQuery({
    queryKey: ["session-status", activeSessionId],
    enabled: Boolean(activeSessionId),
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!activeSessionId) return null;
      return getSessionStatus(activeSessionId);
    },
  });

  // ── Buscar atividades da sessão ativa ─────────────────────────────────
  const { data: sessionActivities, refetch: refetchActivities } = useQuery({
    queryKey: ["session-activities", activeSessionId],
    enabled: Boolean(activeSessionId),
    queryFn: async () => {
      if (!activeSessionId) return [];
      const { data, error } = await supabase
        .from("plan_tasks")
        .select(
          "id, topic_id, subject_id, activity, activity_type, planned_minutes, actual_minutes, status, position, priority_score, priority_reason, source, subjects(name), topics(name)",
        )
        .eq("session_id", activeSessionId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((t: any) => ({
        taskId: t.id,
        topicId: t.topic_id ?? "",
        subjectId: t.subject_id ?? "",
        subjectName: t.subjects?.name ?? "Matéria",
        topicName: t.topics?.name ?? "Tópico",
        activity: t.activity ?? t.activity_type ?? "teoria",
        source: t.source ?? "planner",
        allocatedMinutes: t.planned_minutes ?? 0,
        actualMinutes: t.actual_minutes ?? null,
        status: t.status ?? "pendente",
        position: t.position ?? 0,
        priorityScore: t.priority_score ?? 0,
        priorityReason: t.priority_reason ?? "",
      }));
    },
  });

  const invalidateAll = useCallback(() => {
    void refetchStatus();
    void refetchActivities();
    queryClient.invalidateQueries({ queryKey: ["command-center"] });
  }, [refetchStatus, refetchActivities, queryClient]);

  // Determine loading state
  const isLoading = loadingPlans || loadingExisting;

  if (isLoading) {
    return (
      <AppShell title="Sessão de Estudo" description="Inicie uma sessão guiada pelo seu plano.">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </AppShell>
    );
  }

  // Se há sessão ativa, mostra a tela de execução
  if (activeSessionId && sessionActivities) {
    return (
      <ActiveSessionView
        sessionId={activeSessionId}
        activities={sessionActivities}
        status={sessionStatus ?? null}
        sessionResult={sessionResult}
        onComplete={() => {
          setActiveSessionId(null);
          setSessionResult(null);
          setSessionRecord(null);
          queryClient.invalidateQueries({ queryKey: ["existing-active-session"] });
          queryClient.invalidateQueries({ queryKey: ["command-center"] });
        }}
        onInvalidate={invalidateAll}
      />
    );
  }

  // Se não há planos, mostra estado vazio
  if (!plans?.length) {
    return (
      <AppShell title="Sessão de Estudo" description="Inicie uma sessão guiada pelo seu plano.">
        <EmptyState
          title="Nenhum plano ativo encontrado"
          description="Crie um plano de estudos para poder iniciar sessões de estudo."
          action={
            <Button asChild>
              <Link to="/plano">Criar plano</Link>
            </Button>
          }
        />
      </AppShell>
    );
  }

  // Tela de criação de sessão
  return (
    <CreateSessionView
      plans={plans}
      onCreated={(id, result) => {
        setActiveSessionId(id);
        setSessionResult(result);
        queryClient.invalidateQueries({ queryKey: ["existing-active-session"] });
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CRIAR SESSÃO
// ─────────────────────────────────────────────────────────────────────────────

type PlanOption = {
  id: string;
  name: string;
  contest_id: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  contests: { name: string } | null;
};

function CreateSessionView({
  plans,
  onCreated,
}: {
  plans: PlanOption[];
  onCreated: (sessionId: string, result: SessionResult) => void;
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [duration, setDuration] = useState("120");

  const create = useMutation({
    mutationFn: async () => {
      if (!planId) throw new Error("Selecione um plano.");
      const minutes = Number(duration) || 120;

      const { sessionId, result } = await createStudySession({
        planId,
        sessionConfig: { availableMinutes: minutes },
      });

      // Iniciar a sessão imediatamente
      await startSession(sessionId);

      return { sessionId, result };
    },
    onSuccess: ({ sessionId, result }) => {
      if (result.activities.length === 0) {
        toast.error(
          "Nenhuma tarefa disponível para hoje. Verifique se há tarefas pendentes no plano.",
        );
      } else {
        toast.success(
          `Sessão criada com ${result.activities.length} atividade(s) — ${formatMinutes(result.allocatedMinutes)}.`,
        );
      }
      onCreated(sessionId, result);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell
      title="Sessão de Estudo"
      description="Configure e inicie uma sessão de estudo a partir do seu plano ativo."
      actions={
        <Button asChild variant="outline">
          <Link to="/dashboard">Centro de Comando</Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <section className="panel px-5 py-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Nova sessão</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Selecione o plano e a duração disponível. O sistema monta a sequência de atividades
            automaticamente, priorizando revisões urgentes e tarefas de maior prioridade.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="plan">Plano de estudos</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger id="plan">
                  <SelectValue placeholder="Selecione o plano" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name}
                      {plan.contests?.name ? ` — ${plan.contests.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Duração disponível (minutos)</Label>
              <Input
                id="duration"
                type="number"
                min="15"
                step="15"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
          </div>

          <Button className="mt-5" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? "Montando sessão…" : "Iniciar sessão de estudo"}
          </Button>
        </section>
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSÃO ATIVA
// ─────────────────────────────────────────────────────────────────────────────

type ActivityItem = {
  taskId: string;
  topicId: string;
  subjectId: string;
  subjectName: string;
  topicName: string;
  activity: string;
  source: string;
  allocatedMinutes: number;
  actualMinutes: number | null;
  status: string;
  position: number;
  priorityScore: number;
  priorityReason: string;
};

function ActiveSessionView({
  sessionId,
  activities,
  status,
  sessionResult,
  onComplete,
  onInvalidate,
}: {
  sessionId: string;
  activities: ActivityItem[];
  status: SessionStatus | null;
  sessionResult: SessionResult | null;
  onComplete: () => void;
  onInvalidate: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState<number>(() => {
    // Start at the first non-completed activity
    const idx = activities.findIndex(
      (a) => a.status === "pendente" || a.status === "em_andamento",
    );
    return idx >= 0 ? idx : 0;
  });

  // Update currentIndex when activities change (after completing one)
  useEffect(() => {
    const idx = activities.findIndex(
      (a) => a.status === "pendente" || a.status === "em_andamento",
    );
    if (idx >= 0) setCurrentIndex(idx);
  }, [activities]);

  const currentActivity = activities[currentIndex] ?? null;
  const completedCount = activities.filter((a) => a.status === "concluida").length;
  const totalCount = activities.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const allDone = completedCount === totalCount && totalCount > 0;

  const completeAct = useMutation({
    mutationFn: async (taskId: string) => {
      const activity = activities.find((a) => a.taskId === taskId);
      if (!activity) throw new Error("Atividade não encontrada.");

      await completeActivity({
        sessionId,
        taskId,
        actualMinutes: activity.allocatedMinutes,
      });
    },
    onSuccess: () => {
      toast.success("Atividade concluída.");
      onInvalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const endSession = useMutation({
    mutationFn: async () => {
      await completeSession({ sessionId });
    },
    onSuccess: () => {
      toast.success("Sessão encerrada com sucesso.");
      onComplete();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // No activities at all
  if (totalCount === 0) {
    return (
      <AppShell
        title="Sessão de Estudo"
        description="Sessão em andamento."
        actions={
          <Button variant="outline" onClick={() => endSession.mutate()}>
            Encerrar sessão
          </Button>
        }
      >
        <EmptyState
          title="Nenhuma tarefa disponível para esta sessão"
          description="Não há tarefas pendentes para hoje no plano selecionado. Gere ou recalcule as tarefas do plano, ou ajuste a data de referência."
          action={
            <div className="flex gap-2">
              <Button asChild variant="outline">
                <Link to="/plano">Ir ao plano</Link>
              </Button>
              <Button variant="destructive" onClick={() => endSession.mutate()}>
                Encerrar sessão vazia
              </Button>
            </div>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Sessão de Estudo"
      description={`${completedCount} de ${totalCount} atividades concluídas`}
      actions={
        <Button
          variant="outline"
          onClick={() => endSession.mutate()}
          disabled={endSession.isPending}
        >
          {endSession.isPending ? "Encerrando…" : "Encerrar sessão"}
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Progress bar */}
        <section className="panel px-5 py-4">
          <div className="flex items-center justify-between text-sm">
            <span className="label-eyebrow">Progresso da sessão</span>
            <span className="text-muted-foreground">
              {completedCount}/{totalCount} · {Math.round(progressPercent)}%
            </span>
          </div>
          <Progress className="mt-2" value={progressPercent} />
          {status ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">Tempo alocado</p>
                <p className="mt-0.5 font-display text-sm font-semibold">
                  {formatMinutes(status.totalAllocatedMinutes)}
                </p>
              </div>
              <div className="rounded-md border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">Tempo registrado</p>
                <p className="mt-0.5 font-display text-sm font-semibold">
                  {formatMinutes(status.totalActualMinutes)}
                </p>
              </div>
              <div className="rounded-md border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground">Pendentes</p>
                <p className="mt-0.5 font-display text-sm font-semibold">
                  {status.pendingActivities + status.inProgressActivities}
                </p>
              </div>
            </div>
          ) : null}
        </section>

        {/* All done message */}
        {allDone ? (
          <section className="panel flex flex-col items-center justify-center px-6 py-10 text-center">
            <h2 className="font-display text-xl font-semibold text-foreground">
              Todas as atividades concluídas
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Você completou todas as atividades desta sessão. Encerre a sessão para registrar os
              resultados.
            </p>
            <Button
              className="mt-5"
              onClick={() => endSession.mutate()}
              disabled={endSession.isPending}
            >
              {endSession.isPending ? "Encerrando…" : "Encerrar sessão"}
            </Button>
          </section>
        ) : null}

        {/* Current activity */}
        {currentActivity && !allDone ? (
          <section className="panel border-primary/30 px-5 py-5">
            <p className="label-eyebrow text-primary">Atividade atual</p>
            <h2 className="mt-2 font-display text-xl font-semibold text-foreground">
              {currentActivity.topicName}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{currentActivity.subjectName}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge>{activityLabel(currentActivity.activity)}</Badge>
              <Badge variant="outline">{formatMinutes(currentActivity.allocatedMinutes)}</Badge>
              <Badge variant="outline">{sourceLabel(currentActivity.source)}</Badge>
              {currentActivity.priorityScore > 0 ? (
                <Badge variant="outline">
                  Prioridade {currentActivity.priorityScore.toFixed(1)}
                </Badge>
              ) : null}
            </div>

            {currentActivity.priorityReason ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {currentActivity.priorityReason}
              </p>
            ) : null}

            <div className="mt-5 flex gap-2">
              <Button
                onClick={() => completeAct.mutate(currentActivity.taskId)}
                disabled={completeAct.isPending}
              >
                {completeAct.isPending ? "Concluindo…" : "Concluir atividade"}
              </Button>
              {currentIndex < totalCount - 1 ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    // Skip to next — mark current as still pending, move index
                    const nextIdx = activities.findIndex(
                      (a, i) =>
                        i > currentIndex &&
                        (a.status === "pendente" || a.status === "em_andamento"),
                    );
                    if (nextIdx >= 0) setCurrentIndex(nextIdx);
                  }}
                >
                  Pular para próxima
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Activities list */}
        <section className="panel px-5 py-5">
          <p className="label-eyebrow">Sequência de atividades</p>
          <ul className="mt-3 space-y-2">
            {activities.map((activity, idx) => {
              const isCurrent = idx === currentIndex && !allDone;
              const isDone = activity.status === "concluida";

              return (
                <li
                  key={activity.taskId}
                  className={`rounded-md border px-3 py-3 text-sm transition-colors ${
                    isCurrent
                      ? "border-primary/40 bg-primary/5"
                      : isDone
                        ? "border-border bg-muted/30"
                        : "border-border"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {idx + 1}.
                        </span>
                        <p className={`truncate font-medium ${isDone ? "line-through opacity-60" : ""}`}>
                          {activity.topicName}
                        </p>
                      </div>
                      <p className="mt-0.5 ml-5 text-xs text-muted-foreground">
                        {activity.subjectName} · {activityLabel(activity.activity)} ·{" "}
                        {formatMinutes(activity.allocatedMinutes)}
                        {sourceLabel(activity.source) !== "Plano"
                          ? ` · ${sourceLabel(activity.source)}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isDone ? "default" : "outline"}>
                        {isDone
                          ? "Concluída"
                          : activity.status === "em_andamento"
                            ? "Em andamento"
                            : activity.status === "adiada"
                              ? "Adiada"
                              : "Pendente"}
                      </Badge>
                      {!isDone &&
                      activity.status !== "adiada" &&
                      !isCurrent &&
                      !allDone ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setCurrentIndex(idx)}
                        >
                          Ir para
                        </Button>
                      ) : null}
                      {isCurrent && !isDone ? (
                        <Button
                          size="sm"
                          onClick={() => completeAct.mutate(activity.taskId)}
                          disabled={completeAct.isPending}
                        >
                          Concluir
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Discarded tasks info */}
        {sessionResult && sessionResult.discardedTasks.length > 0 ? (
          <section className="panel px-5 py-4">
            <p className="label-eyebrow">Tarefas que não couberam na sessão</p>
            <ul className="mt-2 space-y-1">
              {sessionResult.discardedTasks.map((d) => (
                <li key={d.taskId} className="text-xs text-muted-foreground">
                  Tópico {d.topicId}: {d.reason}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
