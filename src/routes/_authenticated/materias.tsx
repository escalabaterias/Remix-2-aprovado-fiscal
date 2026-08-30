import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { TOPIC_KIND_LABELS, type TopicKind } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/materias")({
  head: () => ({
    meta: [
      { title: "Matérias e Tópicos — Aprovado Fiscal" },
      {
        name: "description",
        content:
          "Catálogo de matérias, tópicos hierárquicos e pré-requisitos reutilizáveis entre concursos.",
      },
      { property: "og:title", content: "Matérias e Tópicos — Aprovado Fiscal" },
      {
        property: "og:description",
        content: "Base de conhecimento independente de concurso: matérias, tópicos e pré-requisitos.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SubjectsPage,
});

type TopicRow = {
  id: string;
  name: string;
  parent_id: string | null;
  kind: TopicKind;
  depth: number;
  subject_id: string;
};

function buildTree(topics: TopicRow[]) {
  const byParent = new Map<string | null, TopicRow[]>();
  for (const topic of topics) {
    const list = byParent.get(topic.parent_id) ?? [];
    list.push(topic);
    byParent.set(topic.parent_id, list);
  }
  return byParent;
}

function SubjectsPage() {
  const queryClient = useQueryClient();
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);

  const { data: subjects, isLoading } = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subjects")
        .select("id, name, area, is_quantitative")
        .order("name")
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const activeSubject = selectedSubject ?? subjects?.[0]?.id ?? null;

  const { data: topics } = useQuery({
    queryKey: ["topics", activeSubject],
    enabled: !!activeSubject,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topics")
        .select("id, name, parent_id, kind, depth, subject_id")
        .eq("subject_id", activeSubject!)
        .order("depth")
        .order("position")
        .limit(500);
      if (error) throw error;
      return data as TopicRow[];
    },
  });

  const { data: prerequisites } = useQuery({
    queryKey: ["prerequisites", activeSubject],
    enabled: !!topics?.length,
    queryFn: async () => {
      const ids = (topics ?? []).map((t) => t.id);
      const { data, error } = await supabase
        .from("topic_prerequisites")
        .select("id, topic_id, prerequisite_topic_id, strength")
        .in("topic_id", ids)
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  const tree = useMemo(() => buildTree(topics ?? []), [topics]);
  const topicName = useMemo(
    () => new Map((topics ?? []).map((t) => [t.id, t.name])),
    [topics],
  );

  const createSubject = useMutation({
    mutationFn: async (payload: { name: string; area: string; is_quantitative: boolean }) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sessão expirada.");
      const { error } = await supabase.from("subjects").insert({
        name: payload.name,
        area: payload.area || null,
        is_quantitative: payload.is_quantitative,
        created_by: auth.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Matéria cadastrada.");
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createTopic = useMutation({
    mutationFn: async (payload: { name: string; parent_id: string | null; kind: TopicKind }) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user || !activeSubject) throw new Error("Selecione uma matéria.");
      const parent = (topics ?? []).find((t) => t.id === payload.parent_id);
      const { error } = await supabase.from("topics").insert({
        subject_id: activeSubject,
        parent_id: payload.parent_id,
        name: payload.name,
        kind: payload.kind,
        depth: parent ? parent.depth + 1 : 0,
        created_by: auth.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tópico cadastrado.");
      queryClient.invalidateQueries({ queryKey: ["topics", activeSubject] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createPrereq = useMutation({
    mutationFn: async (payload: { topic_id: string; prerequisite_topic_id: string }) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sessão expirada.");
      const { error } = await supabase.from("topic_prerequisites").insert({
        ...payload,
        created_by: auth.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pré-requisito registrado.");
      queryClient.invalidateQueries({ queryKey: ["prerequisites", activeSubject] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell
      title="Matérias e Tópicos"
      description="O catálogo existe independentemente dos concursos: o mesmo tópico serve a vários editais, sem duplicar conhecimento."
      actions={<NewSubjectDialog onSubmit={(p) => createSubject.mutate(p)} />}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !subjects?.length ? (
        <EmptyState
          title="Nenhuma matéria cadastrada"
          description="Cadastre matérias como Direito Tributário ou Raciocínio Lógico-Matemático para começar a estruturar tópicos."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <aside className="panel h-fit px-3 py-3">
            <p className="label-eyebrow px-2 pb-2">Matérias</p>
            <ul className="space-y-0.5">
              {subjects.map((subject) => (
                <li key={subject.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedSubject(subject.id)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors ${
                      subject.id === activeSubject
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    }`}
                  >
                    <span className="truncate">{subject.name}</span>
                    {subject.is_quantitative ? (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        exatas
                      </Badge>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="space-y-6">
            <section className="panel px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="label-eyebrow">Hierarquia</p>
                  <h2 className="mt-1 font-display text-base font-semibold">
                    Tópicos, subtópicos e conceitos
                  </h2>
                </div>
                <NewTopicDialog
                  topics={topics ?? []}
                  onSubmit={(p) => createTopic.mutate(p)}
                  disabled={!activeSubject}
                />
              </div>

              {!topics?.length ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  Nenhum tópico nesta matéria. A profundidade da hierarquia não é limitada.
                </p>
              ) : (
                <TopicTree byParent={tree} parentId={null} />
              )}
            </section>

            <section className="panel px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="label-eyebrow">Pré-requisitos</p>
                  <h2 className="mt-1 font-display text-base font-semibold">
                    Dependências entre conteúdos
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Opcional. Recomendado principalmente para matérias quantitativas.
                  </p>
                </div>
                <NewPrereqDialog
                  topics={topics ?? []}
                  onSubmit={(p) => createPrereq.mutate(p)}
                  disabled={(topics ?? []).length < 2}
                />
              </div>

              {!prerequisites?.length ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  Nenhum pré-requisito registrado nesta matéria.
                </p>
              ) : (
                <ul className="mt-4 space-y-2 text-sm">
                  {prerequisites.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {topicName.get(p.prerequisite_topic_id) ?? "—"}
                      </span>
                      <span className="text-primary">→</span>
                      <span>{topicName.get(p.topic_id) ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function TopicTree({
  byParent,
  parentId,
}: {
  byParent: Map<string | null, TopicRow[]>;
  parentId: string | null;
}) {
  const items = byParent.get(parentId) ?? [];
  if (!items.length) return null;

  return (
    <ul className={parentId ? "ml-4 border-l border-border pl-4" : "mt-4 space-y-1"}>
      {items.map((topic) => (
        <li key={topic.id} className="py-1">
          <div className="flex items-center gap-2">
            <span className="text-sm">{topic.name}</span>
            <Badge variant="outline" className="text-[10px] font-normal">
              {TOPIC_KIND_LABELS[topic.kind]}
            </Badge>
          </div>
          <TopicTree byParent={byParent} parentId={topic.id} />
        </li>
      ))}
    </ul>
  );
}

function NewSubjectDialog({
  onSubmit,
}: {
  onSubmit: (p: { name: string; area: string; is_quantitative: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [quant, setQuant] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Nova matéria</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova matéria</DialogTitle>
          <DialogDescription>
            Matérias são globais e independentes de concurso.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ name, area, is_quantitative: quant });
            setName("");
            setArea("");
            setQuant(false);
            setOpen(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="subject-name">Nome</Label>
            <Input
              id="subject-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subject-area">Área</Label>
            <Input
              id="subject-area"
              placeholder="Ex.: Direito, Exatas, Linguagens"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label htmlFor="subject-quant" className="text-sm font-normal">
              Matéria quantitativa (exatas)
            </Label>
            <Switch id="subject-quant" checked={quant} onCheckedChange={setQuant} />
          </div>
          <DialogFooter>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewTopicDialog({
  topics,
  onSubmit,
  disabled,
}: {
  topics: TopicRow[];
  onSubmit: (p: { name: string; parent_id: string | null; kind: TopicKind }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("root");
  const [kind, setKind] = useState<TopicKind>("topico");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Novo tópico
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo tópico</DialogTitle>
          <DialogDescription>
            Escolha um tópico pai para criar subtópicos e conceitos.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ name, parent_id: parent === "root" ? null : parent, kind });
            setName("");
            setParent("root");
            setKind("topico");
            setOpen(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="topic-name">Nome</Label>
            <Input id="topic-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="topic-parent">Tópico pai</Label>
            <Select value={parent} onValueChange={setParent}>
              <SelectTrigger id="topic-parent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root">Nenhum (nível da matéria)</SelectItem>
                {topics.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="topic-kind">Natureza</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as TopicKind)}>
              <SelectTrigger id="topic-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TOPIC_KIND_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewPrereqDialog({
  topics,
  onSubmit,
  disabled,
}: {
  topics: TopicRow[];
  onSubmit: (p: { topic_id: string; prerequisite_topic_id: string }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [topicId, setTopicId] = useState("");
  const [prereqId, setPrereqId] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Novo pré-requisito
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo pré-requisito</DialogTitle>
          <DialogDescription>
            Registre que um conteúdo depende do domínio de outro.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!topicId || !prereqId || topicId === prereqId) {
              toast.error("Selecione dois tópicos diferentes.");
              return;
            }
            onSubmit({ topic_id: topicId, prerequisite_topic_id: prereqId });
            setTopicId("");
            setPrereqId("");
            setOpen(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="prereq-base">Pré-requisito (base)</Label>
            <Select value={prereqId} onValueChange={setPrereqId}>
              <SelectTrigger id="prereq-base">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {topics.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prereq-target">Depende dele</Label>
            <Select value={topicId} onValueChange={setTopicId}>
              <SelectTrigger id="prereq-target">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {topics.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
