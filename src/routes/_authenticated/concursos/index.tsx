import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONTEST_STATUS_LABELS, type ContestStatus } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/concursos/")({
  head: () => ({
    meta: [
      { title: "Meus Concursos — Aprovado Fiscal" },
      {
        name: "description",
        content:
          "Cadastre e acompanhe múltiplos concursos fiscais com órgão, banca e data de prova.",
      },
      { property: "og:title", content: "Meus Concursos — Aprovado Fiscal" },
      {
        property: "og:description",
        content: "Gestão de concursos acompanhados no Aprovado Fiscal.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ContestsPage,
});

const EMPTY_FORM = {
  name: "",
  organization: "",
  role_title: "",
  area: "",
  exam_board: "",
  exam_date: "",
  status: "futuro" as ContestStatus,
  description: "",
  edital_source_url: "",
};

function ContestsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: contests, isLoading } = useQuery({
    queryKey: ["contests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contests")
        .select("id, name, organization, role_title, exam_board, area, exam_date, status")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const createContest = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sessão expirada.");
      const { error } = await supabase.from("contests").insert({
        user_id: auth.user.id,
        name: form.name,
        organization: form.organization || null,
        role_title: form.role_title || null,
        area: form.area || null,
        exam_board: form.exam_board || null,
        exam_date: form.exam_date || null,
        status: form.status,
        description: form.description || null,
        edital_source_url: form.edital_source_url || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Concurso cadastrado.");
      setForm(EMPTY_FORM);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["contests"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell
      title="Meus Concursos"
      description="Você pode acompanhar vários concursos simultaneamente. Cada concurso é um contexto próprio sobre a mesma base de conhecimento."
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Novo concurso</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Novo concurso</DialogTitle>
              <DialogDescription>
                Apenas o nome é obrigatório. Os demais campos podem ser completados depois.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                createContest.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="organization">Órgão</Label>
                  <Input
                    id="organization"
                    value={form.organization}
                    onChange={(e) => setForm({ ...form, organization: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role_title">Cargo</Label>
                  <Input
                    id="role_title"
                    value={form.role_title}
                    onChange={(e) => setForm({ ...form, role_title: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="area">Área</Label>
                  <Input
                    id="area"
                    value={form.area}
                    onChange={(e) => setForm({ ...form, area: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exam_board">Banca</Label>
                  <Input
                    id="exam_board"
                    value={form.exam_board}
                    onChange={(e) => setForm({ ...form, exam_board: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exam_date">Data da prova</Label>
                  <Input
                    id="exam_date"
                    type="date"
                    value={form.exam_date}
                    onChange={(e) => setForm({ ...form, exam_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) => setForm({ ...form, status: v as ContestStatus })}
                  >
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CONTEST_STATUS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edital_source_url">Fonte do edital (URL)</Label>
                <Input
                  id="edital_source_url"
                  value={form.edital_source_url}
                  onChange={(e) => setForm({ ...form, edital_source_url: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Descrição</Label>
                <Textarea
                  id="description"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createContest.isPending}>
                  Salvar concurso
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !contests?.length ? (
        <EmptyState
          title="Nenhum concurso cadastrado"
          description="Cadastre o primeiro concurso para começar a organizar editais, matérias e tópicos."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {contests.map((contest) => (
            <li key={contest.id}>
              <Link
                to="/concursos/$contestId"
                params={{ contestId: contest.id }}
                className="panel block px-5 py-4 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display text-base font-semibold">{contest.name}</h2>
                  <Badge variant="outline">{CONTEST_STATUS_LABELS[contest.status]}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[contest.organization, contest.role_title, contest.exam_board]
                    .filter(Boolean)
                    .join(" · ") || "Sem detalhes adicionais"}
                </p>
                {contest.exam_date ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Prova: {new Date(contest.exam_date).toLocaleDateString("pt-BR")}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
