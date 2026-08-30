-- ETAPA 2: planejamento adaptativo (motor deterministico)

-- 1. Novos estados de tarefa
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'parcialmente_concluida';
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'reagendada';

-- 2. Tipos de atividade
DO $$ BEGIN
  CREATE TYPE public.activity_kind AS ENUM (
    'teoria','questoes','revisao','flashcards','simulado','exercicios','leitura','estudo_dirigido'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Disponibilidade por semana
CREATE TABLE IF NOT EXISTS public.availability_weeks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  minutes_sun integer NOT NULL DEFAULT 0 CHECK (minutes_sun BETWEEN 0 AND 1440),
  minutes_mon integer NOT NULL DEFAULT 0 CHECK (minutes_mon BETWEEN 0 AND 1440),
  minutes_tue integer NOT NULL DEFAULT 0 CHECK (minutes_tue BETWEEN 0 AND 1440),
  minutes_wed integer NOT NULL DEFAULT 0 CHECK (minutes_wed BETWEEN 0 AND 1440),
  minutes_thu integer NOT NULL DEFAULT 0 CHECK (minutes_thu BETWEEN 0 AND 1440),
  minutes_fri integer NOT NULL DEFAULT 0 CHECK (minutes_fri BETWEEN 0 AND 1440),
  minutes_sat integer NOT NULL DEFAULT 0 CHECK (minutes_sat BETWEEN 0 AND 1440),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_weeks TO authenticated;
GRANT ALL ON public.availability_weeks TO service_role;

ALTER TABLE public.availability_weeks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "availability_weeks_own" ON public.availability_weeks;
CREATE POLICY "availability_weeks_own" ON public.availability_weeks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_availability_weeks_updated ON public.availability_weeks;
CREATE TRIGGER trg_availability_weeks_updated
  BEFORE UPDATE ON public.availability_weeks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_availability_weeks_user_week
  ON public.availability_weeks (user_id, week_start DESC);

-- 4. Tarefas: atividade tipada, prioridade explicada, resultados
ALTER TABLE public.plan_tasks
  ADD COLUMN IF NOT EXISTS activity_type public.activity_kind,
  ADD COLUMN IF NOT EXISTS priority_score numeric,
  ADD COLUMN IF NOT EXISTS priority_reason text,
  ADD COLUMN IF NOT EXISTS questions_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wrong_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_minutes integer,
  ADD COLUMN IF NOT EXISTS original_date date,
  ADD COLUMN IF NOT EXISTS rescheduled_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.study_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plan_tasks_user_date_status
  ON public.plan_tasks (user_id, scheduled_date, status);

-- 5. Blocos: semana e ciclo
ALTER TABLE public.plan_blocks
  ADD COLUMN IF NOT EXISTS week_start date,
  ADD COLUMN IF NOT EXISTS cycle_number integer;

CREATE INDEX IF NOT EXISTS idx_plan_blocks_plan_week
  ON public.plan_blocks (plan_id, week_start, position);