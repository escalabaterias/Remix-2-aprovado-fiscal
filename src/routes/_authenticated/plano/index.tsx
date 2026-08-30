import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addDays, todayISO } from "@/lib/planner/availability";
import { DEFAULT_BLOCK_MINUTES, DEFAULT_MAX_DAILY_MINUTES } from "@/lib/planner/service";

export const Route = createFileRoute("/_authenticated/plano/")({
  head: () => ({
    meta: [
      { title: "Plano de estudos — Aprovado Fiscal" },
      {
        name: "description",
        content:
          "Crie planos de estudo por concurso, com período, matérias selecionadas e distribuição automática do tempo.",
      },
      { property: "og:title", content: "Plano de estudos — Aprovado Fiscal" },
      {
        property: "og:description",
        content: "Planejamento determinístico de estudos por concurso.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlansPage,
});

function PlansPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [contestId, setContestId] = useState<string>("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(addDays(todayISO(), 27));
  const [blockMinutes, setBlockMinutes] = useState(String(DEFAULT_BLOCK_MINUTES));
  const [maxDaily, setMaxDaily] = useState(String(DEFAULT_MAX_DAILY_MINUTES / 60));
  const [selected, setSelected] = useState<string[]>([]);

  const { data: contests } = useQuery({
    queryKey: ["contests-for-plan"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contests")
        .select("id, name, role_title, exam_board, exam_date, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: plans, isLoading } = useQuery({
    queryKey: ["study-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("study_plans")
        .select("id, name, start_date, end_date, is_active, contest_id, contests(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: contestTopics } = useQuery({
    queryKey: ["contest-topics-for-plan", contestId],
    enabled: Boolean(contestId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contest_topics")
        .select("id, priority, subjects(name), topics(name)")
        .eq("contest_id", contestId)
        .order("priority", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sessão expirada.");
      if (!contestId) throw new Error("Selecione um concurso.");
      if (!name.trim()) throw new Error("Informe um nome para o plano.");
      if (endDate < startDate) throw new Error("A data final deve ser posterior à inicial.");

      const { data, error } = await supabase
        .from("study_plans")
        .insert({
          user_id: auth.user.id,
          contest_id: contestId,
          name: name.trim(),
          start_date: startDate,
          end_date: endDate,
          is_active: true,
          settings: {
            blockMinutes: Number(blockMinutes) || DEFAULT_BLOCK_MINUTES,
            maxDailyMinutes: Math.round((Number(maxDaily) || 8) * 60),
            contestTopicIds: selected,
          },
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      toast.success("Plano criado. Gere as tarefas na tela do plano.");
      queryClient.invalidateQueries({ queryKey: ["study-plans"] });
      setCreating(false);
      navigate({ to: "/plano/$planId", params: { planId: id } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell
      title="Plano de estudos"
      description="O plano usa a disponibilidade da semana correspondente, a prioridade do edital e o domínio registrado para distribuir o tempo."
      actions={
        <>
          <Button asChild variant="outline">
            <Link to="/disponibilidade">Disponibilidade</Link>
          </Button>
          <Button onClick={() => setCreating((v) => !v)}>
            {creating ? "Cancelar" : "Novo plano"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {creating ? (
          <form
            className="panel space-y-5 px-5 py-6"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contest">Concurso</Label>
                <Select value={contestId} onValueChange={setContestId}>
                  <SelectTrigger id="contest">
                    <SelectValue placeholder="Selecione o concurso" />
                  </SelectTrigger>
                  <SelectContent>
                    {(contests ?? []).map((contest) => (
                      <SelectItem key={contest.id} value={contest.id}>
                        {contest.name}
                        {contest.exam_date ? ` — prova ${contest.exam_date}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-name">Nome do plano</Label>
                <Input
                  id="plan-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Ciclo inicial — 4 semanas"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="start">Data inicial</Label>
                <Input
                  id="start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end">Data final</Label>
                <Input
                  id="end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="block">Duração do bloco (minutos)</Label>
                <Input
                  id="block"
                  type="number"
                  min="15"
                  step="5"
                  value={blockMinutes}
                  onChange={(e) => setBlockMinutes(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-daily">Máximo de horas por dia</Label>
                <Input
                  id="max-daily"
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={maxDaily}
                  onChange={(e) => setMaxDaily(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Matérias e tópicos do plano</Label>
              {!contestId ? (
                <p className="text-sm text-muted-foreground">Selecione um concurso primeiro.</p>
              ) : !contestTopics?.length ? (
                <p className="text-sm text-muted-foreground">
                  Este concurso ainda não tem matérias vinculadas. Vincule na página do concurso.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Nenhum item marcado = todos os vínculos do concurso entram no plano.
                  </p>
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                    {contestTopics.map((item) => {
                      const label = `${(item.subjects as { name: string } | null)?.name ?? "Matéria"}${
                        (item.topics as { name: string } | null)?.name
                          ? ` — ${(item.topics as { name: string }).name}`
                          : ""
                      }`;
                      return (
                        <label key={item.id} className="flex items-center gap-3 text-sm">
                          <Checkbox
                            checked={selected.includes(item.id)}
                            onCheckedChange={(checked) =>
                              setSelected((prev) =>
                                checked ? [...prev, item.id] : prev.filter((id) => id !== item.id),
                              )
                            }
                          />
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                          <Badge variant="outline">P{item.priority}</Badge>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <Button type="submit" disabled={create.isPending}>
              Criar plano
            </Button>
          </form>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !plans?.length ? (
          <EmptyState
            title="Você ainda não tem um plano de estudos"
            description="Crie um plano vinculado a um concurso para o Centro de Comando saber o que recomendar hoje."
            action={<Button onClick={() => setCreating(true)}>Criar meu primeiro plano</Button>}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {plans.map((plan) => (
              <Link
                key={plan.id}
                to="/plano/$planId"
                params={{ planId: plan.id }}
                className="panel px-5 py-4 transition-colors hover:border-primary/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-base font-semibold">{plan.name}</h2>
                  {plan.is_active ? <Badge>Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {(plan.contests as { name: string } | null)?.name ?? "Sem concurso"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {plan.start_date} → {plan.end_date}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
