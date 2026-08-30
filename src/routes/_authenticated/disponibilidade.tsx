import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DAY_MINUTE_KEYS,
  DAY_SHORT_LABELS,
  emptyWeek,
  formatHours,
  fromISODate,
  weekTotalMinutes,
  type AvailabilityWeek,
} from "@/lib/planner/availability";
import { fetchAvailabilityWeeks, nextWeekStarts, upsertAvailabilityWeek } from "@/lib/planner/service";

export const Route = createFileRoute("/_authenticated/disponibilidade")({
  head: () => ({
    meta: [
      { title: "Disponibilidade semanal — Aprovado Fiscal" },
      {
        name: "description",
        content:
          "Informe quantas horas você tem por dia em cada semana. Cada semana pode ser diferente da anterior.",
      },
      { property: "og:title", content: "Disponibilidade semanal — Aprovado Fiscal" },
      {
        property: "og:description",
        content: "Disponibilidade de estudo registrada semana por semana.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AvailabilityPage,
});

const WEEK_COUNT = 8;

function weekLabel(weekStart: string) {
  const start = fromISODate(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${fmt(start)} — ${fmt(end)}`;
}

function AvailabilityPage() {
  const queryClient = useQueryClient();
  const weekStarts = nextWeekStarts(WEEK_COUNT);
  const [draft, setDraft] = useState<Record<string, AvailabilityWeek>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["availability-weeks", weekStarts[0]],
    queryFn: async () => {
      const map = await fetchAvailabilityWeeks(weekStarts);
      // Return both the weeks and which ones were saved in the database.
      return {
        weeks: weekStarts.map((ws) => map.get(ws) ?? emptyWeek(ws)),
        savedWeekStarts: new Set(map.keys()),
      };
    },
  });

  const savedWeekStarts = data?.savedWeekStarts ?? new Set<string>();

  useEffect(() => {
    if (!data) return;
    setDraft(Object.fromEntries(data.weeks.map((week) => [week.week_start, week])));
  }, [data]);

  const save = useMutation({
    mutationFn: async (week: AvailabilityWeek) => upsertAvailabilityWeek(week),
    onSuccess: () => {
      toast.success("Disponibilidade salva. O plano pode ser recalculado a qualquer momento.");
      queryClient.invalidateQueries({ queryKey: ["availability-weeks"] });
      queryClient.invalidateQueries({ queryKey: ["command-center"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setMinutes = (weekStart: string, key: (typeof DAY_MINUTE_KEYS)[number], hours: string) => {
    const value = hours === "" ? 0 : Math.max(0, Math.min(24, Number(hours)));
    setDraft((prev) => ({
      ...prev,
      [weekStart]: { ...(prev[weekStart] ?? emptyWeek(weekStart)), [key]: Math.round(value * 60) },
    }));
  };

  const copyPrevious = (index: number) => {
    const current = weekStarts[index]!;
    const previous = weekStarts[index - 1];
    if (!previous) return;
    const source = draft[previous];
    if (!source) return;
    setDraft((prev) => ({ ...prev, [current]: { ...source, week_start: current } }));
  };

  return (
    <AppShell
      title="Disponibilidade semanal"
      description="A disponibilidade não é fixa: informe cada semana separadamente. O planejador usa exatamente a disponibilidade da semana correspondente. Deixe 0 para marcar um dia indisponível."
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="space-y-4">
          {weekStarts.map((weekStart, index) => {
            const week = draft[weekStart] ?? emptyWeek(weekStart);
            const total = weekTotalMinutes(week);
            const isSaved = savedWeekStarts.has(weekStart);
            return (
              <section key={weekStart} className="panel px-5 py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="label-eyebrow">
                      {index === 0 ? "Semana atual" : `Semana +${index}`}
                    </p>
                    <h2 className="font-display text-base font-semibold">{weekLabel(weekStart)}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={total > 0 ? "default" : "outline"}>
                      {formatHours(total)} disponíveis
                    </Badge>
                    {index > 0 ? (
                      <Button variant="ghost" size="sm" onClick={() => copyPrevious(index)}>
                        Copiar semana anterior
                      </Button>
                    ) : null}
                    <Button size="sm" onClick={() => save.mutate(week)} disabled={save.isPending}>
                      Salvar
                    </Button>
                  </div>
                </div>

                {!isSaved ? (
                  <Alert variant="default" className="mt-3">
                    <AlertDescription>
                      ⚠️ Disponibilidade não cadastrada para esta semana. O planejador tratará como 0 minutos até que você salve.
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  {DAY_MINUTE_KEYS.map((key, dayIndex) => (
                    <div key={key} className="space-y-1.5">
                      <Label htmlFor={`${weekStart}-${key}`} className="text-xs">
                        {DAY_SHORT_LABELS[dayIndex]}
                      </Label>
                      <Input
                        id={`${weekStart}-${key}`}
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={week[key] ? String(week[key] / 60) : "0"}
                        onChange={(e) => setMinutes(weekStart, key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
