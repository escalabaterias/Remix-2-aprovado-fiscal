/**
 * Utilitários de datas e disponibilidade semanal.
 *
 * Convenções do sistema:
 * - Uma "semana" é identificada pela data da segunda-feira (`week_start`).
 * - Disponibilidade é sempre armazenada em MINUTOS por dia da semana.
 * - Índice de dia da semana segue o JS: 0 = domingo ... 6 = sábado.
 */

export const DAY_MINUTE_KEYS = [
  "minutes_sun",
  "minutes_mon",
  "minutes_tue",
  "minutes_wed",
  "minutes_thu",
  "minutes_fri",
  "minutes_sat",
] as const;

export type DayMinuteKey = (typeof DAY_MINUTE_KEYS)[number];

export const DAY_LABELS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

export const DAY_SHORT_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

export type AvailabilityWeek = {
  week_start: string;
  minutes_sun: number;
  minutes_mon: number;
  minutes_tue: number;
  minutes_wed: number;
  minutes_thu: number;
  minutes_fri: number;
  minutes_sat: number;
};

/** Converte um Date (local) para `YYYY-MM-DD`. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Interpreta `YYYY-MM-DD` como data local (sem deslocamento de fuso). */
export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: string, days: number): string {
  const date = fromISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** Segunda-feira da semana da data informada. */
export function weekStartOf(iso: string): string {
  const date = fromISODate(iso);
  const dow = date.getDay(); // 0=dom
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + diff);
  return toISODate(date);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function daysBetween(fromISO: string, toISOStr: string): number {
  const a = fromISODate(fromISO).getTime();
  const b = fromISODate(toISOStr).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Lista as segundas-feiras que cobrem o intervalo [start, end]. */
export function weekStartsBetween(startISO: string, endISO: string): string[] {
  const weeks: string[] = [];
  let cursor = weekStartOf(startISO);
  const last = weekStartOf(endISO);
  let guard = 0;
  while (cursor <= last && guard < 520) {
    weeks.push(cursor);
    cursor = addDays(cursor, 7);
    guard += 1;
  }
  return weeks;
}

export function dayKeyForDate(iso: string): DayMinuteKey {
  return DAY_MINUTE_KEYS[fromISODate(iso).getDay()]!;
}

/** Minutos disponíveis em uma data, conforme a semana correspondente. */
export function availableMinutesOn(
  iso: string,
  weeks: Map<string, AvailabilityWeek>,
  fallback?: AvailabilityWeek | null,
): number {
  const week = weeks.get(weekStartOf(iso)) ?? fallback;
  if (!week) return 0;
  return week[dayKeyForDate(iso)] ?? 0;
}

export function weekTotalMinutes(week: AvailabilityWeek): number {
  return DAY_MINUTE_KEYS.reduce((sum, key) => sum + (week[key] ?? 0), 0);
}

export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
}

export function formatDateShort(iso: string): string {
  const date = fromISODate(iso);
  return `${DAY_SHORT_LABELS[date.getDay()]} ${String(date.getDate()).padStart(2, "0")}/${String(
    date.getMonth() + 1,
  ).padStart(2, "0")}`;
}

/** Cria uma semana vazia (nenhum dia disponível). */
export function emptyWeek(weekStart: string): AvailabilityWeek {
  return {
    week_start: weekStart,
    minutes_sun: 0,
    minutes_mon: 0,
    minutes_tue: 0,
    minutes_wed: 0,
    minutes_thu: 0,
    minutes_fri: 0,
    minutes_sat: 0,
  };
}
