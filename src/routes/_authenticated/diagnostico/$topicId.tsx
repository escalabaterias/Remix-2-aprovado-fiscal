import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

import { getTopicDiagnosis, getTopicHistory } from "@/lib/diagnosis/service";
import {
  KNOWLEDGE_STATE_LABELS,
  RISK_LEVEL_LABELS,
  INTERVENTION_LABELS,
  EVIDENCE_LEVEL_LABELS,
  RECENCY_LABELS,
} from "@/lib/diagnosis/engine";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_authenticated/diagnostico/$topicId")({
  head: () => ({
    meta: [
      { title: "Detalhe do Diagnóstico — Aprovado Fiscal" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DiagnosticoDetalhePage,
});

function DiagnosticoDetalhePage() {
  const { topicId } = Route.useParams();

  const {
    data: diagnosis,
    isLoading: loadingDiagnosis,
    error: diagError,
  } = useQuery({
    queryKey: ["topic-diagnosis", topicId],
    queryFn: () => getTopicDiagnosis(topicId),
  });

  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ["topic-history", topicId],
    queryFn: () => getTopicHistory(topicId),
  });

  if (loadingDiagnosis) {
    return (
      <AppShell title="Detalhe do Diagnóstico">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </AppShell>
    );
  }

  if (diagError) {
    return (
      <AppShell title="Detalhe do Diagnóstico">
        <p className="text-sm text-destructive">Erro: {(diagError as Error).message}</p>
      </AppShell>
    );
  }

  if (!diagnosis) {
    return (
      <AppShell title="Detalhe do Diagnóstico">
        <EmptyState
          title="Tópico sem dados"
          description="Não há dados de domínio para este tópico. Responda questões para gerar o diagnóstico."
        />
        <div className="mt-4">
          <Button asChild variant="outline">
            <Link to="/diagnostico">Voltar ao diagnóstico</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const d = diagnosis;

  // Chart data
  const chartData = (history ?? []).map((h) => ({
    date: new Date(h.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    mastery: Number((Number(h.mastery_after) * 100).toFixed(1)),
    confidence: Number((Number(h.confidence) * 100).toFixed(1)),
    questoes: h.total_questions,
  }));

  return (
    <AppShell
      title={`${d.subjectName} — ${d.topicName}`}
      description="Diagnóstico pedagógico detalhado e evolução histórica."
    >
      <div className="space-y-6">
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/diagnostico">← Voltar</Link>
          </Button>
        </div>

        {/* Métricas principais */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Domínio</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Progress value={d.mastery * 100} className="h-3 flex-1" />
                <span className="text-lg font-semibold">{(d.mastery * 100).toFixed(0)}%</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Confiança</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Progress value={d.confidence * 100} className="h-3 flex-1" />
                <span className="text-lg font-semibold">{(d.confidence * 100).toFixed(0)}%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Evidência: {EVIDENCE_LEVEL_LABELS[d.evidenceLevel]}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Desempenho
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Progress value={d.accuracy * 100} className="h-3 flex-1" />
                <span className="text-lg font-semibold">{(d.accuracy * 100).toFixed(0)}%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {d.signals.questionCount} questões respondidas
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Score de intervenção
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Progress value={d.interventionScore * 100} className="h-3 flex-1" />
                <span className="text-lg font-semibold">
                  {(d.interventionScore * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Quanto maior, mais urgente a intervenção
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Erros e recência */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Erros</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-semibold">{d.signals.recentErrors}</p>
              <p className="text-xs text-muted-foreground">total registrado</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Não resolvidos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p
                className={`text-lg font-semibold ${d.signals.unresolvedErrors > 0 ? "text-destructive" : ""}`}
              >
                {d.signals.unresolvedErrors}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Recorrentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p
                className={`text-lg font-semibold ${d.signals.recurringErrors > 0 ? "text-orange-600" : ""}`}
              >
                {d.signals.recurringErrors}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Recência</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-semibold">
                {d.signals.daysSinceStudy !== null ? `${d.signals.daysSinceStudy} dias` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">{RECENCY_LABELS[d.recency]}</p>
            </CardContent>
          </Card>
        </div>

        <Separator />

        {/* Diagnóstico */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Diagnóstico</h2>

          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Estado</p>
              <Badge
                variant={
                  d.knowledgeState === "DOMINADO" || d.knowledgeState === "CONSOLIDANDO"
                    ? "default"
                    : d.knowledgeState === "SEM_EVIDENCIA" || d.knowledgeState === "APRENDIZAGEM"
                      ? "secondary"
                      : "destructive"
                }
              >
                {KNOWLEDGE_STATE_LABELS[d.knowledgeState]}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Risco</p>
              <Badge
                variant={
                  d.riskLevel === "BAIXO"
                    ? "outline"
                    : d.riskLevel === "MODERADO"
                      ? "secondary"
                      : "destructive"
                }
              >
                {RISK_LEVEL_LABELS[d.riskLevel]}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Intervenção recomendada</p>
              <Badge variant="secondary">{INTERVENTION_LABELS[d.intervention]}</Badge>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Motivo do diagnóstico</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{d.diagnosisReason}</p>
              {d.secondarySignals.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground mb-1">Sinais secundários:</p>
                  <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
                    {d.secondarySignals.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Separator />

        {/* Gráfico de evolução */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Evolução do domínio</h2>

          {loadingHistory ? (
            <p className="text-sm text-muted-foreground">Carregando histórico…</p>
          ) : chartData.length === 0 ? (
            <EmptyState
              title="Sem histórico"
              description="Ainda não há registros de evolução para este tópico."
            />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={12} />
                    <YAxis domain={[0, 100]} fontSize={12} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        if (name === "questoes") return [value, "Questões"];
                        return [`${value}%`, name === "mastery" ? "Domínio" : "Confiança"];
                      }}
                    />
                    <Legend
                      formatter={(value: string) => {
                        if (value === "mastery") return "Domínio";
                        if (value === "confidence") return "Confiança";
                        return "Questões";
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="mastery"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="confidence"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={{ r: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
