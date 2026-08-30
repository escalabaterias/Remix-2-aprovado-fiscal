import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { toast } from "sonner";

import {
  fetchPrioritizedErrors,
  fetchTopicErrorSummaries,
  resolveErrorEntry,
  type ErrorCentralFilter,
} from "@/lib/error-central/service";
import type { PrioritizedError } from "@/lib/error-central/engine";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_authenticated/central-erros/")({
  head: () => ({
    meta: [
      { title: "Central de Erros — Aprovado Fiscal" },
      {
        name: "description",
        content:
          "Visualize, filtre e analise seus erros por matéria, tópico e categoria com priorização inteligente.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CentralErrosPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "all", label: "Todos" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "unresolved", label: "Não resolvidos" },
  { value: "resolved", label: "Resolvidos" },
];

const ERROR_CATEGORY_LABELS: Record<string, string> = {
  desconhecimento: "Desconhecimento",
  confusao_conceitual: "Confusão conceitual",
  interpretacao: "Interpretação",
  desatencao: "Desatenção",
  procedimento: "Procedimento/Raciocínio",
  chute: "Dúvida/Chute",
  excecao_detalhe: "Exceção/Detalhe",
  recorrente: "Recorrente",
};

function categoryLabel(cat: string | null): string {
  if (!cat) return "Sem categoria";
  return ERROR_CATEGORY_LABELS[cat] ?? cat;
}

function priorityColor(score: number): string {
  if (score >= 0.7) return "text-destructive";
  if (score >= 0.4) return "text-orange-600";
  return "text-muted-foreground";
}

function priorityBorder(score: number): string {
  if (score >= 0.7) return "border-destructive/40";
  if (score >= 0.4) return "border-orange-400/40";
  return "border-border";
}

function priorityBadgeVariant(score: number): "destructive" | "outline" | "secondary" {
  if (score >= 0.7) return "destructive";
  if (score >= 0.4) return "outline";
  return "secondary";
}

function formatScore(score: number): string {
  return (score * 100).toFixed(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK: buscar nomes de matérias e tópicos para os filtros
// ─────────────────────────────────────────────────────────────────────────────

type SubjectOption = { id: string; name: string };
type TopicOption = { id: string; name: string; subjectId: string | null };

function useFilterOptions() {
  return useQuery({
    queryKey: ["central-erros-filter-options"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [subjectsRes, topicsRes] = await Promise.all([
        supabase.from("subjects").select("id, name").order("name"),
        supabase.from("topics").select("id, name, subject_id").order("name"),
      ]);
      const subjects: SubjectOption[] = (subjectsRes.data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
      }));
      const topics: TopicOption[] = (topicsRes.data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        subjectId: t.subject_id,
      }));
      return { subjects, topics };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

function CentralErrosPage() {
  const queryClient = useQueryClient();

  // Filtros locais
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<string>("30");
  const [activeTab, setActiveTab] = useState<"errors" | "topics">("errors");

  // Opções de filtro
  const { data: filterOptions } = useFilterOptions();

  // Montar filtro para o service (status e período vão para o banco)
  const serviceFilter: ErrorCentralFilter = useMemo(() => {
    const f: ErrorCentralFilter = {};
    if (statusFilter !== "all") f.status = statusFilter as "resolved" | "unresolved";
    if (periodFilter !== "all") f.periodDays = parseInt(periodFilter, 10);
    return f;
  }, [statusFilter, periodFilter]);

  // Buscar erros priorizados
  const {
    data: prioritizedErrors,
    isLoading: loadingErrors,
    isError: errorLoadingErrors,
  } = useQuery({
    queryKey: ["central-erros-prioritized", serviceFilter],
    queryFn: () => fetchPrioritizedErrors(serviceFilter),
  });

  // Buscar resumos por tópico
  const {
    data: topicSummaries,
    isLoading: loadingTopics,
    isError: errorLoadingTopics,
  } = useQuery({
    queryKey: ["central-erros-topic-summaries", serviceFilter],
    queryFn: () => fetchTopicErrorSummaries(serviceFilter),
  });

  // Resolver erro
  const resolveMutation = useMutation({
    mutationFn: (errorId: string) => resolveErrorEntry(errorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["central-erros-prioritized"] });
      queryClient.invalidateQueries({ queryKey: ["central-erros-topic-summaries"] });
      toast.success("Erro marcado como resolvido.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Filtros locais sobre o resultado (matéria, tópico, categoria)
  const allErrors = prioritizedErrors ?? [];

  const filtered = useMemo(() => {
    return allErrors.filter((pe) => {
      if (subjectFilter !== "all" && pe.error.subjectId !== subjectFilter) return false;
      if (topicFilter !== "all" && pe.error.topicId !== topicFilter) return false;
      if (categoryFilter !== "all" && pe.error.category !== categoryFilter) return false;
      return true;
    });
  }, [allErrors, subjectFilter, topicFilter, categoryFilter]);

  // Extrair categorias presentes para o filtro
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const pe of allErrors) {
      if (pe.error.category) cats.add(pe.error.category);
    }
    return Array.from(cats).sort();
  }, [allErrors]);

  // Tópicos filtrados por matéria selecionada
  const filteredTopicOptions = useMemo(() => {
    if (!filterOptions) return [];
    if (subjectFilter === "all") return filterOptions.topics;
    return filterOptions.topics.filter((t) => t.subjectId === subjectFilter);
  }, [filterOptions, subjectFilter]);

  // Métricas
  const totalErrors = filtered.length;
  const unresolvedErrors = filtered.filter((pe) => !pe.error.isResolved).length;
  const highPriorityCount = filtered.filter((pe) => pe.score >= 0.7).length;
  const avgScore =
    filtered.length > 0
      ? filtered.reduce((sum, pe) => sum + pe.score, 0) / filtered.length
      : 0;

  // Resumos de tópico filtrados por matéria
  const filteredSummaries = useMemo(() => {
    if (!topicSummaries) return [];
    if (subjectFilter === "all") return topicSummaries;
    return topicSummaries.filter((s) => s.subjectId === subjectFilter);
  }, [topicSummaries, subjectFilter]);

  const isLoading = loadingErrors || loadingTopics;
  const hasError = errorLoadingErrors || errorLoadingTopics;

  if (isLoading) {
    return (
      <AppShell title="Central de Erros">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </AppShell>
    );
  }

  if (hasError) {
    return (
      <AppShell title="Central de Erros">
        <EmptyState
          title="Erro ao carregar dados"
          description="Não foi possível carregar os erros. Tente novamente em alguns instantes."
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Central de Erros"
      description="Erros priorizados pelo motor inteligente. Identifique padrões e resolva os mais críticos primeiro."
    >
      <div className="space-y-6">
        {/* Métricas */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total de erros
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{totalErrors}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Não resolvidos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-destructive">{unresolvedErrors}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Alta prioridade
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-orange-600">{highPriorityCount}</p>
              <p className="text-xs text-muted-foreground">score ≥ 70</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Prioridade média
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <p className={`text-2xl font-semibold ${priorityColor(avgScore)}`}>
                  {formatScore(avgScore)}
                </p>
                <Progress value={avgScore * 100} className="flex-1" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-3">
          <Select value={periodFilter} onValueChange={setPeriodFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={subjectFilter}
            onValueChange={(v) => {
              setSubjectFilter(v);
              setTopicFilter("all");
            }}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Matéria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as matérias</SelectItem>
              {(filterOptions?.subjects ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={topicFilter} onValueChange={setTopicFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Tópico" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tópicos</SelectItem>
              {filteredTopicOptions.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              {availableCategories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {categoryLabel(cat)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Tabs: Erros / Resumo por Tópico */}
        <div className="flex gap-2">
          <Button
            variant={activeTab === "errors" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("errors")}
          >
            Erros ({filtered.length})
          </Button>
          <Button
            variant={activeTab === "topics" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("topics")}
          >
            Resumo por Tópico ({filteredSummaries.length})
          </Button>
        </div>

        {/* Lista de erros priorizados */}
        {activeTab === "errors" && (
          <ErrorList
            errors={filtered}
            onResolve={(id) => resolveMutation.mutate(id)}
            isResolving={resolveMutation.isPending}
          />
        )}

        {/* Resumos por tópico */}
        {activeTab === "topics" && <TopicSummariesList summaries={filteredSummaries} />}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTA DE ERROS PRIORIZADOS
// ─────────────────────────────────────────────────────────────────────────────

function ErrorList({
  errors,
  onResolve,
  isResolving,
}: {
  errors: PrioritizedError[];
  onResolve: (id: string) => void;
  isResolving: boolean;
}) {
  if (errors.length === 0) {
    return (
      <EmptyState
        title="Nenhum erro encontrado"
        description="Não há erros registrados para os filtros selecionados. Continue resolvendo questões para alimentar o histórico."
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {errors.length} erro(s) ordenados por prioridade
      </p>
      <ul className="space-y-2">
        {errors.slice(0, 50).map((pe) => (
          <li
            key={pe.error.id}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 ${priorityBorder(pe.score)}`}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {/* Score badge */}
                <Badge variant={priorityBadgeVariant(pe.score)} className="font-mono text-xs">
                  {formatScore(pe.score)}
                </Badge>

                <span className="text-sm font-medium">
                  {pe.error.subjectId ? "Matéria" : ""}
                  {pe.error.topicId ? " — Tópico" : ""}
                </span>

                {pe.error.category && (
                  <Badge variant="secondary" className="text-xs">
                    {categoryLabel(pe.error.category)}
                  </Badge>
                )}

                <Badge
                  variant={pe.error.isResolved ? "default" : "destructive"}
                  className="text-xs"
                >
                  {pe.error.isResolved ? "Resolvido" : "Não resolvido"}
                </Badge>

                {pe.factors.recurrence === 1 && (
                  <Badge variant="outline" className="text-xs border-orange-400 text-orange-600">
                    Recorrente
                  </Badge>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                {new Date(pe.error.occurredAt).toLocaleDateString("pt-BR")}
                {" · "}
                Recência {(pe.factors.recency * 100).toFixed(0)}%
                {" · "}
                Impacto {(pe.factors.masteryImpact * 100).toFixed(0)}%
                {" · "}
                Frequência {(pe.factors.categoryFrequency * 100).toFixed(0)}%
              </p>
            </div>

            <div className="flex gap-2">
              {!pe.error.isResolved && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isResolving}
                  onClick={() => onResolve(pe.error.id)}
                >
                  Resolver
                </Button>
              )}
              <Button asChild size="sm" variant="ghost">
                <Link to="/central-erros/$errorId" params={{ errorId: pe.error.id }}>
                  Detalhe
                </Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {errors.length > 50 && (
        <p className="text-xs text-muted-foreground mt-2">
          Exibindo os 50 de maior prioridade de {errors.length}.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESUMOS POR TÓPICO
// ─────────────────────────────────────────────────────────────────────────────

import type { TopicErrorSummaryWithMeta } from "@/lib/error-central/service";

function TopicSummariesList({ summaries }: { summaries: TopicErrorSummaryWithMeta[] }) {
  if (summaries.length === 0) {
    return (
      <EmptyState
        title="Nenhum resumo disponível"
        description="Não há erros agrupados por tópico para os filtros selecionados."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {summaries.length} tópico(s) com erros, ordenados por prioridade máxima
      </p>
      <div className="space-y-3">
        {summaries.map((s) => {
          const dominantCategories = Array.from(s.analysis.categoryFrequency.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);

          return (
            <Card key={s.topicId} className={priorityBorder(s.maxPriority)}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{s.topicName}</CardTitle>
                    <p className="text-xs text-muted-foreground">{s.subjectName}</p>
                  </div>
                  <Badge variant={priorityBadgeVariant(s.maxPriority)} className="font-mono">
                    Máx {formatScore(s.maxPriority)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Erros</p>
                    <p className="text-sm font-semibold">{s.errorCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Prioridade média</p>
                    <p className={`text-sm font-semibold ${priorityColor(s.avgPriority)}`}>
                      {formatScore(s.avgPriority)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Recorrência</p>
                    <p className="text-sm font-semibold">
                      {s.analysis.recurrenceRate > 0
                        ? `${(s.analysis.recurrenceRate * 100).toFixed(0)}%`
                        : "0%"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Não resolvidos</p>
                    <p className="text-sm font-semibold text-destructive">
                      {s.analysis.unresolvedCount}
                    </p>
                  </div>
                </div>

                {dominantCategories.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Categorias dominantes</p>
                    <div className="flex flex-wrap gap-1">
                      {dominantCategories.map(([cat, count]) => (
                        <Badge key={cat} variant="secondary" className="text-xs">
                          {categoryLabel(cat)}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <Progress value={s.maxPriority * 100} className="h-1.5" />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
