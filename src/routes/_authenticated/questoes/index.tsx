import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";

import { fetchQuestions, type FetchQuestionsOptions } from "@/lib/questions/service";
import { submitAnswer, type SubmitAnswerInput } from "@/lib/questions/attempt-service";
import { normalizeTrueFalseAnswer } from "@/lib/questions/engine";
import type { QuestionBankItem, QuestionFilter } from "@/lib/questions/types";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  head: () => ({
    meta: [
      { title: "Banco de Questões — Aprovado Fiscal" },
      {
        name: "description",
        content:
          "Resolva questões filtradas por matéria, tópico, banca, ano e dificuldade com feedback imediato.",
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
// HOOK: opções de filtro (matérias, tópicos)
// ─────────────────────────────────────────────────────────────────────────────

type SubjectOption = { id: string; name: string };
type TopicOption = { id: string; name: string; subjectId: string | null };

function useFilterOptions() {
  return useQuery({
    queryKey: ["questoes-filter-options"],
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

function QuestoesPage() {
  const queryClient = useQueryClient();

  // Filtros
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [examBoardFilter, setExamBoardFilter] = useState<string>("");
  const [yearFilter, setYearFilter] = useState<string>("");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("");

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

  const { data: filterOptions } = useFilterOptions();

  // Montar filtro
  const questionFilter: QuestionFilter = useMemo(() => {
    const f: QuestionFilter = {};
    if (subjectFilter !== "all") f.subjectId = subjectFilter;
    if (topicFilter !== "all") f.topicId = topicFilter;
    if (examBoardFilter.trim()) f.examBoard = examBoardFilter.trim();
    if (yearFilter.trim()) {
      const y = parseInt(yearFilter.trim(), 10);
      if (Number.isFinite(y)) {
        f.yearMin = y;
        f.yearMax = y;
      }
    }
    if (difficultyFilter !== "all") {
      const d = parseInt(difficultyFilter, 10);
      if (Number.isFinite(d)) {
        f.difficultyMin = d;
        f.difficultyMax = d;
      }
    }
    if (tagFilter.trim()) {
      f.tags = tagFilter
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
    return f;
  }, [subjectFilter, topicFilter, examBoardFilter, yearFilter, difficultyFilter, tagFilter]);

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
      // Se já respondeu nesta sessão, restaurar estado
      if (answeredIds.has(q.questionId)) {
        setSubmittedResult({
          isCorrect: false, // placeholder — será recalculado na UI pela badge da lista
          correctAnswer: q.correctAnswer,
          feedback: null as any, // indicar que veio do cache local
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
      description="Resolva questões com feedback imediato. Filtre por matéria, tópico, banca, ano ou dificuldade."
    >
      <div className="space-y-6">
        {/* Filtros */}
        <div className="flex flex-wrap gap-3">
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

          <div className="flex items-end gap-1">
            <div className="space-y-1">
              <Label htmlFor="examBoard" className="text-xs text-muted-foreground">
                Banca
              </Label>
              <Input
                id="examBoard"
                className="w-[140px]"
                placeholder="Ex: CESPE"
                value={examBoardFilter}
                onChange={(e) => setExamBoardFilter(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-end gap-1">
            <div className="space-y-1">
              <Label htmlFor="year" className="text-xs text-muted-foreground">
                Ano
              </Label>
              <Input
                id="year"
                className="w-[100px]"
                placeholder="Ex: 2024"
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
              />
            </div>
          </div>

          <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Dificuldade" />
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

          <div className="flex items-end gap-1">
            <div className="space-y-1">
              <Label htmlFor="tags" className="text-xs text-muted-foreground">
                Tags
              </Label>
              <Input
                id="tags"
                className="w-[180px]"
                placeholder="tag1, tag2"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Resumo */}
        <p className="text-sm text-muted-foreground">
          {questions?.length ?? 0} questão(ões) encontrada(s)
        </p>

        {/* Lista de questões */}
        {!questions || questions.length === 0 ? (
          <EmptyState
            title="Nenhuma questão encontrada"
            description="Não há questões no banco para os filtros selecionados. Ajuste os filtros ou adicione questões ao banco."
          />
        ) : (
          <ul className="space-y-2">
            {questions.map((q, idx) => {
              const alts = parseAlternatives(q.alternatives);
              const wasAnswered = answeredIds.has(q.questionId);
              return (
                <li key={q.questionId}>
                  <button
                    type="button"
                    onClick={() => handleOpenQuestion(q)}
                    className="w-full rounded-md border border-border px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {idx + 1}.
                          </span>
                          <p className="text-sm font-medium text-foreground line-clamp-2">
                            {q.statement}
                          </p>
                        </div>
                        <div className="mt-1.5 ml-5 flex flex-wrap gap-1.5">
                          {q.examBoard && (
                            <Badge variant="outline" className="text-xs">
                              {q.examBoard}
                            </Badge>
                          )}
                          {q.year && (
                            <Badge variant="outline" className="text-xs">
                              {q.year}
                            </Badge>
                          )}
                          {q.difficulty !== null && (
                            <Badge variant="secondary" className="text-xs">
                              {difficultyLabel(q.difficulty)}
                            </Badge>
                          )}
                          {alts.length > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              {alts.length} alternativas
                            </Badge>
                          )}
                          {q.stats && q.stats.totalAttempts > 0 && (
                            <Badge
                              variant={q.stats.accuracy >= 0.7 ? "default" : "destructive"}
                              className="text-xs"
                            >
                              {accuracyPercent(q.stats.accuracy)} em {q.stats.totalAttempts}{" "}
                              tentativa(s)
                            </Badge>
                          )}
                          {wasAnswered && (
                            <Badge variant="default" className="text-xs">
                              Respondida
                            </Badge>
                          )}
                          {q.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
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
