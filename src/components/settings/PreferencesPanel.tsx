/**
 * Preferências de estudo do usuário.
 * Armazenadas em `profiles.preferences` (jsonb) — sem nova tabela.
 * Nenhuma recomendação inteligente aqui: são apenas parâmetros do planejador.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DAY_SHORT_LABELS } from "@/lib/planner/availability";
import { DEFAULT_BLOCK_MINUTES } from "@/lib/planner/service";

type StudyPreferences = {
  blockMinutes: number;
  maxDailyHours: number;
  preferredDays: number[];
  preferredTime: string;
  studyPreference: string;
};

const DEFAULTS: StudyPreferences = {
  blockMinutes: DEFAULT_BLOCK_MINUTES,
  maxDailyHours: 8,
  preferredDays: [1, 2, 3, 4, 5],
  preferredTime: "",
  studyPreference: "",
};

export function PreferencesPanel() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<StudyPreferences>(DEFAULTS);

  const { data: profile } = useQuery({
    queryKey: ["profile-preferences"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sessão expirada.");
      const { data, error } = await supabase
        .from("profiles")
        .select("id, preferences")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!profile) return;
    const stored = (profile.preferences ?? {}) as Partial<StudyPreferences>;
    setForm({ ...DEFAULTS, ...stored });
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      if (!profile) return;
      const { error } = await supabase
        .from("profiles")
        .update({
          preferences: {
            ...((profile.preferences ?? {}) as Record<string, unknown>),
            ...form,
          },
        })
        .eq("id", profile.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Preferências de estudo salvas.");
      queryClient.invalidateQueries({ queryKey: ["profile-preferences"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      className="panel max-w-2xl space-y-5 px-5 py-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <p className="label-eyebrow">Preferências de estudo</p>
        <p className="mt-1 text-sm text-muted-foreground">
          A disponibilidade por semana é editada em{" "}
          <Link to="/disponibilidade" className="underline">
            Disponibilidade
          </Link>
          , porque cada semana pode ser diferente.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="block-minutes">Duração média dos blocos (min)</Label>
          <Input
            id="block-minutes"
            type="number"
            min="15"
            step="5"
            value={form.blockMinutes}
            onChange={(e) => setForm({ ...form, blockMinutes: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="max-daily-hours">Máximo de horas por dia</Label>
          <Input
            id="max-daily-hours"
            type="number"
            min="0.5"
            step="0.5"
            value={form.maxDailyHours}
            onChange={(e) => setForm({ ...form, maxDailyHours: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="preferred-time">Horário preferencial</Label>
          <Input
            id="preferred-time"
            placeholder="Ex.: 06h às 09h"
            value={form.preferredTime}
            onChange={(e) => setForm({ ...form, preferredTime: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="study-preference">Preferência de estudo</Label>
          <Input
            id="study-preference"
            placeholder="Ex.: questões antes da teoria"
            value={form.studyPreference}
            onChange={(e) => setForm({ ...form, studyPreference: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Dias preferidos</Label>
        <div className="flex flex-wrap gap-3">
          {DAY_SHORT_LABELS.map((label, index) => (
            <label key={label} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.preferredDays.includes(index)}
                onCheckedChange={(checked) =>
                  setForm({
                    ...form,
                    preferredDays: checked
                      ? [...form.preferredDays, index]
                      : form.preferredDays.filter((day) => day !== index),
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <Button type="submit" disabled={save.isPending}>
        Salvar preferências
      </Button>
    </form>
  );
}
