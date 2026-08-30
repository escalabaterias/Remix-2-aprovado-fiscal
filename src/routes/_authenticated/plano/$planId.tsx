import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
  formatDateShort,
  formatHours,
  todayISO,
  weekStartOf,
  weekTotalMinutes,
  weekStartsBetween,
} from "@/lib/planner/availability";
import {
  completeTask,
  fetchAvailabilityWeeks,
  generatePlanTasks,
  replanPlan,
  startTask,
} from "@/lib/planner/service";

export const Route = createFileRoute("/_authenticated/plano/$planId")({
  head: () => ({
    meta: [
      { title: "Detalhe do plano — Aprovado Fiscal" },
      {
        name: "description",
        content:
          "Tarefas geradas pelo planejador, tempo planejado e realizado, replanejamento e conclusão de tarefas.",
      },
      { property: "og:title", content: "Detalhe do plano — Aprovado Fiscal" },
      { property: "og:description", content: "Acompanhamento do plano de estudos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlanDetailPage,
});

type TaskRow = {
  id: string;
  title: string;
  scheduled_date: string | null;
  original_date: string | null;
  planned_minutes: number | null;
  actual_minutes: number | null;
  gross_minutes: number | null;
  status: TaskStatus;
  activity_type: keyof typeof ACTIVITY_LABELS | null;
  priority_score: number | null;
  priority_reason: string | null;
  rescheduled_count: number | null;
  questions_count: number | null;
  correct_count: number | null;
  wrong_count: number | null;
};

const OPEN_STATUSES: TaskStatus[] = ["pendente", "em_andamento"];

function PlanDetailPage() {
  const { planId } = Route.useParams();
  const queryClient = useQueryClient();
  const [taskToComplete, setTaskToComplete] = useState<TaskRow | null>(null);

  const { data: plan } = useQuery({
    queryKey: ["plan", planId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("study_plans")
        .select(
          "id, name, start_date, end_date, is_active, settings, contest_id, contests(name, role_title, exam_board, exam_date)",
        )
        .eq("id", planId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["plan-tasks", planId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_tasks")
        .select(
          "id, title, scheduled_date, original_date, planned_minutes, actual_minutes, gross_minutes, status, activity_type, priority_score, priority_reason, rescheduled_count, questions_count, correct_count, wrong_count",
        )
        .eq("plan_id", planId)
        .order("scheduled_date", { ascending: true })
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TaskRow[];
    },
  });

  const { data: availability } = useQuery({
    queryKey: ["plan-availability", planId, plan?.start_date, plan?.end_date],
    enabled: Boolean(plan?.start_date && plan?.end_date),
    queryFn: async () => {
      const weeks = await fetchAvailabilityWeeks(
        weekStartsBetween(plan!.start_date!, plan!.end_date!),
      );
      return Array.from(weeks.values());
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["plan-tasks", planId] });
    queryClient.invalidateQueries({ queryKey: ["command-center"] });
  };

  const generate = useMutation({
    mutationFn: () => generatePlanTasks(planId),
    onSuccess: (result) => {
      if (!result.tasksCreated) {
        toast.error(
          "Nenhuma tarefa gerada. Verifique se há disponibilidade cadastrada para o período.",
        );
      } else {
        toast.success(
          `${result.tasksCreated} tarefas geradas — ${formatHours(result.allocatedMinutes)} de ${formatHours(result.capacityMinutes)} disponíveis.`,
        );
      }
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const replan = useMutation({
    mutationFn: () => replanPlan(planId),
    onSuccess: (result) => {
      if (!result.moved && !result.unplaced) {
        toast.success("Nada atrasado para replanejar.");
      } else {
        toast.success(
          `Replanejamento: ${result.moved} tarefa(s) redistribuída(s), ${result.unplaced} sem capacidade futura (${formatHours(result.deficitMinutes)} de diferença).`,
        );
      }
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const start = useMutation({
    mutationFn: (id: string) => startTask(id),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const today = todayISO();
  const all = tasks ?? [];
  const plannedTotal = all.reduce((sum, t) => sum + (t.planned_minutes ?? 0), 0);
  const realizedTotal = all.reduce((sum, t) => sum + (t.actual_minutes ?? 0), 0);
  const overdue = all.filter(
    (t) => OPEN_STATUSES.includes(t.status) && t.scheduled_date && t.scheduled_date < today,
  );

  const byDate = new Map<string, TaskRow[]>();
  for (const task of all) {
    const key = task.scheduled_date ?? "sem-data";
    byDate.set(key, [...(byDate.get(key) ?? []), task]);
  }

  const weekSummary = new Map<string, { planned: number; realized: number; capacity: number }>();
  for (const task of all) {
    if (!task.scheduled_date) continue;
    const week = weekStartOf(task.scheduled_date);
    const entry = weekSummary.get(week) ?? { planned: 0, realized: 0, capacity: 0 };
    entry.planned += task.planned_minutes ?? 0;
    entry.realized += task.actual_minutes ?? 0;
    weekSummary.set(week, entry);
  }
  for (const week of availability ?? []) {
    const entry = weekSummary.get(week.week_start);
    if (entry) entry.capacity = weekTotalMinutes(week);
  }

  return (
    <AppShell
      title={plan?.name ?? "Plano"}
      description={`${
        (plan?.contests as { name: string } | null)?.name ?? "Sem concurso"
      } · ${plan?.start_date ?? ""} → ${plan?.end_date ?? ""}`}
      actions={
        <>
          <Button asChild variant="outline">
            <Link to="/plano">Voltar</Link>
          </Button>
          <Button variant="outline" onClick={() => replan.mutate()} disabled={replan.isPending}>
            Replanejar
          </Button>
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            Gerar / recalcular tarefas
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <section className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Tempo planejado", value: formatHours(plannedTotal) },
            { label: "Tempo líquido realizado", value: formatHours(realizedTotal) },
            {
              label: "Aderência",
              value: plannedTotal ? `${Math.round((realizedTotal / plannedTotal) * 100)}%` : "—",
            },
            { label: "Tarefas atrasadas", value: String(overdue.length) },
          ].map((metric) => (
            <div key={metric.label} className="panel px-4 py-4">
              <p className="label-eyebrow">{metric.label}</p>
              <p className="mt-1 font-display text-xl font-semibold">{metric.value}</p>
            </div>
          ))}
        </section>

        {weekSummary.size ? (
          <section className="panel px-5 py-5">
            <p className="label-eyebrow">Semanas do plano</p>
            <div className="mt-3 space-y-3">
              {Array.from(weekSummary.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([week, entry]) => (
                  <div key={week}>
                    <div className="flex items-center justify-between text-sm">
                      <span>Semana de {formatDateShort(week)}</span>
                      <span className="text-muted-foreground">
                        {formatHours(entry.realized)} / {formatHours(entry.planned)} planejadas
                        {entry.capacity ? ` · ${formatHours(entry.capacity)} disponíveis` : ""}
                      </span>
                    </div>
                    <Progress
                      className="mt-1.5"
                      value={entry.planned ? Math.min(100, (entry.realized / entry.planned) * 100) : 0}
                    />
                  </div>
                ))}
            </div>
          </section>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !all.length ? (
          <EmptyState
            title="Nenhuma tarefa gerada ainda"
            description="Cadastre a disponibilidade das semanas do período e depois use “Gerar / recalcular tarefas”."
            action={
              <Button asChild variant="outline">
                <Link to="/disponibilidade">Cadastrar disponibilidade</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            {Array.from(byDate.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([date, dayTasks]) => (
                <section key={date} className="panel px-5 py-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-sm font-semibold">
                      {date === "sem-data" ? "Sem data (aguardando disponibilidade)" : formatDateShort(date)}
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      {formatHours(dayTasks.reduce((s, t) => s + (t.planned_minutes ?? 0), 0))}{" "}
                      planejadas
                    </span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {dayTasks.map((task) => (
                      <li
                        key={task.id}
                        className="rounded-md border border-border px-3 py-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{task.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {task.activity_type ? ACTIVITY_LABELS[task.activity_type] : "Estudo"} ·{" "}
                              {task.planned_minutes ?? 0} min
                              {task.actual_minutes !== null
                                ? ` · líquido ${task.actual_minutes} min`
                                : ""}
                              {task.rescheduled_count
                                ? ` · reagendada ${task.rescheduled_count}×`
                                : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={task.status === "concluida" ? "default" : "outline"}>
                              {TASK_STATUS_LABELS[task.status]}
                            </Badge>
                            {OPEN_STATUSES.includes(task.status) ? (
                              <>
                                {task.status === "pendente" ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => start.mutate(task.id)}
                                  >
                                    Iniciar
                                  </Button>
                                ) : null}
                                <Button size="sm" onClick={() => setTaskToComplete(task)}>
                                  Registrar
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </div>
                        {task.priority_reason ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {task.priority_reason}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </div>

      <CompleteTaskDialog
        task={taskToComplete}
        onClose={() => setTaskToComplete(null)}
        onDone={invalidate}
      />
    </AppShell>
  );
}

function CompleteTaskDialog({
  task,
  onClose,
  onDone,
}: {
  task: TaskRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<"concluida" | "parcialmente_concluida" | "cancelada">(
    "concluida",
  );
  const [gross, setGross] = useState("");
  const [pause, setPause] = useState("0");
  const [questions, setQuestions] = useState("");
  const [correct, setCorrect] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!task) return;
      const grossMinutes = Number(gross || task.planned_minutes || 0);
      const questionsCount = questions ? Number(questions) : 0;
      const correctCount = correct ? Number(correct) : 0;
      await completeTask({
        taskId: task.id,
        status,
        grossMinutes,
        pauseMinutes: Number(pause || 0),
        questionsCount,
        correctCount,
        wrongCount: Math.max(0, questionsCount - correctCount),
      });
    },
    onSuccess: () => {
      toast.success("Registro salvo.");
      onDone();
      onClose();
      setGross("");
      setPause("0");
      setQuestions("");
      setCorrect("");
      setStatus("concluida");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={Boolean(task)} onOpenChange={(open) => (!open ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar tarefa</DialogTitle>
          <DialogDescription>
            {task?.title} — planejado {task?.planned_minutes ?? 0} min. O tempo líquido é o bruto
            menos as pausas.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="status">Situação</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="concluida">Concluída</SelectItem>
                <SelectItem value="parcialmente_concluida">Parcialmente concluída</SelectItem>
                <SelectItem value="cancelada">Cancelada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="gross">Tempo bruto (min)</Label>
              <Input
                id="gross"
                type="number"
                min="0"
                placeholder={String(task?.planned_minutes ?? 0)}
                value={gross}
                onChange={(e) => setGross(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pause">Pausas (min)</Label>
              <Input
                id="pause"
                type="number"
                min="0"
                value={pause}
                onChange={(e) => setPause(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="questions">Questões (opcional)</Label>
              <Input
                id="questions"
                type="number"
                min="0"
                value={questions}
                onChange={(e) => setQuestions(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="correct">Acertos (opcional)</Label>
              <Input
                id="correct"
                type="number"
                min="0"
                value={correct}
                onChange={(e) => setCorrect(e.target.value)}
              />
            </div>
          </div>
          <Button type="submit" disabled={save.isPending}>
            Salvar registro
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
