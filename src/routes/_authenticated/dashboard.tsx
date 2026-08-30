import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Play,
  RotateCcw,
  Sparkles,
  Target,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { WhatToStudyNowCard } from "@/components/study/WhatToStudyNowCard";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACTIVITY_LABELS, TASK_STATUS_LABELS, type TaskStatus } from "@/lib/domain";
import {
  addDays,
  availableMinutesOn,
  daysBetween,
  formatDateShort,
  formatHours,
  todayISO,
  weekStartOf,
  weekTotalMinutes,
} from "@/lib/planner/availability";
import {
  completeTask,
  fetchAvailabilityWeeks,
  replanPlan,
  startTask,
  type CompleteTaskInput,
} from "@/lib/planner/service";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Centro de Comando — Aprovado Fiscal" },
      {
        name: "description",
        content:
          "O que estudar hoje, quanto tempo dedicar e por quê: concurso ativo, tarefas do dia, meta semanal e progresso real.",
      },
      { property: "og:title", content: "Centro de Comando — Aprovado Fiscal" },
      {
        property: "og:description",
        content: "Painel diário de execução orientada a dados do plano de estudos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CommandCenterPage,
});

type DayTask = {
  id: string;
  title: string;
  status: TaskStatus;
  planned_minutes: number | null;
  actual_minutes: number | null;
  gross_minutes: number | null;
  activity_type: keyof typeof ACTIVITY_LABELS | null;
  priority_score: number | null;
  priority_reason: string | null;
  plan_id: string;
  position: number | null;
  scheduled_date: string | null;
  source: string | null;
};

type TaskFilter = "todas" | "pendentes" | "concluidas";

