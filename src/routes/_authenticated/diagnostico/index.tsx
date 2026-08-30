import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getUserDiagnoses, type DiagnosisWithMeta } from "@/lib/diagnosis/service";
import {
  KNOWLEDGE_STATE_LABELS,
  RISK_LEVEL_LABELS,
  INTERVENTION_LABELS,
  EVIDENCE_LEVEL_LABELS,
  RECENCY_LABELS,
  type KnowledgeStateName,
  type RiskLevel,
  type InterventionType,
} from "@/lib/diagnosis/engine";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/diagnostico/")({
  head: () => ({
    meta: [
      { title: "Diagnóstico Inteligente — Aprovado Fiscal" },
      {
        name: "description",
        content:
          "Diagnóstico pedagógico completo dos seus tópicos de estudo com estados, riscos e recomendações.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DiagnosticoPage,
});

const STATE_BADGE_VARIANT: Record<
  KnowledgeStateName,
  "default" | "secondary" | "destructive" | "outline"
> = {
  SEM_EVIDENCIA: "outline",
  APRENDIZAGEM: "secondary",
  INSTAVEL: "destructive",
  CONSOLIDANDO: "default",
  DOMINADO: "default",
  RISCO_ESQUECIMENTO: "destructive",
  PONTO_CRITICO: "destructive",
};

const RISK_BADGE_VARIANT: Record<RiskLevel, "default" | "secondary" | "destructive" | "outline"> = {
  BAIXO: "outline",
  MODERADO: "secondary",
  ALTO: "destructive",
  CRITICO: "destructive",
};

function DiagnosticoPage() {
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [interventionFilter, setInterventionFilter] = useState<string>("all");

  const {
    data: diagnoses,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["user-diagnoses"],
    queryFn: getUserDiagnoses,
  });

  if (isLoading) {
    return (
      <AppShell title="Diagnóstico Inteligente">
        <p className="text-sm text-muted-foreground">Carregando diagnóstico…</p>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell title="Diagnóstico Inteligente">
        <p className="text-sm text-destructive">
          Erro ao carregar diagnóstico: {(error as Error).message}
        </p>
      </AppShell>
    );
  }

  const allDiagnoses = diagnoses ?? [];

  // Extract unique subjects
  const subjects = Array.from(new Map(allDiagnoses.map((d) => [d.subjectId, d.subjectName])));

  // Apply filters
  const filtered = allDiagnoses.filter((d) => {
    if (subjectFilter !== "all" && d.subjectId !== subjectFilter) return false;
    if (stateFilter !== "all" && d.knowledgeState !== stateFilter) return false;
    if (riskFilter !== "all" && d.riskLevel !== riskFilter) return false;
    if (interventionFilter !== "all" && d.intervention !== interventionFilter) return false;
    return true;
  });

  // Count by state
  const countByState = (state: KnowledgeStateName) =>
    allDiagnoses.filter((d) => d.knowledgeState === state).length;

  return (
    <AppShell
      title="Diagnóstico Inteligente"
      description="Diagnóstico pedagógico completo: onde você está mal, por quê, o que fazer e quão confiável é a conclusão."
    >
      <div className="space-y-6">
        {/* Visão geral */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pontos críticos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-destructive">
                {countByState("PONTO_CRITICO")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Em risco</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-orange-600">
                {countByState("RISCO_ESQUECIMENTO") + countByState("INSTAVEL")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Consolidando
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-blue-600">{countByState("CONSOLIDANDO")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Dominados</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-green-600">{countByState("DOMINADO")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Sem evidência
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-muted-foreground">
                {countByState("SEM_EVIDENCIA")}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-3">
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Matéria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as matérias</SelectItem>
              {subjects.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estados</SelectItem>
              {(Object.keys(KNOWLEDGE_STATE_LABELS) as KnowledgeStateName[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {KNOWLEDGE_STATE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Risco" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os riscos</SelectItem>
              {(Object.keys(RISK_LEVEL_LABELS) as RiskLevel[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {RISK_LEVEL_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={interventionFilter} onValueChange={setInterventionFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Intervenção" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as intervenções</SelectItem>
              {(Object.keys(INTERVENTION_LABELS) as InterventionType[]).map((i) => (
                <SelectItem key={i} value={i}>
                  {INTERVENTION_LABELS[i]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Tabela */}
        {filtered.length === 0 ? (
          <EmptyState
            title="Nenhum tópico encontrado"
            description="Não há tópicos com dados de domínio para os filtros selecionados. Responda questões para alimentar o diagnóstico."
          />
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Matéria</TableHead>
                  <TableHead>Tópico</TableHead>
                  <TableHead className="w-[90px]">Domínio</TableHead>
                  <TableHead className="w-[90px]">Confiança</TableHead>
                  <TableHead className="w-[90px]">Accuracy</TableHead>
                  <TableHead className="w-[70px] text-right">Questões</TableHead>
                  <TableHead className="w-[60px] text-right">Erros</TableHead>
                  <TableHead className="w-[70px] text-right">Recorr.</TableHead>
                  <TableHead className="w-[90px]">Último est.</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Risco</TableHead>
                  <TableHead>Intervenção</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.topicId}>
                    <TableCell className="text-xs">{d.subjectName}</TableCell>
                    <TableCell className="font-medium text-sm">{d.topicName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Progress value={d.mastery * 100} className="h-2 w-12" />
                        <span className="text-xs text-muted-foreground">
                          {(d.mastery * 100).toFixed(0)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Progress value={d.confidence * 100} className="h-2 w-12" />
                        <span className="text-xs text-muted-foreground">
                          {(d.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs">{(d.accuracy * 100).toFixed(0)}%</span>
                    </TableCell>
                    <TableCell className="text-right text-xs">{d.signals.questionCount}</TableCell>
                    <TableCell className="text-right text-xs">
                      {d.signals.unresolvedErrors > 0 ? (
                        <Badge variant="destructive" className="text-xs">
                          {d.signals.unresolvedErrors}
                        </Badge>
                      ) : (
                        "0"
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {d.signals.recurringErrors > 0 ? (
                        <Badge variant="destructive" className="text-xs">
                          {d.signals.recurringErrors}
                        </Badge>
                      ) : (
                        "0"
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {d.signals.daysSinceStudy !== null ? `${d.signals.daysSinceStudy}d` : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={STATE_BADGE_VARIANT[d.knowledgeState]}
                        className="text-xs whitespace-nowrap"
                      >
                        {KNOWLEDGE_STATE_LABELS[d.knowledgeState]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={RISK_BADGE_VARIANT[d.riskLevel]} className="text-xs">
                        {RISK_LEVEL_LABELS[d.riskLevel]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs">{INTERVENTION_LABELS[d.intervention]}</span>
                    </TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/diagnostico/$topicId" params={{ topicId: d.topicId }}>
                          Ver
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {filtered.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {filtered.length} tópico(s) exibido(s)
            {filtered.length !== allDiagnoses.length && ` de ${allDiagnoses.length} total`}
          </p>
        )}
      </div>
    </AppShell>
  );
}
