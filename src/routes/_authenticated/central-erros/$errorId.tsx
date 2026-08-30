import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_authenticated/central-erros/$errorId")({
  head: () => ({
    meta: [{ title: "Detalhe do Erro — Aprovado Fiscal" }, { name: "robots", content: "noindex" }],
  }),
  component: ErrorDetailPage,
});

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

function ErrorDetailPage() {
  const { errorId } = useParams({ from: "/_authenticated/central-erros/$errorId" });
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["error-detail", errorId],
    queryFn: async () => {
      const [errorRes, historyRes] = await Promise.all([
        supabase
          .from("error_entries")
          .select(
            "id, topic_id, subject_id, root_topic_id, category, is_resolved, resolved_at, occurred_at, attempt_id, question_id, diagnosis, intervention, notes, topics!topic_id(name), subjects(name)",
          )
          .eq("id", errorId)
          .maybeSingle(),
        // Fetch related errors (same topic + category)
        supabase
          .from("error_entries")
          .select("id, category, is_resolved, occurred_at, diagnosis")
          .order("occurred_at", { ascending: false })
          .limit(20),
      ]);

      if (errorRes.error) throw errorRes.error;
      if (!errorRes.data) throw new Error("Erro não encontrado.");

      const mainError = errorRes.data;
      const allErrors = historyRes.data ?? [];

      // Filter related: same topic + category, excluding self
      const related = allErrors.filter(
        (e) => e.id !== mainError.id && mainError.topic_id && mainError.category,
      );

      // Get question details if available
      let question = null;
      if (mainError.question_id) {
        const { data: q } = await supabase
          .from("questions")
          .select("id, statement, difficulty, exam_board, year")
          .eq("id", mainError.question_id)
          .maybeSingle();
        question = q;
      }

      return { error: mainError, related, question };
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("error_entries")
        .update({ is_resolved: true, resolved_at: new Date().toISOString() })
        .eq("id", errorId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["error-detail", errorId] });
      queryClient.invalidateQueries({ queryKey: ["central-erros"] });
      toast.success("Erro marcado como resolvido.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !data) {
    return (
      <AppShell title="Detalhe do Erro">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </AppShell>
    );
  }

  const { error: err, related, question } = data;

  return (
    <AppShell
      title="Detalhe do Erro"
      description={`${err.subjects?.name ?? "Matéria"}${err.topics?.name ? ` — ${err.topics.name}` : ""}`}
      actions={
        <Button asChild variant="outline">
          <Link to="/central-erros">Voltar</Link>
        </Button>
      }
    >
      <div className="space-y-6 max-w-3xl">
        {/* Main info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Informações do Erro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Matéria</p>
                <p className="text-sm font-medium">{err.subjects?.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tópico</p>
                <p className="text-sm font-medium">{err.topics?.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Data</p>
                <p className="text-sm font-medium">
                  {new Date(err.occurred_at).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Categoria</p>
                <p className="text-sm font-medium">
                  {err.category ? (ERROR_CATEGORY_LABELS[err.category] ?? err.category) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge variant={err.is_resolved ? "default" : "destructive"}>
                  {err.is_resolved ? "Resolvido" : "Não resolvido"}
                </Badge>
                {err.resolved_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Resolvido em {new Date(err.resolved_at).toLocaleDateString("pt-BR")}
                  </p>
                )}
              </div>
            </div>

            {err.diagnosis && (
              <div>
                <p className="text-xs text-muted-foreground">Diagnóstico</p>
                <p className="text-sm">{err.diagnosis}</p>
              </div>
            )}

            {err.intervention && (
              <div>
                <p className="text-xs text-muted-foreground">Intervenção</p>
                <p className="text-sm">{err.intervention}</p>
              </div>
            )}

            {err.notes && (
              <div>
                <p className="text-xs text-muted-foreground">Observações</p>
                <p className="text-sm">{err.notes}</p>
              </div>
            )}

            {!err.is_resolved && (
              <Button onClick={() => resolveMutation.mutate()} className="mt-2">
                Marcar como resolvido
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Question */}
        {question && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Questão Relacionada</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {question.statement && (
                <p className="text-sm whitespace-pre-wrap">{question.statement}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {question.exam_board && (
                  <Badge variant="outline">Banca: {question.exam_board}</Badge>
                )}
                {question.year && <Badge variant="outline">Ano: {question.year}</Badge>}
                {question.difficulty && (
                  <Badge variant="outline">Dificuldade: {question.difficulty}</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Separator />

        {/* Related errors history */}
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-3">
            Histórico de erros relacionados
          </p>
          {related.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum outro erro encontrado com mesmo tópico e categoria.
            </p>
          ) : (
            <ul className="space-y-2">
              {related.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={r.is_resolved ? "default" : "destructive"} className="text-xs">
                      {r.is_resolved ? "Resolvido" : "Aberto"}
                    </Badge>
                    <span className="text-muted-foreground">
                      {new Date(r.occurred_at).toLocaleDateString("pt-BR")}
                    </span>
                    {r.category && (
                      <span className="text-xs text-muted-foreground">
                        {ERROR_CATEGORY_LABELS[r.category] ?? r.category}
                      </span>
                    )}
                  </div>
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/central-erros/$errorId" params={{ errorId: r.id }}>
                      Ver
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
