import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { PreferencesPanel } from "@/components/settings/PreferencesPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COACH_AUTONOMY_LABELS,
  COACH_INTENSITY_LABELS,
  type CoachAutonomy,
  type CoachIntensity,
} from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Aprovado Fiscal" },
      {
        name: "description",
        content: "Perfil, disponibilidade semanal, fuso horário e preferências do Coach.",
      },
      { property: "og:title", content: "Configurações — Aprovado Fiscal" },
      { property: "og:description", content: "Preferências da sua conta no Aprovado Fiscal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsPage,
});

type ProfileForm = {
  full_name: string;
  target_area: string;
  experience_level: string;
  weekly_availability_hours: string;
  timezone: string;
  coach_intensity: CoachIntensity;
  coach_autonomy: CoachAutonomy;
};

const EXPERIENCE_LEVELS = ["Iniciante", "Intermediário", "Avançado"];

function SettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProfileForm | null>(null);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sessão expirada.");
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, full_name, email, target_area, experience_level, weekly_availability_hours, timezone, coach_intensity, coach_autonomy",
        )
        .eq("id", auth.user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!profile) return;
    setForm({
      full_name: profile.full_name ?? "",
      target_area: profile.target_area ?? "",
      experience_level: profile.experience_level ?? "",
      weekly_availability_hours: profile.weekly_availability_hours?.toString() ?? "",
      timezone: profile.timezone ?? "America/Fortaleza",
      coach_intensity: profile.coach_intensity,
      coach_autonomy: profile.coach_autonomy,
    });
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form || !profile) return;
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: form.full_name || null,
          target_area: form.target_area || null,
          experience_level: form.experience_level || null,
          weekly_availability_hours: form.weekly_availability_hours
            ? Number(form.weekly_availability_hours)
            : null,
          timezone: form.timezone,
          coach_intensity: form.coach_intensity,
          coach_autonomy: form.coach_autonomy,
        })
        .eq("id", profile.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Perfil atualizado.");
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell
      title="Configurações"
      description="Perfil do usuário e preferências. A intensidade e a autonomia do Coach ficam registradas agora, mas ainda não influenciam nenhum comportamento."
    >
      {isLoading || !form ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <form
          className="panel max-w-2xl space-y-5 px-5 py-6"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="full_name">Nome</Label>
            <Input
              id="full_name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>E-mail</Label>
            <Input value={profile?.email ?? ""} disabled />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="target_area">Área de concursos</Label>
              <Input
                id="target_area"
                placeholder="Ex.: Fiscal estadual"
                value={form.target_area}
                onChange={(e) => setForm({ ...form, target_area: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="experience_level">Nível de experiência</Label>
              <Select
                value={form.experience_level}
                onValueChange={(v) => setForm({ ...form, experience_level: v })}
              >
                <SelectTrigger id="experience_level">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {EXPERIENCE_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="weekly">Disponibilidade semanal (horas)</Label>
              <Input
                id="weekly"
                type="number"
                min="0"
                step="0.5"
                value={form.weekly_availability_hours}
                onChange={(e) => setForm({ ...form, weekly_availability_hours: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Fuso horário</Label>
              <Input
                id="timezone"
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="coach_intensity">Intensidade do Coach</Label>
              <Select
                value={form.coach_intensity}
                onValueChange={(v) => setForm({ ...form, coach_intensity: v as CoachIntensity })}
              >
                <SelectTrigger id="coach_intensity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(COACH_INTENSITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="coach_autonomy">Autonomia do Coach</Label>
              <Select
                value={form.coach_autonomy}
                onValueChange={(v) => setForm({ ...form, coach_autonomy: v as CoachAutonomy })}
              >
                <SelectTrigger id="coach_autonomy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(COACH_AUTONOMY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button type="submit" disabled={save.isPending}>
            Salvar alterações
          </Button>
        </form>
      )}
      <div className="mt-6">
        <PreferencesPanel />
      </div>
    </AppShell>
  );
}
