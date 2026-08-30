-- 1. Anti-ciclo no grafo de pré-requisitos
CREATE OR REPLACE FUNCTION public.prevent_prerequisite_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cycle_found boolean;
BEGIN
  WITH RECURSIVE reachable AS (
    SELECT NEW.prerequisite_topic_id AS node
    UNION
    SELECT tp.prerequisite_topic_id
    FROM public.topic_prerequisites tp
    JOIN reachable r ON tp.topic_id = r.node
  )
  SELECT EXISTS (SELECT 1 FROM reachable WHERE node = NEW.topic_id) INTO cycle_found;

  IF cycle_found THEN
    RAISE EXCEPTION 'Ciclo de pre-requisitos detectado: o topico % ja e pre-requisito (direto ou indireto) de %', NEW.topic_id, NEW.prerequisite_topic_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prereq_no_cycle
BEFORE INSERT OR UPDATE ON public.topic_prerequisites
FOR EACH ROW EXECUTE FUNCTION public.prevent_prerequisite_cycle();

-- 2. Validação de hierarquia de tópicos (pai na mesma matéria + depth derivado)
CREATE OR REPLACE FUNCTION public.validate_topic_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_subject uuid;
  parent_depth integer;
  ancestor uuid;
  guard integer := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.depth := 0;
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Um topico nao pode ser pai de si mesmo';
  END IF;

  SELECT subject_id, depth INTO parent_subject, parent_depth
  FROM public.topics WHERE id = NEW.parent_id;

  IF parent_subject IS NULL THEN
    RAISE EXCEPTION 'Topico pai inexistente';
  END IF;

  IF parent_subject <> NEW.subject_id THEN
    RAISE EXCEPTION 'O topico pai pertence a outra materia';
  END IF;

  ancestor := NEW.parent_id;
  WHILE ancestor IS NOT NULL AND guard < 100 LOOP
    IF ancestor = NEW.id THEN
      RAISE EXCEPTION 'Ciclo detectado na hierarquia de topicos';
    END IF;
    SELECT parent_id INTO ancestor FROM public.topics WHERE id = ancestor;
    guard := guard + 1;
  END LOOP;

  NEW.depth := COALESCE(parent_depth, 0) + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_topics_hierarchy
BEFORE INSERT OR UPDATE OF parent_id, subject_id ON public.topics
FOR EACH ROW EXECUTE FUNCTION public.validate_topic_hierarchy();

-- 3. Elo erro -> revisão
ALTER TABLE public.review_events
  ADD COLUMN error_id uuid REFERENCES public.error_entries(id) ON DELETE SET NULL;

-- 4. Enum para review_events.content_type + alvo obrigatório
CREATE TYPE public.review_content_type AS ENUM ('topico', 'flashcard', 'questao', 'material');

ALTER TABLE public.review_events
  ALTER COLUMN content_type DROP DEFAULT;

ALTER TABLE public.review_events
  ALTER COLUMN content_type TYPE public.review_content_type
  USING (CASE
    WHEN content_type IN ('topico', 'flashcard', 'questao', 'material') THEN content_type
    WHEN content_type IN ('topic') THEN 'topico'
    WHEN content_type IN ('question') THEN 'questao'
    ELSE 'topico'
  END)::public.review_content_type;

ALTER TABLE public.review_events
  ALTER COLUMN content_type SET DEFAULT 'topico'::public.review_content_type;

ALTER TABLE public.review_events
  ADD CONSTRAINT review_events_has_target CHECK (
    topic_id IS NOT NULL
    OR flashcard_id IS NOT NULL
    OR question_id IS NOT NULL
    OR material_id IS NOT NULL
  );

-- 5. Unicidade de tentativas
ALTER TABLE public.question_attempts
  ADD CONSTRAINT question_attempts_unique_try UNIQUE (user_id, question_id, attempt_number);

-- 6. Unicidade de "matéria inteira" por concurso
CREATE UNIQUE INDEX contest_topics_subject_only_unique
  ON public.contest_topics (contest_id, subject_id)
  WHERE topic_id IS NULL;

-- 7. Cache de IA por usuário
ALTER TABLE public.ai_results
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.ai_results
  ADD CONSTRAINT ai_results_has_input CHECK (input_ref <> '{}'::jsonb);

-- 8. Índices complementares
CREATE INDEX idx_reviews_flashcard ON public.review_events (flashcard_id);
CREATE INDEX idx_reviews_error ON public.review_events (error_id);
CREATE INDEX idx_errors_topic ON public.error_entries (topic_id);
CREATE INDEX idx_errors_attempt ON public.error_entries (attempt_id);
CREATE INDEX idx_questions_board_year ON public.questions (exam_board, year);
CREATE INDEX idx_flashcards_tags ON public.flashcards USING gin (tags);