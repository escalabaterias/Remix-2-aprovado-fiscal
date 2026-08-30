import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getUserReviewQueue, type ReviewQueueItem } from "@/lib/review/service";
import {
  formatReviewDate,
  intervalLabel,
  predominantIntensity,
  REVIEW_INTENSITY_LABELS,
  REVIEW_TYPE_LABELS,
  urgencyBand,
  urgencyPercentLabel,
  type UrgencyBand,
} from "@/lib/review/presentation";

export const Route = createFileRoute("/_authenticated/revisao/")({
  head: () => ({
    meta: [
      { title: "Revisões — Aprovado Fiscal" },
      {
        name: "description",
        content: "Fila de revisão adaptativa: revise no momento certo para fortalecer a retenção.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RevisaoPage,
});

const BAND_LABEL: Record<UrgencyBand, string> = {
  baixa: "Urgência baixa",
  moderada: "Urgência moderada",
  alta: "Urgência alta",
};

function bandClasses(band: UrgencyBand): string {
  if (band === "alta") return "border-destructive/50 text-destructive";
  if (band === "moderada") return "border-warning/50 text-warning";
  return "border-border text-muted-foreground";
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <section className="panel px-5 py-4">
      <p className="label-eyebrow">{label}</p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </section>
  );
}

function ReviewCard({ item }: { item: ReviewQueueItem }) {
  const band = urgencyBand(item.reviewUrgency);

  return (
    <article className="panel px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-foreground">
            Tópico <span className="font-mono text-sm text-muted-foreground">{item.topicId}</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{item.reviewReason}</p>
        </div>
        <Badge variant="outline" className={bandClasses(band)}>
          {BAND_LABEL[band]}
        </Badge>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="label-eyebrow">Urgência</span>
          <span className="font-mono">{urgencyPercentLabel(item.reviewUrgency)}</span>
        </div>
        <Progress value={item.reviewUrgency * 100} className="mt-2 h-2" />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="label-eyebrow">Tipo</dt>
          <dd className="mt-1 text-sm text-foreground">{REVIEW_TYPE_LABELS[item.reviewType]}</dd>
        </div>
        <div>
          <dt className="label-eyebrow">Intensidade</dt>
          <dd className="mt-1 text-sm text-foreground">
            {REVIEW_INTENSITY_LABELS[item.reviewIntensity]}
          </dd>
        </div>
        <div>
          <dt className="label-eyebrow">Intervalo</dt>
          <dd className="mt-1 text-sm text-foreground">{intervalLabel(item.reviewInterval)}</dd>
        </div>
        <div>
          <dt className="label-eyebrow">Data sugerida</dt>
          <dd className="mt-1 text-sm text-foreground">
            {formatReviewDate(item.suggestedReviewDate)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function RevisaoPage() {
  const { data, isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["review-queue"],
    queryFn: () => getUserReviewQueue(),
  });

  const title = "Revisões";
  const description = "Revise no momento certo para fortalecer sua retenção.";

  if (isPending) {
    return (
      <AppShell title={title} description={description}>
        <div className="space-y-4" aria-busy="true" aria-live="polite">
          <p className="text-sm text-muted-foreground">Carregando revisões…</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell title={title} description={description}>
        <section className="panel px-5 py-6" role="alert">
          <h2 className="font-display text-base font-semibold text-foreground">
            Não foi possível carregar as revisões
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Erro desconhecido ao consultar a fila."}
          </p>
          <Button className="mt-4" onClick={() => void refetch()} disabled={isRefetching}>
            {isRefetching ? "Tentando…" : "Tentar novamente"}
          </Button>
        </section>
      </AppShell>
    );
  }

  const queue = data ?? [];

  if (queue.length === 0) {
    return (
      <AppShell title={title} description={description}>
        <EmptyState
          title="Você não tem revisões pendentes no momento."
          description="O sistema continuará acompanhando seus tópicos e indicará a próxima revisão quando necessário."
        />
      </AppShell>
    );
  }

  const mostUrgent: ReviewQueueItem = queue[0]!;
  const intensity = predominantIntensity(queue);

  return (
    <AppShell title={title} description={description}>
      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard label="Revisões pendentes" value={String(queue.length)} />
          <SummaryCard
            label="Mais urgente"
            value={urgencyPercentLabel(mostUrgent.reviewUrgency)}
            hint={`Tópico ${mostUrgent.topicId}`}
          />
          <SummaryCard
            label="Intensidade predominante"
            value={intensity ? REVIEW_INTENSITY_LABELS[intensity] : "—"}
          />
        </div>

        <div className="space-y-4">
          {queue.map((item) => (
            <ReviewCard key={item.topicId} item={item} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
