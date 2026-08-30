import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/dominio")({
  head: () => ({
    meta: [
      { title: "Evolução do Domínio — Aprovado Fiscal" },
      {
        name: "description",
        content: "Visualize o estado atual de domínio por matéria e tópico.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DominioPage,
});

type KnowledgeRow = {
  topic_id: string;
  mastery: number | null;
  confidence: number | null;
  total_questions: number | null;
  correct_questions: number | null;
  last_studied_at: string | null;
  topics: {
    name: string;
    subject_id: string | null;
    subjects: { name: string } | null;
  } | null;
};

function DominioPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dominio-overview"],
    queryFn: async () => {
      const { data: knowledge, error } = await supabase
        .from("user_topic_knowledge")
        .select(
          "topic_id, mastery, confidence, total_questions, correct_questions, last_studied_at, topics(name, subject_id, subjects(name))",
        )
        .order("mastery", { ascending: true });

      if (error) throw error;
      const rows = (knowledge ?? []) as KnowledgeRow[];

      // Count errors per topic
      const topicIds = rows.map((r) => r.topic_id);
      const errorCounts = new Map<string, number>();
      if (topicIds.length) {
        const { data: errors } = await supabase
          .from("error_entries")
          .select("topic_id")
          .in("topic_id", topicIds);
        for (const e of errors ?? []) {
          if (e.topic_id) errorCounts.set(e.topic_id, (errorCounts.get(e.topic_id) ?? 0) + 1);
        }
      }

      return { rows, errorCounts };
    },
  });

  if (isLoading) {
    return (
      <AppShell title="Evolução do Domínio">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </AppShell>
    );
  }

  const rows = data?.rows ?? [];
  const errorCounts = data?.errorCounts ?? new Map<string, number>();

  // Group by subject
  const bySubject = new Map<string, { subjectName: string; topics: typeof rows }>();
  for (const row of rows) {
    const subjectId = row.topics?.subject_id ?? "unknown";
    const subjectName = row.topics?.subjects?.name ?? "Sem matéria";
    const group = bySubject.get(subjectId) ?? { subjectName, topics: [] };
    group.topics.push(row);
    bySubject.set(subjectId, group);
  }

  return (
    <AppShell
      title="Evolução do Domínio"
      description="Estado atual de domínio estimado por matéria e tópico. Os valores são calculados pelo motor de conhecimento a partir das tentativas de questões."
    >
      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum dado de domínio"
          description="Responda questões para que o sistema calcule seu domínio por tópico."
        />
      ) : (
        <div className="space-y-8">
          {Array.from(bySubject.entries())
            .sort((a, b) => a[1].subjectName.localeCompare(b[1].subjectName))
            .map(([subjectId, { subjectName, topics: subjectTopics }]) => (
              <div key={subjectId}>
                <h2 className="text-lg font-semibold mb-3">{subjectName}</h2>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tópico</TableHead>
                        <TableHead className="w-[120px]">Domínio</TableHead>
                        <TableHead className="w-[120px]">Confiança</TableHead>
                        <TableHead className="w-[80px] text-right">Questões</TableHead>
                        <TableHead className="w-[80px] text-right">Acertos</TableHead>
                        <TableHead className="w-[80px] text-right">Erros</TableHead>
                        <TableHead className="w-[120px]">Último estudo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subjectTopics.map((row) => {
                        const mastery = Number(row.mastery ?? 0);
                        const confidence = Number(row.confidence ?? 0);
                        const total = row.total_questions ?? 0;
                        const correct = row.correct_questions ?? 0;
                        const errors = errorCounts.get(row.topic_id) ?? 0;

                        return (
                          <TableRow key={row.topic_id}>
                            <TableCell className="font-medium">{row.topics?.name ?? "—"}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Progress value={mastery * 100} className="h-2 w-16" />
                                <span className="text-xs text-muted-foreground">
                                  {(mastery * 100).toFixed(0)}%
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Progress value={confidence * 100} className="h-2 w-16" />
                                <span className="text-xs text-muted-foreground">
                                  {(confidence * 100).toFixed(0)}%
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{total}</TableCell>
                            <TableCell className="text-right">{correct}</TableCell>
                            <TableCell className="text-right">
                              {errors > 0 ? (
                                <Badge variant="destructive" className="text-xs">
                                  {errors}
                                </Badge>
                              ) : (
                                "0"
                              )}
                            </TableCell>
                            <TableCell>
                              {row.last_studied_at
                                ? new Date(row.last_studied_at).toLocaleDateString("pt-BR")
                                : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
        </div>
      )}
    </AppShell>
  );
}
