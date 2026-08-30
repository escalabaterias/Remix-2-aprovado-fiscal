import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { RotateCcw, Filter } from "lucide-react";

import {
  fetchQuestions,
  fetchAvailableFilterOptions,
  type FetchQuestionsOptions,
} from "@/lib/questions/service";
import { submitAnswer, type SubmitAnswerInput } from "@/lib/questions/attempt-service";
import { normalizeTrueFalseAnswer } from "@/lib/questions/engine";
import type { QuestionBankItem, QuestionFilter, FilterOptions } from "@/lib/questions/types";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_authenticated/questoes/")({
  validateSearch: (search: Record<string, unknown>) => ({
    subject: typeof search.subject === "string" ? search.subject : undefined,
    topic: typeof search.topic === "string" ? search.topic : undefined,
    board: typeof search.board === "string" ? search.board : undefined,
    year: typeof search.year === "string" ? search.year : undefined,
    contest: typeof search.contest === "string" ? search.contest : undefined,
    organization: typeof search.organization === "string" ? search.organization : undefined,
    role: typeof search.role === "string" ? search.role : undefined,
    type: typeof search.type === "string" ? search.type : undefined,
    difficulty: typeof search.difficulty === "string" ? search.difficulty : undefined,
    source: typeof search.source === "string" ? search.source : undefined,
    tags: typeof search.tags === "string" ? search.tags : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Banco de Questões — Aprovado Fiscal" },
      {
        name: "description",
        content:
          "Resolva questões filtradas por matéria, tópico, banca, ano, concurso, órgão, cargo e dificuldade com feedback imediato.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QuestoesPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

type Alternative = { label: string; text: string };

function parseAlternatives(raw: unknown[]): Alternative[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, idx) => {
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        let lbl = String.fromCharCode(65 + idx);
        if (typeof obj.label === "string" && obj.label.trim() !== "") {
          lbl = obj.label.trim();
        } else if (typeof obj.letter === "string" && obj.letter.trim() !== "") {
          lbl = obj.letter.trim();
        }
        return {
          label: lbl,
          text: typeof obj.text === "string" ? obj.text : String(obj.text ?? ""),
        };
      }
      if (typeof item === "string") {
        return { label: String.fromCharCode(65 + idx), text: item };
      }
      return null;
    })
    .filter((a): a is Alternative => a !== null);
}

function difficultyLabel(d: number | null): string {
  if (d === null) return "—";
  if (d <= 1) return "Muito fácil";
  if (d <= 2) return "Fácil";
  if (d <= 3) return "Média";
  if (d <= 4) return "Difícil";
  return "Muito difícil";
}

