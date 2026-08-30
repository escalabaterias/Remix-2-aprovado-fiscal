-- 1. Colunas de acompanhamento em user_topic_knowledge
ALTER TABLE public.user_topic_knowledge
  ADD COLUMN IF NOT EXISTS total_questions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_questions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_studied_at timestamptz;

-- 2. Histórico de evolução do domínio
CREATE TABLE IF NOT EXISTS public.knowledge_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  contest_id uuid REFERENCES public.contests(id) ON DELETE SET NULL,
  attempt_id uuid,
  session_id uuid,
  mastery_before numeric NOT NULL DEFAULT 0,
  mastery_after numeric NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  total_questions integer NOT NULL DEFAULT 0,
  correct_questions integer NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  last_studied_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_history_user_attempt_uidx
  ON public.knowledge_history (user_id, attempt_id) WHERE attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS knowledge_history_user_topic_created_idx
  ON public.knowledge_history (user_id, topic_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_history TO authenticated;
GRANT ALL ON public.knowledge_history TO service_role;

ALTER TABLE public.knowledge_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own knowledge history" ON public.knowledge_history;
CREATE POLICY "Users manage their own knowledge history"
  ON public.knowledge_history FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. RPC atômica de processamento de tentativa
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
  p_error_category public.error_category DEFAULT NULL,
  p_error_question_id uuid DEFAULT NULL,
  p_error_root_topic_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_history_id uuid;
  v_error_id uuid;
  v_existing uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_attempt_id IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.knowledge_history
    WHERE user_id = p_user_id AND attempt_id = p_attempt_id;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'already_processed', 'history_id', v_existing, 'error_id', NULL);
    END IF;
  END IF;

  INSERT INTO public.user_topic_knowledge (
    user_id, topic_id, mastery, confidence, total_questions, correct_questions,
    review_count, last_studied_at
  ) VALUES (
    p_user_id, p_topic_id, p_mastery_after, p_confidence, p_total_questions,
    p_correct_questions, COALESCE(p_review_count, 0), p_last_studied_at
  )
  ON CONFLICT (user_id, topic_id) DO UPDATE SET
    mastery = EXCLUDED.mastery,
    confidence = EXCLUDED.confidence,
    total_questions = EXCLUDED.total_questions,
    correct_questions = EXCLUDED.correct_questions,
    review_count = GREATEST(public.user_topic_knowledge.review_count, EXCLUDED.review_count),
    last_studied_at = EXCLUDED.last_studied_at,
    updated_at = now();

  INSERT INTO public.knowledge_history (
    user_id, topic_id, subject_id, contest_id, attempt_id, session_id,
    mastery_before, mastery_after, confidence, total_questions, correct_questions,
    review_count, last_studied_at, reason
  ) VALUES (
    p_user_id, p_topic_id, p_subject_id, p_contest_id, p_attempt_id, p_session_id,
    p_mastery_before, p_mastery_after, p_confidence, p_total_questions,
    p_correct_questions, COALESCE(p_review_count, 0), p_last_studied_at, p_reason
  )
  RETURNING id INTO v_history_id;

  IF p_error_category IS NOT NULL OR p_error_question_id IS NOT NULL THEN
    INSERT INTO public.error_entries (
      user_id, topic_id, subject_id, root_topic_id, attempt_id, question_id, category
    ) VALUES (
      p_user_id, p_topic_id, p_subject_id, p_error_root_topic_id, p_attempt_id,
      p_error_question_id, p_error_category
    )
    RETURNING id INTO v_error_id;
  END IF;

  RETURN jsonb_build_object('status', 'processed', 'history_id', v_history_id, 'error_id', v_error_id);
END;
$$;

REVOKE ALL ON FUNCTION public.process_attempt_knowledge(uuid,uuid,uuid,uuid,uuid,uuid,numeric,numeric,numeric,integer,integer,integer,timestamptz,text,public.error_category,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_attempt_knowledge(uuid,uuid,uuid,uuid,uuid,uuid,numeric,numeric,numeric,integer,integer,integer,timestamptz,text,public.error_category,uuid,uuid) TO authenticated;