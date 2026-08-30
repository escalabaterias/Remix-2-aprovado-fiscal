-- ============================================================
-- ETAPA 4 — FASE 2: Infraestrutura de banco para revisão adaptativa
-- ============================================================
-- Esta migration APENAS adiciona estruturas de banco.
-- NÃO cria RPCs, triggers, seeds, nem lógica pedagógica.
-- NÃO altera nenhuma migration anterior.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ENUMS (idempotente com DO/EXCEPTION)
-- ────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.review_result AS ENUM ('success', 'partial', 'fail');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.review_type AS ENUM ('manutencao', 'consolidacao', 'recuperacao', 'erro_direcionado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.review_intensity AS ENUM ('leve', 'moderada', 'intensiva');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2. REVIEW_EVENTS — novas colunas
-- ────────────────────────────────────────────────────────────
-- A tabela review_events já existe com colunas SRS (ease_factor,
-- quality_score, next_review_date, content_type, interval_days, etc).
-- Adicionamos as colunas necessárias para o sistema de revisão
-- adaptativo sem alterar as existentes.
-- Nomes escolhidos para evitar conflito:
--   result        → resultado da revisão
--   review_type_cat → tipo/categoria da revisão ("review_type" colide com o nome do enum)
--   intensity     → intensidade da revisão
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL;

ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS result public.review_result;

ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS review_type_cat public.review_type;

ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS intensity public.review_intensity;

ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS mastery_at_review numeric;

ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS confidence_at_review numeric;

ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.study_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.plan_tasks(id) ON DELETE SET NULL;

ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS notes text;

-- ────────────────────────────────────────────────────────────
-- 3. CONSTRAINTS em review_events (idempotente)
-- ────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE public.review_events
    ADD CONSTRAINT review_events_mastery_range
    CHECK (mastery_at_review >= 0 AND mastery_at_review <= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.review_events
    ADD CONSTRAINT review_events_confidence_range
    CHECK (confidence_at_review >= 0 AND confidence_at_review <= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────
-- 4. USER_TOPIC_KNOWLEDGE — novas colunas
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.user_topic_knowledge
  ADD COLUMN IF NOT EXISTS next_review_at date;

ALTER TABLE public.user_topic_knowledge
  ADD COLUMN IF NOT EXISTS last_review_at date;

ALTER TABLE public.user_topic_knowledge
  ADD COLUMN IF NOT EXISTS last_review_result public.review_result;

-- ────────────────────────────────────────────────────────────
-- 5. ÍNDICES — review_events
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_review_events_user_topic
  ON public.review_events (user_id, topic_id);

CREATE INDEX IF NOT EXISTS idx_review_events_user_completed
  ON public.review_events (user_id, completed_at);

CREATE INDEX IF NOT EXISTS idx_review_events_topic_completed_desc
  ON public.review_events (topic_id, completed_at DESC);

-- ────────────────────────────────────────────────────────────
-- 6. ÍNDICE — user_topic_knowledge
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_utk_user_next_review
  ON public.user_topic_knowledge (user_id, next_review_at);

-- ────────────────────────────────────────────────────────────
-- 7. RLS — review_events
-- ────────────────────────────────────────────────────────────
-- RLS já habilitado. Policy "review_events_own" (FOR ALL,
-- USING auth.uid() = user_id, WITH CHECK auth.uid() = user_id)
-- já cobre SELECT, INSERT, UPDATE, DELETE.
-- Novas colunas ficam automaticamente protegidas.
-- Nenhuma alteração necessária.
-- ────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────
-- 8. RLS — user_topic_knowledge
-- ────────────────────────────────────────────────────────────
-- Policy "utk_own" (FOR ALL, USING auth.uid() = user_id,
-- WITH CHECK auth.uid() = user_id) já protege todas as colunas.
-- Nenhuma alteração necessária.
-- ────────────────────────────────────────────────────────────