function accuracyPercent(accuracy: number): string {
  return `${(accuracy * 100).toFixed(0)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK: opções de filtro dinâmicas
// ─────────────────────────────────────────────────────────────────────────────

function useFilterOptions(activeFilters: QuestionFilter) {
  return useQuery<FilterOptions>({
    queryKey: ["questoes-filter-options", activeFilters.subjectId],
    staleTime: 60_000,
    queryFn: () => fetchAvailableFilterOptions(activeFilters),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

function QuestoesPage() {
  const queryClient = useQueryClient();
  const searchParams = Route.useSearch();
  const navigate = Route.useNavigate();

  // Filtros derivados dos search params da URL (com fallback "all")
  const subjectFilter = searchParams.subject ?? "all";
  const topicFilter = searchParams.topic ?? "all";
  const examBoardFilter = searchParams.board ?? "all";
  const yearFilter = searchParams.year ?? "all";
  const contestFilter = searchParams.contest ?? "all";
  const orgFilter = searchParams.organization ?? "all";
  const roleFilter = searchParams.role ?? "all";
  const typeFilter = searchParams.type ?? "all";
  const difficultyFilter = searchParams.difficulty ?? "all";
  const sourceFilter = searchParams.source ?? "all";
  const tagFilter = searchParams.tags ?? "";

  // Função para atualizar 1 filtro na URL
  const setFilterParam = useCallback(
    (key: string, value: string) => {
      navigate({
        search: (prev: Record<string, any>) => {
          const next = { ...prev };
          if (!value || value === "all") {
            delete next[key];
          } else {
            next[key] = value;
          }
          // Resetar tópico se alterar a matéria
          if (key === "subject") {
            delete next["topic"];
          }
          return next;
        },
        replace: true,
      });
    },
    [navigate],
  );

  const handleClearFilters = useCallback(() => {
    navigate({ search: {}, replace: true });
  }, [navigate]);

  // Questão aberta
  const [openQuestion, setOpenQuestion] = useState<QuestionBankItem | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string>("");
  const [submittedResult, setSubmittedResult] = useState<{
    isCorrect: boolean;
    correctAnswer: string | null;
    feedback: import("@/lib/questions/types").AttemptFeedback;
    explanation: string | null;
  } | null>(null);

  // IDs já respondidos nesta sessão de navegação
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());

  // Objeto QuestionFilter
  const questionFilter: QuestionFilter = useMemo(() => {
    const f: QuestionFilter = {};
    if (subjectFilter !== "all") f.subjectId = subjectFilter;
    if (topicFilter !== "all") f.topicId = topicFilter;
    if (examBoardFilter !== "all" && examBoardFilter.trim()) f.examBoard = examBoardFilter;
    if (yearFilter !== "all" && yearFilter.trim()) {
      const y = parseInt(yearFilter.trim(), 10);
      if (Number.isFinite(y)) f.year = y;
    }
    if (contestFilter !== "all" && contestFilter.trim()) f.contestId = contestFilter;
    if (orgFilter !== "all" && orgFilter.trim()) f.organization = orgFilter;
    if (roleFilter !== "all" && roleFilter.trim()) f.roleTitle = roleFilter;
    if (typeFilter === "true_false") f.isTrueFalse = true;
    if (typeFilter === "multiple_choice") f.isTrueFalse = false;
    if (difficultyFilter !== "all") {
      const d = parseInt(difficultyFilter, 10);
      if (Number.isFinite(d)) f.difficulty = d;
    }
    if (sourceFilter !== "all" && sourceFilter.trim()) f.sourceId = sourceFilter;
    if (tagFilter.trim()) {
      f.tags = tagFilter
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
    return f;
  }, [
    subjectFilter,
    topicFilter,
    examBoardFilter,
    yearFilter,
    contestFilter,
    orgFilter,
    roleFilter,
    typeFilter,
    difficultyFilter,
    sourceFilter,
    tagFilter,
  ]);

  const { data: filterOptions } = useFilterOptions(questionFilter);

  const fetchOpts: FetchQuestionsOptions = useMemo(
    () => ({ filter: questionFilter, limit: 200 }),
    [questionFilter],
  );

  const {
    data: questions,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["questoes-bank", fetchOpts],
    queryFn: () => fetchQuestions(fetchOpts),
  });

  // Tópicos filtrados por matéria
  const filteredTopicOptions = useMemo(() => {
    if (!filterOptions) return [];
    if (subjectFilter === "all") return filterOptions.topics;
    return filterOptions.topics.filter((t) => t.subjectId === subjectFilter);
  }, [filterOptions, subjectFilter]);

  // Contagem de filtros ativos
  const activeFilterCount = useMemo(() => {
    return Object.keys(questionFilter).length;
  }, [questionFilter]);

  // Submeter resposta
  const submitMutation = useMutation({
    mutationFn: async (input: SubmitAnswerInput) => submitAnswer(input),
    onSuccess: (result) => {
      if (!openQuestion) return;
      setSubmittedResult({
        isCorrect: result.feedback.isCorrect,
        correctAnswer: openQuestion.correctAnswer,
        feedback: result.feedback,
        explanation: openQuestion.explanation,
      });
      setAnsweredIds((prev) => new Set(prev).add(openQuestion.questionId));
      queryClient.invalidateQueries({ queryKey: ["questoes-bank"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSubmitAnswer = useCallback(() => {
    if (!openQuestion || !selectedAnswer) return;

    let isCorrect = false;
    if (openQuestion.isTrueFalse) {
      isCorrect =
        normalizeTrueFalseAnswer(selectedAnswer) ===
        normalizeTrueFalseAnswer(openQuestion.correctAnswer);
    } else {
      isCorrect = selectedAnswer === openQuestion.correctAnswer;
    }

    submitMutation.mutate({
      questionId: openQuestion.questionId,
      chosenAnswer: selectedAnswer,
      isCorrect,
      timeSpentSeconds: null,
      mode: "estudo",
    });
  }, [openQuestion, selectedAnswer, submitMutation]);

  const handleOpenQuestion = useCallback(
    (q: QuestionBankItem) => {
      setOpenQuestion(q);
      setSelectedAnswer("");
      if (answeredIds.has(q.questionId)) {
        setSubmittedResult({
          isCorrect: false,
          correctAnswer: q.correctAnswer,
          feedback: null as any,
          explanation: q.explanation,
        });
      } else {
        setSubmittedResult(null);
      }
    },
    [answeredIds],
  );

  const handleNextQuestion = useCallback(() => {
    if (!openQuestion || !questions) return;
    const currentIdx = questions.findIndex((q) => q.questionId === openQuestion.questionId);
    const nextIdx = currentIdx + 1;
    if (nextIdx < questions.length) {
      handleOpenQuestion(questions[nextIdx]!);
    } else {
      toast.info("Você chegou ao fim da lista de questões.");
    }
  }, [openQuestion, questions, handleOpenQuestion]);

  const handleBackToList = useCallback(() => {
    setOpenQuestion(null);
    setSelectedAnswer("");
    setSubmittedResult(null);
  }, []);

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <AppShell title="Banco de Questões">
        <p className="text-sm text-muted-foreground">Carregando questões…</p>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell title="Banco de Questões">
        <EmptyState
          title="Erro ao carregar questões"
          description="Não foi possível buscar as questões do banco. Tente novamente em alguns instantes."
        />
      </AppShell>
    );
  }

  // ── Questão aberta ────────────────────────────────────────────────────
  if (openQuestion) {
    return (
      <QuestionView
        question={openQuestion}
        selectedAnswer={selectedAnswer}
        onSelectAnswer={setSelectedAnswer}
        onSubmit={handleSubmitAnswer}
        isSubmitting={submitMutation.isPending}
        result={submittedResult}
        alreadyAnswered={answeredIds.has(openQuestion.questionId)}
        onNext={handleNextQuestion}
        onBack={handleBackToList}
        hasNext={
          questions != null &&
          questions.findIndex((q) => q.questionId === openQuestion.questionId) <
            questions.length - 1
        }
      />
    );
  }

  // ── Lista ─────────────────────────────────────────────────────────────
  return (
    <AppShell
      title="Banco de Questões"
      description="Filtre e resolva questões com metadados completos de Banca, Ano, Órgão, Cargo, Concurso e Matéria."
    >
      <div className="space-y-6">
        {/* Painel de Filtros Avançados */}
        <Card className="border-border/60 bg-card/40 backdrop-blur-xs">
          <CardHeader className="pb-3 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Filtros Avançados</CardTitle>
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="text-xs px-2 py-0.5">
                  {activeFilterCount} ativo(s)
                </Badge>
              )}
            </div>

            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Limpar filtros
              </Button>
            )}
          </CardHeader>

          <CardContent className="px-4 pb-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {/* 1. MATÉRIA */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Matéria</Label>
                <Select value={subjectFilter} onValueChange={(v) => setFilterParam("subject", v)}>
                  <SelectTrigger className="w-full text-xs h-9">
                    <SelectValue placeholder="Todas as matérias" />
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
              </div>

              {/* 2. TÓPICO (dependente de matéria) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Tópico</Label>
                <Select value={topicFilter} onValueChange={(v) => setFilterParam("topic", v)}>
                  <SelectTrigger className="w-full text-xs h-9">
                    <SelectValue placeholder="Todos os tópicos" />
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
              </div>

              {/* 3. BANCA */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Banca</Label>
                <Select value={examBoardFilter} onValueChange={(v) => setFilterParam("board", v)}>
                  <SelectTrigger className="w-full text-xs h-9">
                    <SelectValue placeholder="Todas as bancas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as bancas</SelectItem>
                    {(filterOptions?.examBoards ?? []).map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 4. ANO */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Ano</Label>
                <Select value={yearFilter} onValueChange={(v) => setFilterParam("year", v)}>
                  <SelectTrigger className="w-full text-xs h-9">
                    <SelectValue placeholder="Todos os anos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os anos</SelectItem>
                    {(filterOptions?.years ?? []).map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 5. CONCURSO */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Concurso</Label>
                <Select value={contestFilter} onValueChange={(v) => setFilterParam("contest", v)}>
                  <SelectTrigger className="w-full text-xs h-9">
                    <SelectValue placeholder="Todos os concursos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os concursos</SelectItem>
                    {(filterOptions?.contests ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 6. ÓRGÃO */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Órgão</Label>
                <Select value={orgFilter} onValueChange={(v) => setFilterParam("organization", v)}>
                  <SelectTrigger className="w-full text-xs h-9">
                    <SelectValue placeholder="Todos os órgãos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os órgãos</SelectItem>
                    {(filterOptions?.organizations ?? []).map((org) => (
                      <SelectItem key={org} value={org}>
                        {org}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 7. CARGO */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Cargo</Label>
                <Select value={roleFilter} onValueChange={(v) => setFilterParam("role", v)}>
                  <SelectTrigger className="w-full text-xs h-9">
                    <SelectValue placeholder="Todos os cargos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os cargos</SelectItem>
                    {(filterOptions?.roles ?? []).map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 8. TIPO DE QUESTÃO */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Tipo de Questão</Label>
                <Select value={typeFilter} onValueChange={(v) => setFilterParam("type", v)}>
                  <SelectTrigger className="w-full text-xs h-9">
                    <SelectValue placeholder="Todos os tipos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    <SelectItem value="multiple_choice">Múltipla Escolha</SelectItem>
                    <SelectItem value="true_false">Certo / Errado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 9. DIFICULDADE */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Dificuldade</Label>
                <Select
                  value={difficultyFilter}
                  onValueChange={(v) => setFilterParam("difficulty", v)}
                >
                  <SelectTrigger className="w-full text-xs h-9">
                    <SelectValue placeholder="Todas as dificuldades" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="1">1 — Muito fácil</SelectItem>
                    <SelectItem value="2">2 — Fácil</SelectItem>
                    <SelectItem value="3">3 — Média</SelectItem>
                    <SelectItem value="4">4 — Difícil</SelectItem>
                    <SelectItem value="5">5 — Muito difícil</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 10. FONTE / PROVA */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Fonte / Prova</Label>
                <Select value={sourceFilter} onValueChange={(v) => setFilterParam("source", v)}>
                  <SelectTrigger className="w-full text-xs h-9">
                    <SelectValue placeholder="Todas as fontes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as fontes</SelectItem>
                    {(filterOptions?.sources ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Resumo da Busca */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">
            {questions?.length ?? 0} questão(ões) encontrada(s)
          </p>
        </div>

        {/* Lista de questões */}
        {!questions || questions.length === 0 ? (
          <EmptyState
            title="Nenhuma questão encontrada"
            description="Não há questões no banco que satisfaçam a combinação dos filtros selecionados. Tente ajustar ou limpar os filtros."
          />
        ) : (
          <ul className="space-y-3">
            {questions.map((q, idx) => {
              const alts = parseAlternatives(q.alternatives);
              const wasAnswered = answeredIds.has(q.questionId);
              const metadataOrg =
                (q.metadata?.organization as string) || q.contest?.organization || null;
              const metadataRole =
                (q.metadata?.position as string) ||
                (q.metadata?.role_title as string) ||
                q.contest?.roleTitle ||
                null;
              const qNum = (q.metadata?.question_number as string | number) || null;

              return (
                <li key={q.questionId}>
                  <button
                    type="button"
                    onClick={() => handleOpenQuestion(q)}
                    className="w-full rounded-lg border border-border/70 bg-card p-4 text-left transition-all hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-start gap-2.5">
                          <span className="font-mono text-xs font-semibold text-primary pt-0.5">
                            #{idx + 1}
                          </span>
                          <p className="text-sm font-medium text-foreground leading-snug line-clamp-3">
                            {q.statement}
                          </p>
                        </div>

                        {/* Badges de Metadados Enriquecidos */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {q.examBoard && (
                            <Badge
                              variant="default"
                              className="text-[11px] font-semibold tracking-wide"
                            >
                              {q.examBoard}
                            </Badge>
                          )}
                          {q.year && (
                            <Badge variant="outline" className="text-[11px]">
                              {q.year}
                            </Badge>
                          )}
                          {metadataOrg && (
                            <Badge
                              variant="secondary"
                              className="text-[11px] bg-secondary/80 text-secondary-foreground"
                            >
                              {metadataOrg}
                            </Badge>
                          )}
                          {metadataRole && (
                            <Badge variant="outline" className="text-[11px] border-primary/30">
                              {metadataRole}
                            </Badge>
                          )}
                          {q.contestName && (
                            <Badge variant="outline" className="text-[11px]">
                              {q.contestName}
                            </Badge>
                          )}
                          {qNum && (
                            <Badge variant="outline" className="text-[11px] font-mono">
                              Q.{qNum}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[11px] capitalize">
                            {q.isTrueFalse ? "Certo/Errado" : "Múltipla Escolha"}
                          </Badge>
                          {q.difficulty !== null && (
                            <Badge variant="secondary" className="text-[11px]">
                              {difficultyLabel(q.difficulty)}
                            </Badge>
                          )}
                          {wasAnswered && (
                            <Badge variant="default" className="text-[11px]">
                              Respondida
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VISUALIZAÇÃO DE QUESTÃO
// ─────────────────────────────────────────────────────────────────────────────

function QuestionView({
  question,
  selectedAnswer,
  onSelectAnswer,
  onSubmit,
  isSubmitting,
  result,
  alreadyAnswered,
  onNext,
  onBack,
  hasNext,
}: {
  question: QuestionBankItem;
  selectedAnswer: string;
  onSelectAnswer: (v: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  result: {
    isCorrect: boolean;
    correctAnswer: string | null;
    feedback: import("@/lib/questions/types").AttemptFeedback | null;
    explanation: string | null;
  } | null;
  alreadyAnswered: boolean;
  onNext: () => void;
  onBack: () => void;
  hasNext: boolean;
}) {
  const alternatives = parseAlternatives(question.alternatives);
  const hasResult = result !== null;
  const isLocked = hasResult || alreadyAnswered;

  return (
    <AppShell
      title="Banco de Questões"
      description="Resolva a questão e veja o feedback."
      actions={
        <Button variant="outline" onClick={onBack}>
          Voltar à lista
        </Button>
      }
    >
      <div className="space-y-6 max-w-3xl">
        {/* Metadados */}
        <div className="flex flex-wrap gap-2">
          {question.examBoard && <Badge variant="outline">{question.examBoard}</Badge>}
          {question.year && <Badge variant="outline">{question.year}</Badge>}
          {question.contestName && <Badge variant="outline">{question.contestName}</Badge>}
          {question.difficulty !== null && (
            <Badge variant="secondary">Dificuldade: {difficultyLabel(question.difficulty)}</Badge>
          )}
          {question.isTrueFalse && <Badge variant="secondary">Verdadeiro/Falso</Badge>}
          {question.stats && question.stats.totalAttempts > 0 && (
            <Badge variant={question.stats.accuracy >= 0.7 ? "default" : "destructive"}>
              {accuracyPercent(question.stats.accuracy)} em {question.stats.totalAttempts}{" "}
              tentativa(s)
            </Badge>
          )}
        </div>

        {/* Enunciado */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold leading-relaxed">
              {question.statement}
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            {alternatives.length > 0 ? (
              <RadioGroup
                value={selectedAnswer}
                onValueChange={(v) => {
                  if (!isLocked) onSelectAnswer(v);
                }}
                disabled={isLocked}
                className="space-y-2"
              >
                {alternatives.map((alt) => {
                  let extraClass = "";
                  let isThisCorrect = false;
                  let isThisSelectedButWrong = false;

                  if (hasResult) {
                    if (question.isTrueFalse) {
                      isThisCorrect =
                        normalizeTrueFalseAnswer(alt.label) ===
                          normalizeTrueFalseAnswer(result.correctAnswer) &&
                        normalizeTrueFalseAnswer(result.correctAnswer) !== null;
                      isThisSelectedButWrong =
                        !result.isCorrect &&
                        normalizeTrueFalseAnswer(alt.label) ===
                          normalizeTrueFalseAnswer(selectedAnswer) &&
                        normalizeTrueFalseAnswer(selectedAnswer) !== null;
                    } else {
                      isThisCorrect = alt.label === result.correctAnswer;
                      isThisSelectedButWrong = !result.isCorrect && alt.label === selectedAnswer;
                    }
                  }

                  if (isThisCorrect) {
                    extraClass = "border-green-500 bg-green-500/10";
                  } else if (isThisSelectedButWrong) {
                    extraClass = "border-destructive bg-destructive/10";
                  }

                  return (
                    <label
                      key={alt.label}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors ${
                        isLocked ? "cursor-default" : "hover:bg-muted/40"
                      } ${extraClass}`}
                    >
                      <RadioGroupItem
                        value={alt.label}
                        id={`alt-${alt.label}`}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="mr-2 font-mono text-xs font-semibold text-muted-foreground">
                          {alt.label})
                        </span>
                        <span className="text-sm">{alt.text}</span>
                      </div>
                    </label>
                  );
                })}
              </RadioGroup>
            ) : (
              <p className="text-sm text-muted-foreground">
                Esta questão não possui alternativas cadastradas.
              </p>
            )}

            {/* Botão de envio */}
            {!isLocked && alternatives.length > 0 && (
              <Button
                onClick={onSubmit}
                disabled={!selectedAnswer || isSubmitting}
                className="mt-2"
              >
                {isSubmitting ? "Enviando…" : "Responder"}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Resultado / Feedback */}
        {hasResult && (
          <Card
            className={`border-2 ${
              result.isCorrect
                ? "border-green-500/50 bg-green-500/5"
                : "border-destructive/50 bg-destructive/5"
            }`}
          >
            <CardContent className="py-5 space-y-3">
              <div className="flex items-center gap-2">
                <Badge
                  variant={result.isCorrect ? "default" : "destructive"}
                  className="text-sm px-3 py-1"
                >
                  {result.isCorrect ? "Correto!" : "Incorreto"}
                </Badge>
                {result.correctAnswer && !result.isCorrect && (
                  <span className="text-sm text-muted-foreground">
                    Resposta correta:{" "}
                    <span className="font-semibold text-foreground">{result.correctAnswer}</span>
                  </span>
                )}
              </div>

              {/* Feedback do engine */}
              {result.feedback && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {result.feedback.isFirstAttempt && (
                    <Badge variant="outline">Primeira tentativa</Badge>
                  )}
                  {result.feedback.currentStreak !== 0 && (
                    <Badge variant="outline">
                      Sequência: {result.feedback.currentStreak > 0 ? "+" : ""}
                      {result.feedback.currentStreak}
                    </Badge>
                  )}
                  {result.feedback.shouldCreateError && (
                    <Badge variant="destructive">Erro registrado</Badge>
                  )}
                  {result.feedback.suggestedErrorCategory && (
                    <Badge variant="secondary">
                      Categoria sugerida: {result.feedback.suggestedErrorCategory}
                    </Badge>
                  )}
                </div>
              )}

              {/* Explicação */}
              {result.explanation && (
                <div className="mt-3">
                  <Separator className="mb-3" />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    Explicação
                  </p>
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {result.explanation}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Navegação */}
        {isLocked && (
          <div className="flex gap-2">
            {hasNext && <Button onClick={onNext}>Próxima questão</Button>}
            <Button variant="outline" onClick={onBack}>
              Voltar à lista
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