function CommandCenterPage() {
  const queryClient = useQueryClient();
  const today = todayISO();
  const weekStart = weekStartOf(today);
  const weekEnd = addDays(weekStart, 6);

  const [filter, setFilter] = useState<TaskFilter>("todas");
  const [taskToComplete, setTaskToComplete] = useState<DayTask | null>(null);
  const [completeStatus, setCompleteStatus] = useState<
    "concluida" | "parcialmente_concluida" | "cancelada"
  >("concluida");
  const [grossMinutes, setGrossMinutes] = useState(50);
  const [pauseMinutes, setPauseMinutes] = useState(0);
  const [questionsCount, setQuestionsCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [notes, setNotes] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["command-center", today],
    queryFn: async () => {
      const [
        contestsRes,
        plansRes,
        todayTasksRes,
        overdueTasksRes,
        weekTasksRes,
        sessionsRes,
        attemptsRes,
        reviewsRes,
        errorsRes,
        weeksMap,
      ] = await Promise.all([
        supabase
          .from("contests")
          .select("id, name, role_title, exam_board, exam_date, status, organization")
          .order("exam_date", { ascending: true }),
        supabase
          .from("study_plans")
          .select("id, name, contest_id, start_date, end_date, is_active")
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
        supabase
          .from("plan_tasks")
          .select(
            "id, title, status, planned_minutes, actual_minutes, gross_minutes, activity_type, priority_score, priority_reason, plan_id, position, scheduled_date, source",
          )
          .eq("scheduled_date", today)
          .order("position", { ascending: true }),
        supabase
          .from("plan_tasks")
          .select(
            "id, title, status, planned_minutes, actual_minutes, gross_minutes, activity_type, priority_score, priority_reason, plan_id, position, scheduled_date, source",
          )
          .lt("scheduled_date", today)
          .in("status", ["pendente", "em_andamento", "reagendada"])
          .order("scheduled_date", { ascending: false }),
        supabase
          .from("plan_tasks")
          .select("id, planned_minutes, actual_minutes, status, scheduled_date")
          .gte("scheduled_date", weekStart)
          .lte("scheduled_date", weekEnd),
        supabase
          .from("study_sessions")
          .select("net_seconds, session_date, questions_count, correct_count"),
        supabase.from("question_attempts").select("is_correct"),
        supabase
          .from("review_events")
          .select("id", { count: "exact", head: true })
          .not("completed_at", "is", null),
        supabase
          .from("error_entries")
          .select("id", { count: "exact", head: true })
          .eq("is_resolved", false),
        fetchAvailabilityWeeks([weekStart]),
      ]);

      const allSessions = sessionsRes.data ?? [];
      const netSecondsTotal = allSessions.reduce((sum, s) => sum + (s.net_seconds ?? 0), 0);
      const netTodaySeconds = allSessions
        .filter((s) => s.session_date === today)
        .reduce((sum, s) => sum + (s.net_seconds ?? 0), 0);

      const netWeekSeconds = allSessions
        .filter((s) => s.session_date >= weekStart && s.session_date <= weekEnd)
        .reduce((sum, s) => sum + (s.net_seconds ?? 0), 0);

      const attemptRows = attemptsRes.data ?? [];
      const attemptCorrect = attemptRows.filter((a) => a.is_correct === true).length;
      const sessionQuestions = allSessions.reduce((sum, s) => sum + (s.questions_count ?? 0), 0);
      const sessionCorrect = allSessions.reduce((sum, s) => sum + (s.correct_count ?? 0), 0);
      const questionsTotal = attemptRows.length + sessionQuestions;
      const correctTotal = attemptCorrect + sessionCorrect;

      const contestList = contestsRes.data ?? [];
      const activeContest = contestList.find((c) => c.status === "ativo") ?? contestList[0] ?? null;
      const activePlan =
        (plansRes.data ?? []).find((p) => p.contest_id === activeContest?.id) ??
        (plansRes.data ?? [])[0] ??
        null;

      const todayTasks = (todayTasksRes.data ?? []) as DayTask[];
      const overdueTasks = (overdueTasksRes.data ?? []) as DayTask[];
      const weekTasks = weekTasksRes.data ?? [];

      const currentWeekAvail = weeksMap.get(weekStart);
      const weeklyAvailableMinutes = currentWeekAvail ? weekTotalMinutes(currentWeekAvail) : 0;
      const weeklyPlannedMinutes = weekTasks.reduce((sum, t) => sum + (t.planned_minutes ?? 0), 0);
      const weeklyRealizedMinutes = Math.round(netWeekSeconds / 60);

      const completedTasksToday = todayTasks.filter(
        (t) => t.status === "concluida" || t.status === "parcialmente_concluida",
      ).length;

      return {
        activeContest,
        allContests: contestList,
        activePlan,
        hasPlan: Boolean((plansRes.data ?? []).length),
        todayTasks,
        overdueTasks,
        completedTasksToday,
        plannedMinutesToday: todayTasks.reduce((sum, t) => sum + (t.planned_minutes ?? 0), 0),
        realizedMinutesToday: Math.round(netTodaySeconds / 60),
        availableMinutesToday: availableMinutesOn(today, weeksMap),
        weeklyAvailableMinutes,
        weeklyPlannedMinutes,
        weeklyRealizedMinutes,
        netHoursTotal: netSecondsTotal / 3600,
        questionsTotal,
        accuracy: questionsTotal ? (correctTotal / questionsTotal) * 100 : null,
        reviewsCompleted: reviewsRes.count ?? 0,
        unresolvedErrors: errorsRes.count ?? 0,
      };
    },
  });

  const startTaskMutation = useMutation({
    mutationFn: (id: string) => startTask(id),
    onSuccess: () => {
      toast.success("Tarefa iniciada!");
      queryClient.invalidateQueries({ queryKey: ["command-center"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const replanMutation = useMutation({
    mutationFn: (planId: string) => replanPlan(planId),
    onSuccess: (result) => {
      toast.success(
        `Replanejamento concluído: ${result.moved} tarefa(s) redistribuída(s) na disponibilidade futura.`,
      );
      queryClient.invalidateQueries({ queryKey: ["command-center"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const completeTaskMutation = useMutation({
    mutationFn: (input: CompleteTaskInput) => completeTask(input),
    onSuccess: () => {
      toast.success("Execução registrada e sessão contabilizada com sucesso!");
      setTaskToComplete(null);
      queryClient.invalidateQueries({ queryKey: ["command-center"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleOpenComplete = (task: DayTask) => {
    setTaskToComplete(task);
    setCompleteStatus("concluida");
    setGrossMinutes(task.planned_minutes ?? 50);
    setPauseMinutes(0);
    setQuestionsCount(0);
    setCorrectCount(0);
    setNotes("");
  };

  const handleSaveComplete = () => {
    if (!taskToComplete) return;
    completeTaskMutation.mutate({
      taskId: taskToComplete.id,
      status: completeStatus,
      grossMinutes: Number(grossMinutes) || 0,
      pauseMinutes: Number(pauseMinutes) || 0,
      questionsCount: Number(questionsCount) || 0,
      correctCount: Number(correctCount) || 0,
      wrongCount: Math.max(0, (Number(questionsCount) || 0) - (Number(correctCount) || 0)),
      notes: notes.trim() || undefined,
    });
  };

  if (isLoading || !data) {
    return (
      <AppShell title="Centro de Comando">
        <div className="flex min-h-[400px] items-center justify-center">
          <p className="text-sm text-muted-foreground">Carregando centro operacional…</p>
        </div>
      </AppShell>
    );
  }

  const nextTask = data.todayTasks.find(
    (t) => t.status === "pendente" || t.status === "em_andamento",
  );

  const daysToExam = data.activeContest?.exam_date
    ? daysBetween(today, data.activeContest.exam_date)
    : null;

  const weeklyTargetMinutes =
    data.weeklyPlannedMinutes > 0 ? data.weeklyPlannedMinutes : data.weeklyAvailableMinutes;
  const weeklyProgressPercent = weeklyTargetMinutes
    ? Math.min(100, Math.round((data.weeklyRealizedMinutes / weeklyTargetMinutes) * 100))
    : 0;

  const filteredTasks = data.todayTasks.filter((t) => {
    if (filter === "pendentes") return t.status === "pendente" || t.status === "em_andamento";
    if (filter === "concluidas")
      return t.status === "concluida" || t.status === "parcialmente_concluida";
    return true;
  });

  return (
    <AppShell
      title="Centro de Comando"
      description="Direcionamento operacional diário: concurso ativo, tarefas imediatas e meta semanal com dados 100% reais."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/disponibilidade">
              <Calendar className="mr-1.5 h-4 w-4" />
              Disponibilidade
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/estudo">
              <Play className="mr-1.5 h-4 w-4" />
              Sessão Guiada
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/plano">
              <BookOpen className="mr-1.5 h-4 w-4" />
              Plano de Estudos
            </Link>
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* ── ALERTA DE TAREFAS ATRASADAS / REPLANEJAMENTO ─────────────────────── */}
        {data.overdueTasks.length > 0 && data.activePlan ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <p className="text-sm font-medium">
                  {data.overdueTasks.length} tarefa(s) pendente(s) de dias anteriores
                </p>
                <p className="text-xs text-amber-200/80">
                  O planejamento adaptativo redistribui os blocos pendentes na sua disponibilidade
                  futura sem sobrecarregar seu dia.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-500/40 text-amber-100 hover:bg-amber-500/20"
              disabled={replanMutation.isPending}
              onClick={() => replanMutation.mutate(data.activePlan!.id)}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              {replanMutation.isPending ? "Replanejando…" : "Replanejar pendências"}
            </Button>
          </div>
        ) : null}

        {/* ── GRID SUPERIOR: CONCURSO ATIVO + META SEMANAL ────────────────────── */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Card: Concurso Ativo */}
          <section className="panel flex flex-col justify-between p-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="label-eyebrow">Concurso Alvo Ativo</p>
                <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                  <Link to="/concursos">Gerenciar</Link>
                </Button>
              </div>

              {!data.activeContest ? (
                <div className="mt-4">
                  <p className="text-sm text-muted-foreground">
                    Você ainda não possui um concurso cadastrado como ativo.
                  </p>
                  <Button asChild size="sm" variant="outline" className="mt-3">
                    <Link to="/concursos">Cadastrar concurso</Link>
                  </Button>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-xl font-bold tracking-tight">
                      {data.activeContest.name}
                    </h2>
                    {data.activeContest.role_title ? (
                      <span className="text-xs text-muted-foreground">
                        ({data.activeContest.role_title})
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {data.activeContest.exam_board ? (
                      <Badge variant="outline" className="border-border">
                        Banca: {data.activeContest.exam_board}
                      </Badge>
                    ) : null}

                    {data.activeContest.organization ? (
                      <Badge variant="secondary">{data.activeContest.organization}</Badge>
                    ) : null}

                    {data.activeContest.exam_date ? (
                      <Badge
                        variant={
                          daysToExam !== null && daysToExam <= 45 ? "destructive" : "default"
                        }
                      >
                        Prova em {data.activeContest.exam_date}
                        {daysToExam !== null ? ` · ${daysToExam} dia(s)` : ""}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Data da prova não informada
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {data.activePlan ? (
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                <span>Plano: {data.activePlan.name}</span>
                <Link
                  to="/plano/$planId"
                  params={{ planId: data.activePlan.id }}
                  className="inline-flex items-center text-primary hover:underline"
                >
                  Ver cronograma
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </div>
            ) : null}
          </section>

          {/* Card: Meta Semanal */}
          <section className="panel flex flex-col justify-between p-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="label-eyebrow">Meta Semanal ({formatDateShort(weekStart)} a Dom)</p>
                <Badge variant="outline" className="text-xs">
                  {weeklyProgressPercent}% atingido
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Horas Realizadas</p>
                  <p className="mt-1 font-display text-2xl font-bold text-primary">
                    {formatHours(data.weeklyRealizedMinutes)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Meta / Capacidade</p>
                  <p className="mt-1 font-display text-2xl font-bold text-foreground">
                    {formatHours(weeklyTargetMinutes)}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Ritmo da semana</span>
                  <span>
                    {data.weeklyRealizedMinutes >= weeklyTargetMinutes && weeklyTargetMinutes > 0
                      ? "Meta da semana cumprida!"
                      : `Faltam ${formatHours(Math.max(0, weeklyTargetMinutes - data.weeklyRealizedMinutes))}`}
                  </span>
                </div>
                <Progress value={weeklyProgressPercent} />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
              <span>Disponibilidade cadastrada: {formatHours(data.weeklyAvailableMinutes)}</span>
              <Link to="/disponibilidade" className="text-primary hover:underline">
                Ajustar horas
              </Link>
            </div>
          </section>
        </div>

        {/* ── CARD ORIENTADO À AÇÃO: O QUE ESTUDAR AGORA ───────────────────────── */}
        <WhatToStudyNowCard
          activePlanId={data.activePlan?.id}
          contestId={data.activeContest?.id}
          onStartTask={(taskId) => startTaskMutation.mutate(taskId)}
        />

        {/* ── LISTA DE TAREFAS DE HOJE ────────────────────────────────────────── */}
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="label-eyebrow">Agenda de Hoje ({formatDateShort(today)})</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.completedTasksToday} de {data.todayTasks.length} blocos concluídos ·{" "}
                {formatHours(data.realizedMinutesToday)} líquido de{" "}
                {formatHours(data.plannedMinutesToday)} planejado
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-xs">
              {(["todas", "pendentes", "concluidas"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded px-2.5 py-1 font-medium transition-colors ${
                    filter === f
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f === "todas" ? "Todas" : f === "pendentes" ? "Pendentes" : "Concluídas"}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <Progress
              value={
                data.plannedMinutesToday
                  ? Math.min(100, (data.realizedMinutesToday / data.plannedMinutesToday) * 100)
                  : 0
              }
            />
          </div>

          {filteredTasks.length === 0 ? (
            <p className="mt-4 text-center py-6 text-sm text-muted-foreground">
              {data.todayTasks.length === 0
                ? "Nenhuma tarefa planejada para o dia de hoje."
                : "Nenhuma tarefa encontrada com o filtro selecionado."}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {filteredTasks.map((task) => (
                <li
                  key={task.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 max-w-xl space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{task.title}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {task.activity_type ? ACTIVITY_LABELS[task.activity_type] : "Estudo"}
                      </Badge>
                    </div>
                    {task.priority_reason ? (
                      <p className="text-xs text-muted-foreground truncate">
                        {task.priority_reason}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {task.actual_minutes !== null ? `${task.actual_minutes}min / ` : ""}
                      {task.planned_minutes ?? 0}min
                    </span>

                    <Badge
                      variant={
                        task.status === "concluida"
                          ? "default"
                          : task.status === "em_andamento"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {TASK_STATUS_LABELS[task.status]}
                    </Badge>

                    {task.status !== "concluida" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => handleOpenComplete(task)}
                      >
                        Concluir
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── MÉTRICAS DE PROGRESSO REAL ──────────────────────────────────────── */}
        <section>
          <p className="label-eyebrow">Métricas Reais Acumuladas</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              {
                label: "Horas líquidas totais",
                value: data.netHoursTotal ? `${data.netHoursTotal.toFixed(1)}h` : "0h",
              },
              {
                label: "Questões resolvidas",
                value: String(data.questionsTotal),
              },
              {
                label: "Taxa de acerto",
                value: data.accuracy === null ? "—" : `${data.accuracy.toFixed(0)}%`,
              },
              {
                label: "Revisões concluídas",
                value: String(data.reviewsCompleted),
              },
              {
                label: "Erros pendentes",
                value: String(data.unresolvedErrors),
              },
            ].map((metric) => (
              <div key={metric.label} className="panel px-4 py-4">
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <p className="mt-1 font-display text-xl font-semibold">{metric.value}</p>
              </div>
            ))}
          </div>
        </section>

        {!data.activeContest && !data.hasPlan ? (
          <EmptyState
            title="Comece pelo básico"
            description="Cadastre o concurso, vincule as matérias do edital, informe sua disponibilidade e crie o primeiro plano."
            action={
              <Button asChild>
                <Link to="/concursos">Cadastrar concurso</Link>
              </Button>
            }
          />
        ) : null}
      </div>

      {/* ── MODAL: REGISTRO RÁPIDO DE CONCLUSÃO DE TAREFA ────────────────────── */}
      <Dialog
        open={Boolean(taskToComplete)}
        onOpenChange={(open) => !open && setTaskToComplete(null)}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Registrar Execução</DialogTitle>
            <DialogDescription>
              {taskToComplete?.title} — Informe o tempo e questões para contabilizar na sessão de
              estudos real.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Status da execução</Label>
              <Select
                value={completeStatus}
                onValueChange={(val) =>
                  setCompleteStatus(val as "concluida" | "parcialmente_concluida" | "cancelada")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="concluida">Concluída</SelectItem>
                  <SelectItem value="parcialmente_concluida">Parcialmente concluída</SelectItem>
                  <SelectItem value="cancelada">Cancelada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tempo Bruto (minutos)</Label>
                <Input
                  type="number"
                  min={0}
                  value={grossMinutes}
                  onChange={(e) => setGrossMinutes(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Pausas (minutos)</Label>
                <Input
                  type="number"
                  min={0}
                  value={pauseMinutes}
                  onChange={(e) => setPauseMinutes(Number(e.target.value))}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Tempo líquido resultante:{" "}
              <strong className="text-foreground">
                {Math.max(0, (grossMinutes || 0) - (pauseMinutes || 0))} min
              </strong>
            </p>

            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
              <div className="space-y-1.5">
                <Label>Questões Feitas</Label>
                <Input
                  type="number"
                  min={0}
                  value={questionsCount}
                  onChange={(e) => setQuestionsCount(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Acertos</Label>
                <Input
                  type="number"
                  min={0}
                  value={correctCount}
                  onChange={(e) => setCorrectCount(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Anotações (opcional)</Label>
              <Input
                placeholder="Ex: Tópico difícil, revisar pegadinhas..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setTaskToComplete(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveComplete} disabled={completeTaskMutation.isPending}>
              {completeTaskMutation.isPending ? "Salvando…" : "Salvar execução"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
