-- ETAPA 3.1.2: Ownership do attempt_id + Integridade dos contadores

-- ============================================================
-- 1. OWNERSHIP: Validar que attempt_id pertence ao usuário autenticado
-- ============================================================

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
  v_history_id uuid;
  v_error_id uuid;
  v_result jsonb;
  v_attempt_owner uuid;
BEGIN
  -- Defesa em profundidade: p_user_id deve ser o usuário autenticado
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: user_id mismatch';
  END IF;

  -- OWNERSHIP: Verificar que o attempt_id pertence ao usuário autenticado.
  -- Não confia em p_user_id; a autoridade é auth.uid().
  IF p_attempt_id IS NOT NULL THEN
    SELECT qa.user_id INTO v_attempt_owner
    FROM public.question_attempts qa
    WHERE qa.id = p_attempt_id;

    IF v_attempt_owner IS NULL THEN
      RAISE EXCEPTION 'Attempt not found: %', p_attempt_id;
    END IF;

    IF v_attempt_owner IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized: attempt does not belong to authenticated user';
    END IF;
  END IF;

  -- Idempotência atômica via INSERT ... ON CONFLICT no UNIQUE index.
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
  ON CONFLICT (attempt_id, user_id) WHERE attempt_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_history_id;

  -- Se v_history_id é NULL, o registro já existia (idempotência).
  IF v_history_id IS NULL THEN
    SELECT id INTO v_history_id
    FROM public.knowledge_history
    WHERE attempt_id = p_attempt_id AND user_id = p_user_id
    LIMIT 1;

    RETURN jsonb_build_object('status', 'already_processed', 'history_id', v_history_id);
  END IF;

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

GRANT EXECUTE ON FUNCTION public.process_attempt_knowledge TO authenticated;

-- ============================================================
-- 2. INTEGRIDADE DOS CONTADORES em user_topic_knowledge
-- ============================================================

-- 2a. Garantir colunas defensivamente caso ainda não existam
ALTER TABLE public.user_topic_knowledge
  ADD COLUMN IF NOT EXISTS total_questions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_questions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_studied_at timestamptz;

-- 2b. CHECK constraints (defensivos com DO/EXCEPTION para idempotência)

DO $$ BEGIN
  ALTER TABLE public.user_topic_knowledge
    ADD CONSTRAINT utk_total_questions_nonneg CHECK (total_questions >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.user_topic_knowledge
    ADD CONSTRAINT utk_correct_questions_nonneg CHECK (correct_questions >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.user_topic_knowledge
    ADD CONSTRAINT utk_correct_le_total CHECK (correct_questions <= total_questions);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2b. Trigger anti-regressão: impede que total_questions ou correct_questions
-- diminuam via UPDATE. Isso garante que mesmo se um bug no frontend ou uma
-- chamada maliciosa tentar reduzir os contadores, o banco rejeita.

CREATE OR REPLACE FUNCTION public.prevent_counter_regression()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.total_questions < OLD.total_questions THEN
    RAISE EXCEPTION 'Counter regression denied: total_questions cannot decrease (% -> %)',
      OLD.total_questions, NEW.total_questions;
  END IF;

  IF NEW.correct_questions < OLD.correct_questions THEN
    RAISE EXCEPTION 'Counter regression denied: correct_questions cannot decrease (% -> %)',
      OLD.correct_questions, NEW.correct_questions;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_utk_no_counter_regression ON public.user_topic_knowledge;
CREATE TRIGGER trg_utk_no_counter_regression
  BEFORE UPDATE ON public.user_topic_knowledge
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_counter_regression();
