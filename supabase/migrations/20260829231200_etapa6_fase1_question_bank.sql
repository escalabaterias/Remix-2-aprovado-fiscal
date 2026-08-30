-- ============================================================
-- ETAPA 6 — FASE 1: Infraestrutura do Banco de Questões
-- ============================================================
-- Esta migration APENAS adiciona colunas, tabelas e índices.
-- NÃO altera migrations anteriores, RPCs, triggers de lógica
-- pedagógica, seeds nem dados existentes.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ENUM para tipos de conjunto de questões
-- ────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.question_set_type AS ENUM (
    'simulado',
    'lista',
    'caderno',
    'revisao',
    'diagnostico'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2. COLUNAS COMPLEMENTARES em questions
-- ────────────────────────────────────────────────────────────
-- tags: alinha questions com flashcards (que já possuem tags[])
-- comment_count: tracking futuro de anotações por questão
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS comment_count integer NOT NULL DEFAULT 0;

-- Índice GIN para busca por tags
CREATE INDEX IF NOT EXISTS idx_questions_tags
  ON public.questions USING gin (tags);

-- Índice para filtro por dificuldade
CREATE INDEX IF NOT EXISTS idx_questions_difficulty
  ON public.questions (difficulty)
  WHERE difficulty IS NOT NULL;

-- Índice para filtro por origem
CREATE INDEX IF NOT EXISTS idx_questions_origin
  ON public.questions (origin);

-- ────────────────────────────────────────────────────────────
-- 3. QUESTION_SETS — Conjuntos/listas de questões
-- ────────────────────────────────────────────────────────────
-- Agrupa questões em simulados, listas de exercícios,
-- cadernos de revisão, etc.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.question_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  type public.question_set_type NOT NULL DEFAULT 'lista',
  contest_id uuid REFERENCES public.contests(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  topic_id uuid REFERENCES public.topics(id) ON DELETE SET NULL,
  time_limit_minutes integer,
  is_timed boolean NOT NULL DEFAULT false,
  is_completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  total_questions integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  wrong_count integer NOT NULL DEFAULT 0,
  score numeric(5,2),
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_sets TO authenticated;
GRANT ALL ON public.question_sets TO service_role;
ALTER TABLE public.question_sets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "question_sets_own" ON public.question_sets
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TRIGGER trg_question_sets_updated
  BEFORE UPDATE ON public.question_sets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_question_sets_user
  ON public.question_sets (user_id, type);

CREATE INDEX IF NOT EXISTS idx_question_sets_contest
  ON public.question_sets (contest_id)
  WHERE contest_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 4. QUESTION_SET_ITEMS — Itens dentro de um conjunto
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.question_set_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_id uuid NOT NULL REFERENCES public.question_sets(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  is_answered boolean NOT NULL DEFAULT false,
  is_correct boolean,
  chosen_answer text,
  time_spent_seconds integer,
  attempt_id uuid REFERENCES public.question_attempts(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_set_item_unique UNIQUE (set_id, question_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_set_items TO authenticated;
GRANT ALL ON public.question_set_items TO service_role;
ALTER TABLE public.question_set_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "question_set_items_own" ON public.question_set_items
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TRIGGER trg_question_set_items_updated
  BEFORE UPDATE ON public.question_set_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_question_set_items_set
  ON public.question_set_items (set_id, position);

CREATE INDEX IF NOT EXISTS idx_question_set_items_question
  ON public.question_set_items (question_id);

-- ────────────────────────────────────────────────────────────
-- 5. QUESTION_STATS — Estatísticas agregadas por questão
-- ────────────────────────────────────────────────────────────
-- Uma linha por (user_id, question_id). Atualizada pela camada
-- de serviço após cada tentativa. Evita COUNT(*) em tempo real.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.question_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  total_attempts integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  wrong_count integer NOT NULL DEFAULT 0,
  streak_correct integer NOT NULL DEFAULT 0,
  streak_wrong integer NOT NULL DEFAULT 0,
  best_time_seconds integer,
  avg_time_seconds numeric(8,2),
  last_attempted_at timestamptz,
  last_correct_at timestamptz,
  last_wrong_at timestamptz,
  mastery_contribution numeric(5,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_stats_unique UNIQUE (user_id, question_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_stats TO authenticated;
GRANT ALL ON public.question_stats TO service_role;
ALTER TABLE public.question_stats ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "question_stats_own" ON public.question_stats
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TRIGGER trg_question_stats_updated
  BEFORE UPDATE ON public.question_stats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_question_stats_user
  ON public.question_stats (user_id);

CREATE INDEX IF NOT EXISTS idx_question_stats_question
  ON public.question_stats (question_id);

CREATE INDEX IF NOT EXISTS idx_question_stats_user_last
  ON public.question_stats (user_id, last_attempted_at DESC);

-- ────────────────────────────────────────────────────────────
-- 6. CONSTRAINTS ADICIONAIS
-- ────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE public.question_stats
    ADD CONSTRAINT question_stats_counts_positive
    CHECK (total_attempts >= 0 AND correct_count >= 0 AND wrong_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.question_stats
    ADD CONSTRAINT question_stats_streaks_positive
    CHECK (streak_correct >= 0 AND streak_wrong >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.question_sets
    ADD CONSTRAINT question_sets_counts_positive
    CHECK (total_questions >= 0 AND correct_count >= 0 AND wrong_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.questions
    ADD CONSTRAINT questions_comment_count_positive
    CHECK (comment_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
