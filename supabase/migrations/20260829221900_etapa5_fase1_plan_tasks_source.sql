-- ============================================================
-- ETAPA 5 — FASE 1: Colunas source e review_event_id em plan_tasks
-- ============================================================
-- Esta migration APENAS adiciona colunas e índices a plan_tasks.
-- NÃO cria tabelas, RPCs, triggers nem altera RLS.
-- NÃO altera dados existentes (DEFAULT cuida dos novos inserts).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. COLUNA source
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.plan_tasks
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'planner';

DO $$ BEGIN
  ALTER TABLE public.plan_tasks
    ADD CONSTRAINT plan_tasks_source_check
    CHECK (source IN ('planner', 'review_engine', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2. COLUNA review_event_id (FK para review_events)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.plan_tasks
  ADD COLUMN IF NOT EXISTS review_event_id uuid;

DO $$ BEGIN
  ALTER TABLE public.plan_tasks
    ADD CONSTRAINT plan_tasks_review_event_id_fkey
    FOREIGN KEY (review_event_id) REFERENCES public.review_events(id)
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. ÍNDICES
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_plan_tasks_source
  ON public.plan_tasks (source);

CREATE INDEX IF NOT EXISTS idx_plan_tasks_review_event_id
  ON public.plan_tasks (review_event_id)
  WHERE review_event_id IS NOT NULL;
