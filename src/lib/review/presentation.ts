/**
 * CAMADA DE APRESENTAÇÃO DO REVIEW — Etapa 4, Fase 4
 *
 * Apenas formatação/rotulagem para a UI.
 * NÃO contém regra pedagógica e NÃO recalcula nada do Review Engine:
 * urgency, interval, needsReview, reviewType e reviewIntensity chegam prontos.
 */

import type { TopicReviewDecision } from "./types";

export type UrgencyBand = "baixa" | "moderada" | "alta";

/** Faixa somente visual, derivada do reviewUrgency já calculado (0..1). */
export function urgencyBand(urgency: number): UrgencyBand {
  if (urgency >= 0.7) return "alta";
  if (urgency >= 0.3) return "moderada";
  return "baixa";
}

export function urgencyPercentLabel(urgency: number): string {
  const value = Number.isFinite(urgency) ? Math.max(0, Math.min(1, urgency)) : 0;
  return `${Math.round(value * 100)}%`;
}

export const REVIEW_TYPE_LABELS: Record<TopicReviewDecision["reviewType"], string> = {
  manutencao: "Manutenção",
  consolidacao: "Consolidação",
  recuperacao: "Recuperação",
  erro_direcionado: "Erro direcionado",
};

export const REVIEW_INTENSITY_LABELS: Record<TopicReviewDecision["reviewIntensity"], string> = {
  leve: "Leve",
  moderada: "Moderada",
  intensiva: "Intensiva",
};

/** Formata uma data ISO (YYYY-MM-DD ou completa) no padrão pt-BR usado no app. */
export function formatReviewDate(iso: string): string {
  const ms = Date.parse(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString("pt-BR");
}

export function intervalLabel(days: number): string {
  const value = Number.isFinite(days) ? Math.max(0, Math.trunc(days)) : 0;
  return value === 1 ? "1 dia" : `${value} dias`;
}

/** Intensidade predominante da fila (maior contagem; empate resolvido por severidade). */
export function predominantIntensity(
  items: Pick<TopicReviewDecision, "reviewIntensity">[],
): TopicReviewDecision["reviewIntensity"] | null {
  if (items.length === 0) return null;
  const order: TopicReviewDecision["reviewIntensity"][] = ["intensiva", "moderada", "leve"];
  const counts = new Map<TopicReviewDecision["reviewIntensity"], number>();
  for (const item of items) {
    counts.set(item.reviewIntensity, (counts.get(item.reviewIntensity) ?? 0) + 1);
  }
  let best: TopicReviewDecision["reviewIntensity"] = "leve";
  let bestCount = -1;
  for (const intensity of order) {
    const count = counts.get(intensity) ?? 0;
    if (count > bestCount) {
      best = intensity;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : null;
}
