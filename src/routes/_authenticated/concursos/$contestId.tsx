import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
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
import {
  CONTEST_STATUS_LABELS,
  EDITAL_STATUS_LABELS,
  PRIORITY_LABELS,
  type ContestStatus,
} from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/concursos/$contestId")({
  head: () => ({
    meta: [
      { title: "Concurso — Aprovado Fiscal" },
      {
        name: "description",
        content: "Editais, retificações e conteúdo do edital vinculados a um concurso acompanhado.",
      },
      { property: "og:title", content: "Concurso — Aprovado Fiscal" },
      { property: "og:description", content: "Detalhe do concurso no Aprovado Fiscal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ContestDetailPage,
});

function ContestDetailPage() {
  const { contestId } = Route.useParams();
  const queryClient = useQueryClient();

  const { data: contest, isLoading } = useQuery({
    queryKey: ["contest", contestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contests")
        .select("*")
        .eq("id", contestId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: editais } = useQuery({
    queryKey: ["editais", contestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("editais")
        .select("id, version, version_number, is_rectification, published_at, url, status, notes")
        .eq("contest_id", contestId)
        .order("version_number", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: subjects } = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subjects").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: contestTopics } = useQuery({
    queryKey: ["contest-topics", contestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contest_topics")
        .select(
          "id, priority, weight, in_edital, is_studied, notes, subject_id, topic_id, subjects(name), topics(name)",
        )
        .eq("contest_id", contestId)
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const updateStatus = useMutation({
    mutationFn: async (status: ContestStatus) => {
      const { error } = await supabase.from("contests").update({ status }).eq("id", contestId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status atualizado.");
      queryClient.invalidateQueries({ queryKey: ["contest", contestId] });
      queryClient.invalidateQueries({ queryKey: ["contests"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) {
    return (
      <AppShell title="Concurso">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </AppShell>
    );
  }

  if (!contest) {
    return (
      <AppShell title="Concurso não encontrado">
        <p className="text-sm text-muted-foreground">
          Este concurso não existe ou não pertence à sua conta.{" "}
          <Link to="/concursos" className="text-primary hover:underline">
            Voltar
          </Link>
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={contest.name}
      description={[contest.organization, contest.role_title, contest.exam_board]
        .filter(Boolean)
        .join(" · ")}
      actions={
        <Select
          value={contest.status}
          onValueChange={(v) => updateStatus.mutate(v as ContestStatus)}
        >
          <SelectTrigger className="w-40">
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
      }
    >
      <div className="space-y-6">
        <section className="panel grid gap-4 px-5 py-5 sm:grid-cols-3">
          <div>
            <p className="label-eyebrow">Data da prova</p>
            <p className="mt-1 text-sm">
              {contest.exam_date
                ? new Date(contest.exam_date).toLocaleDateString("pt-BR")
                : "Não definida"}
            </p>
          </div>
          <div>
            <p className="label-eyebrow">Área</p>
            <p className="mt-1 text-sm">{contest.area || "—"}</p>
          </div>
          <div>
            <p className="label-eyebrow">Fonte do edital</p>
            <p className="mt-1 truncate text-sm">{contest.edital_source_url || "—"}</p>
          </div>
        </section>

        <section className="panel px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="label-eyebrow">Editais</p>
              <h2 className="mt-1 font-display text-base font-semibold">
                Versões e retificações
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Cada versão é preservada. A comparação automática entre versões virá nas próximas
                etapas.
              </p>
            </div>
            <NewEditalDialog contestId={contestId} />
          </div>

          {!editais?.length ? (
            <p className="mt-4 text-sm text-muted-foreground">Nenhum edital cadastrado.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {editais.map((edital) => (
                <li key={edital.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Badge variant="outline">v{edital.version}</Badge>
                  <span className="text-sm">{EDITAL_STATUS_LABELS[edital.status]}</span>
                  {edital.is_rectification ? (
                    <Badge variant="secondary">retificação</Badge>
                  ) : null}
                  <span className="text-sm text-muted-foreground">
                    {edital.published_at
                      ? new Date(edital.published_at).toLocaleDateString("pt-BR")
                      : "sem data"}
                  </span>
                  {edital.url ? (
                    <a
                      href={edital.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      abrir fonte
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="label-eyebrow">Conteúdo do concurso</p>
              <h2 className="mt-1 font-display text-base font-semibold">
                Matérias e tópicos previstos
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                O mesmo tópico do catálogo pode ser vinculado a vários concursos, com prioridade e
                peso próprios.
              </p>
            </div>
            <NewContestTopicDialog contestId={contestId} subjects={subjects ?? []} />
          </div>

          {!contestTopics?.length ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Nenhum conteúdo vinculado a este concurso.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {contestTopics.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <span className="font-medium">{row.subjects?.name}</span>
                  {row.topics?.name ? (
                    <span className="text-muted-foreground">/ {row.topics.name}</span>
                  ) : null}
                  <Badge variant="outline">
                    Prioridade: {PRIORITY_LABELS[row.priority] ?? row.priority}
                  </Badge>
                  {row.weight != null ? (
                    <span className="text-muted-foreground">Peso {row.weight}</span>
                  ) : null}
                  {row.is_studied ? <Badge variant="secondary">estudado</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function NewEditalDialog({ contestId }: { contestId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("1");
  const [publishedAt, setPublishedAt] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [isRectification, setIsRectification] = useState("false");

  const create = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sessão expirada.");
      const parsed = Number.parseInt(version, 10);
      const { error } = await supabase.from("editais").insert({
        user_id: auth.user.id,
        contest_id: contestId,
        version,
        version_number: Number.isFinite(parsed) ? parsed : 1,
        is_rectification: isRectification === "true",
        status: isRectification === "true" ? "retificado" : "publicado",
        published_at: publishedAt || null,
        url: url || null,
        notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Edital cadastrado.");
      setOpen(false);
      setNotes("");
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["editais", contestId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Novo edital</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo edital</DialogTitle>
          <DialogDescription>
            Cadastre o edital original ou uma retificação como nova versão.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edital-version">Versão</Label>
              <Input
                id="edital-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edital-date">Data</Label>
              <Input
                id="edital-date"
                type="date"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edital-type">Tipo</Label>
            <Select value={isRectification} onValueChange={setIsRectification}>
              <SelectTrigger id="edital-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="false">Edital original / versão</SelectItem>
                <SelectItem value="true">Retificação</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edital-url">URL</Label>
            <Input id="edital-url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edital-notes">Observações</Label>
            <Textarea
              id="edital-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewContestTopicDialog({
  contestId,
  subjects,
}: {
  contestId: string;
  subjects: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [topicId, setTopicId] = useState("none");
  const [priority, setPriority] = useState("3");
  const [weight, setWeight] = useState("");

  const { data: topics } = useQuery({
    queryKey: ["topics", subjectId],
    enabled: !!subjectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topics")
        .select("id, name")
        .eq("subject_id", subjectId)
        .order("depth")
        .order("position")
        .limit(300);
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sessão expirada.");
      const { error } = await supabase.from("contest_topics").insert({
        user_id: auth.user.id,
        contest_id: contestId,
        subject_id: subjectId,
        topic_id: topicId === "none" ? null : topicId,
        priority: Number(priority),
        weight: weight ? Number(weight) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conteúdo vinculado ao concurso.");
      setOpen(false);
      setTopicId("none");
      setWeight("");
      queryClient.invalidateQueries({ queryKey: ["contest-topics", contestId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!subjects.length}>
          Vincular conteúdo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular conteúdo</DialogTitle>
          <DialogDescription>
            Use o catálogo global de matérias e tópicos, sem duplicar conhecimento.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!subjectId) {
              toast.error("Selecione uma matéria.");
              return;
            }
            create.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="ct-subject">Matéria</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger id="ct-subject">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-topic">Tópico</Label>
            <Select value={topicId} onValueChange={setTopicId} disabled={!subjectId}>
              <SelectTrigger id="ct-topic">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Matéria inteira</SelectItem>
                {(topics ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ct-priority">Prioridade</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="ct-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ct-weight">Peso</Label>
              <Input
                id="ct-weight"
                type="number"
                step="0.5"
                min="0"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
