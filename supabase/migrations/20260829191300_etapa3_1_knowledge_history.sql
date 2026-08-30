-- ETAPA 3.1: knowledge_history + sinais de domínio + RPC transacional

-- 1. Tabela de histórico de conhecimento (append-only)
CREATE TABLE IF NOT EXISTS public.knowledge_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  contest_id uuid REFERENCES public.contests(id) ON DELETE SET NULL,
  attempt_id uuid REFERENCES public.question_attempts(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.study_sessions(id) ON DELETE SET NULL,
  mastery_before numeric NOT NULL CHECK (mastery_before >= 0 AND mastery_before <= 1),
  mastery_after numeric NOT NULL CHECK (mastery_after >= 0 AND mastery_after <= 1),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  total_questions integer NOT NULL DEFAULT 0 CHECK (total_questions >= 0),
  correct_questions integer NOT NULL DEFAULT 0 CHECK (correct_questions >= 0),
  review_count integer NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  last_studied_at timestamptz,
  reason text NOT NULL DEFAULT 'attempt',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_history_correct_le_total CHECK (correct_questions <= total_questions)
);

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_knowledge_history_user_topic
  ON public.knowledge_history (user_id, topic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_history_user_created
  ON public.knowledge_history (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_history_attempt
  ON public.knowledge_history (attempt_id);

-- RLS
ALTER TABLE public.knowledge_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "knowledge_history_own" ON public.knowledge_history;
CREATE POLICY "knowledge_history_own" ON public.knowledge_history
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT ON public.knowledge_history TO authenticated;
GRANT ALL ON public.knowledge_history TO service_role;

-- 2. Índices adicionais em error_entries para consultas de recorrência
CREATE INDEX IF NOT EXISTS idx_error_entries_user_topic_cat_date
  ON public.error_entries (user_id, topic_id, category, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_entries_user_resolved
  ON public.error_entries (user_id, is_resolved, occurred_at DESC);

-- 3. Garantir constraints em user_topic_knowledge
-- (mastery e confidence devem estar entre 0 e 1)
DO $$ BEGIN
  ALTER TABLE public.user_topic_knowledge
    ADD CONSTRAINT utk_mastery_range CHECK (mastery >= 0 AND mastery <= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.user_topic_knowledge
    ADD CONSTRAINT utk_confidence_range CHECK (confidence >= 0 AND confidence <= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. RPC: processamento transacional de tentativa
-- Garante atomicidade: knowledge_history + user_topic_knowledge + error_entry
-- Idempotente: se attempt_id já existe em knowledge_history, não faz nada.
CREATE OR REPLACE FUNCTION public.process_attempt_knowledge(
  p_user_id uuid,
  p_topic_id uuid,
  p_subject_id uuid,
  p_contest_id uuid,
  p_attempt_id uuid,
  p_session_id uuid,
  p_mastery_before numeric,
  p_mastery_after numeric,
  p_confidence numeric,
  p_total_questions integer,
  p_correct_questions integer,
  p_review_count integer,
  p_last_studied_at timestamptz,
  p_reason text,
  -- error fields (nullable)
  p_error_category text,
  p_error_question_id uuid,
  p_error_root_topic_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_history_id uuid;
  v_error_id uuid;
  v_result jsonb;
BEGIN
  -- Verificar que o usuário autenticado é o mesmo
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: user_id mismatch';
  END IF;

  -- Idempotência: verificar se esta tentativa já foi processada
  SELECT id INTO v_existing_id
  FROM public.knowledge_history
  WHERE attempt_id = p_attempt_id AND user_id = p_user_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_processed', 'history_id', v_existing_id);
  END IF;

  -- 1. Inserir snapshot no histórico
  INSERT INTO public.knowledge_history (
    user_id, topic_id, subject_id, contest_id, attempt_id, session_id,
    mastery_before, mastery_after, confidence,
    total_questions, correct_questions, review_count,
    last_studied_at, reason
  ) VALUES (
    p_user_id, p_topic_id, p_subject_id, p_contest_id, p_attempt_id, p_session_id,
    p_mastery_before, p_mastery_after, p_confidence,
    p_total_questions, p_correct_questions, p_review_count,
    p_last_studied_at, p_reason
  )
  RETURNING id INTO v_history_id;

  -- 2. Upsert do estado atual
  INSERT INTO public.user_topic_knowledge (
    user_id, topic_id, mastery, confidence,
    total_questions, correct_questions,
    last_studied_at, updated_at
  ) VALUES (
    p_user_id, p_topic_id, p_mastery_after, p_confidence,
    p_total_questions, p_correct_questions,
    p_last_studied_at, now()
  )
  ON CONFLICT (user_id, topic_id) DO UPDATE SET
    mastery = EXCLUDED.mastery,
    confidence = EXCLUDED.confidence,
    total_questions = EXCLUDED.total_questions,
    correct_questions = EXCLUDED.correct_questions,
    last_studied_at = EXCLUDED.last_studied_at,
    updated_at = now();

  -- 3. Inserir erro se aplicável
  IF p_error_category IS NOT NULL THEN
    INSERT INTO public.error_entries (
      user_id, topic_id, subject_id, root_topic_id,
      question_id, attempt_id, category,
      is_resolved, occurred_at
    ) VALUES (
      p_user_id, p_topic_id, p_subject_id, p_error_root_topic_id,
      p_error_question_id, p_attempt_id,
      p_error_category::public.error_category,
      false, now()
    )
    RETURNING id INTO v_error_id;
  END IF;

  v_result := jsonb_build_object(
    'status', 'processed',
    'history_id', v_history_id,
    'error_id', v_error_id
  );

  RETURN v_result;
END;
$$;

-- Permissão para chamada autenticada
GRANT EXECUTE ON FUNCTION public.process_attempt_knowledge TO authenticated;
