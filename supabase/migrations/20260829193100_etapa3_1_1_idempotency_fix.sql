-- ETAPA 3.1.1: Correções de idempotência, concorrência e RLS granular

-- 1. UNIQUE constraint para idempotência real contra concorrência
-- Garante que duas chamadas simultâneas com o mesmo attempt_id + user_id
-- não criem registros duplicados.
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_history_attempt_user_unique
  ON public.knowledge_history (attempt_id, user_id)
  WHERE attempt_id IS NOT NULL;

-- 2. Substituir a policy FOR ALL por policies granulares (append-only)
DROP POLICY IF EXISTS "knowledge_history_own" ON public.knowledge_history;

-- SELECT: usuário vê apenas seus registros
CREATE POLICY "knowledge_history_select_own" ON public.knowledge_history
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- INSERT: usuário insere apenas para si mesmo
CREATE POLICY "knowledge_history_insert_own" ON public.knowledge_history
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Sem policies de UPDATE nem DELETE para authenticated = append-only garantido
-- (GRANT já não inclui UPDATE/DELETE, mas policies explicitamente ausentes
--  reforçam a intenção mesmo se GRANTs forem adicionados no futuro)

-- 3. Atualizar RPC para usar INSERT ... ON CONFLICT (atomicidade real)
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
BEGIN
  -- Verificar que o usuário autenticado é o mesmo
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: user_id mismatch';
  END IF;

  -- Idempotência atômica via INSERT ... ON CONFLICT no UNIQUE index.
  -- Se attempt_id já existe para este user_id, não insere e retorna NULL no id.
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
