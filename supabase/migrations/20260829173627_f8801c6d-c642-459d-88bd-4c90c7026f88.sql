-- ============ helpers ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ enums ============
CREATE TYPE public.contest_status AS ENUM ('futuro','ativo','concluido','arquivado');
CREATE TYPE public.edital_status AS ENUM ('rascunho','publicado','retificado','substituido','arquivado');
CREATE TYPE public.processing_status AS ENUM ('pendente','processando','processado','erro','ignorado');
CREATE TYPE public.source_type AS ENUM ('pdf','video','youtube','livro','legislacao','jurisprudencia','prova','questao','anotacao','site','documento','material_proprio','outro');
CREATE TYPE public.question_origin AS ENUM ('banco_externo','manual','ocr','prova_oficial','ia','variacao_sistema');
CREATE TYPE public.question_novelty AS ENUM ('conhecida','nova','inedita','variacao');
CREATE TYPE public.attempt_mode AS ENUM ('estudo','revisao','simulado','diagnostico','flashcard','outro');
CREATE TYPE public.error_category AS ENUM ('conhecimento','esquecimento','interpretacao','calculo','atencao','estrategia','velocidade','outros');
CREATE TYPE public.flashcard_type AS ENUM ('pergunta_resposta','cloze','contraste','pegadinha','recuperacao_ativa');
CREATE TYPE public.material_type AS ENUM ('resumo','mapa_mental','mnemonico','pdf','revisao','outro');
CREATE TYPE public.task_status AS ENUM ('pendente','em_andamento','concluida','adiada','cancelada');
CREATE TYPE public.topic_kind AS ENUM ('topico','subtopico','conceito');
CREATE TYPE public.coach_intensity AS ENUM ('leve','moderada','intensa');
CREATE TYPE public.coach_autonomy AS ENUM ('sugestivo','assistido','autonomo');

-- ============ profiles ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  target_area TEXT,
  experience_level TEXT,
  weekly_availability_hours NUMERIC(5,2),
  weekly_availability JSONB NOT NULL DEFAULT '{}'::jsonb,
  timezone TEXT NOT NULL DEFAULT 'America/Fortaleza',
  coach_intensity public.coach_intensity NOT NULL DEFAULT 'moderada',
  coach_autonomy public.coach_autonomy NOT NULL DEFAULT 'assistido',
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_own" ON public.profiles FOR ALL TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ subjects (global catalog) ============
CREATE TABLE public.subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  area TEXT,
  is_quantitative BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_global BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subjects TO authenticated;
GRANT ALL ON public.subjects TO service_role;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subjects_read" ON public.subjects FOR SELECT TO authenticated USING (true);
CREATE POLICY "subjects_insert" ON public.subjects FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "subjects_update" ON public.subjects FOR UPDATE TO authenticated USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);
CREATE POLICY "subjects_delete" ON public.subjects FOR DELETE TO authenticated USING (auth.uid() = created_by);
CREATE TRIGGER trg_subjects_updated BEFORE UPDATE ON public.subjects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_subjects_name ON public.subjects (name);

-- ============ topics (hierarchical) ============
CREATE TABLE public.topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.topics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind public.topic_kind NOT NULL DEFAULT 'topico',
  depth INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  code TEXT,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_global BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topics TO authenticated;
GRANT ALL ON public.topics TO service_role;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topics_read" ON public.topics FOR SELECT TO authenticated USING (true);
CREATE POLICY "topics_insert" ON public.topics FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "topics_update" ON public.topics FOR UPDATE TO authenticated USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);
CREATE POLICY "topics_delete" ON public.topics FOR DELETE TO authenticated USING (auth.uid() = created_by);
CREATE TRIGGER trg_topics_updated BEFORE UPDATE ON public.topics FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_topics_subject ON public.topics (subject_id);
CREATE INDEX idx_topics_parent ON public.topics (parent_id);

-- ============ prerequisites ============
CREATE TABLE public.topic_prerequisites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  prerequisite_topic_id UUID NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  strength SMALLINT NOT NULL DEFAULT 3,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT topic_prereq_unique UNIQUE (topic_id, prerequisite_topic_id),
  CONSTRAINT topic_prereq_not_self CHECK (topic_id <> prerequisite_topic_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topic_prerequisites TO authenticated;
GRANT ALL ON public.topic_prerequisites TO service_role;
ALTER TABLE public.topic_prerequisites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prereq_read" ON public.topic_prerequisites FOR SELECT TO authenticated USING (true);
CREATE POLICY "prereq_insert" ON public.topic_prerequisites FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "prereq_update" ON public.topic_prerequisites FOR UPDATE TO authenticated USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);
CREATE POLICY "prereq_delete" ON public.topic_prerequisites FOR DELETE TO authenticated USING (auth.uid() = created_by);
CREATE TRIGGER trg_prereq_updated BEFORE UPDATE ON public.topic_prerequisites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_prereq_topic ON public.topic_prerequisites (topic_id);
CREATE INDEX idx_prereq_pre ON public.topic_prerequisites (prerequisite_topic_id);

-- ============ contests ============
CREATE TABLE public.contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  organization TEXT,
  role_title TEXT,
  area TEXT,
  exam_board TEXT,
  exam_date DATE,
  status public.contest_status NOT NULL DEFAULT 'futuro',
  description TEXT,
  edital_source_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contests TO authenticated;
GRANT ALL ON public.contests TO service_role;
ALTER TABLE public.contests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contests_own" ON public.contests FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_contests_updated BEFORE UPDATE ON public.contests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_contests_user_status ON public.contests (user_id, status);

-- ============ editais ============
CREATE TABLE public.editais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contest_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  parent_edital_id UUID REFERENCES public.editais(id) ON DELETE SET NULL,
  version TEXT NOT NULL DEFAULT '1',
  version_number INTEGER NOT NULL DEFAULT 1,
  is_rectification BOOLEAN NOT NULL DEFAULT false,
  published_at DATE,
  source TEXT,
  file_path TEXT,
  url TEXT,
  raw_content TEXT,
  processed_content JSONB,
  processing_status public.processing_status NOT NULL DEFAULT 'pendente',
  processed_at TIMESTAMPTZ,
  status public.edital_status NOT NULL DEFAULT 'publicado',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.editais TO authenticated;
GRANT ALL ON public.editais TO service_role;
ALTER TABLE public.editais ENABLE ROW LEVEL SECURITY;
CREATE POLICY "editais_own" ON public.editais FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_editais_updated BEFORE UPDATE ON public.editais FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_editais_contest ON public.editais (contest_id, version_number);

-- ============ contest x subject x topic ============
CREATE TABLE public.contest_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contest_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  edital_id UUID REFERENCES public.editais(id) ON DELETE SET NULL,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES public.topics(id) ON DELETE CASCADE,
  priority SMALLINT NOT NULL DEFAULT 3,
  weight NUMERIC(6,2),
  incidence_score NUMERIC(6,2),
  relevance_score NUMERIC(6,2),
  in_edital BOOLEAN NOT NULL DEFAULT true,
  is_studied BOOLEAN NOT NULL DEFAULT false,
  studied_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contest_topic_unique UNIQUE (contest_id, subject_id, topic_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contest_topics TO authenticated;
GRANT ALL ON public.contest_topics TO service_role;
ALTER TABLE public.contest_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contest_topics_own" ON public.contest_topics FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_contest_topics_updated BEFORE UPDATE ON public.contest_topics FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_contest_topics_contest ON public.contest_topics (contest_id);
CREATE INDEX idx_contest_topics_topic ON public.contest_topics (topic_id);

-- ============ user knowledge (reusable, contest-independent) ============
CREATE TABLE public.user_topic_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  mastery NUMERIC(5,2),
  retention NUMERIC(5,2),
  confidence NUMERIC(5,2),
  speed_score NUMERIC(5,2),
  consistency NUMERIC(5,2),
  last_practiced_at TIMESTAMPTZ,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_topic_unique UNIQUE (user_id, topic_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_topic_knowledge TO authenticated;
GRANT ALL ON public.user_topic_knowledge TO service_role;
ALTER TABLE public.user_topic_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "utk_own" ON public.user_topic_knowledge FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_utk_updated BEFORE UPDATE ON public.user_topic_knowledge FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ sources ============
CREATE TABLE public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type public.source_type NOT NULL DEFAULT 'outro',
  origin TEXT,
  author TEXT,
  url TEXT,
  file_path TEXT,
  published_at DATE,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  contest_id UUID REFERENCES public.contests(id) ON DELETE SET NULL,
  reliability SMALLINT NOT NULL DEFAULT 3,
  processing_status public.processing_status NOT NULL DEFAULT 'pendente',
  processed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sources TO authenticated;
GRANT ALL ON public.sources TO service_role;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sources_own" ON public.sources FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_sources_updated BEFORE UPDATE ON public.sources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_sources_user ON public.sources (user_id, type);

-- ============ questions ============
CREATE TABLE public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  is_public BOOLEAN NOT NULL DEFAULT false,
  statement TEXT NOT NULL,
  alternatives JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_answer TEXT,
  is_true_false BOOLEAN NOT NULL DEFAULT false,
  exam_board TEXT,
  contest_id UUID REFERENCES public.contests(id) ON DELETE SET NULL,
  contest_name TEXT,
  year INTEGER,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  difficulty SMALLINT,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  explanation TEXT,
  image_url TEXT,
  origin public.question_origin NOT NULL DEFAULT 'manual',
  novelty public.question_novelty,
  parent_question_id UUID REFERENCES public.questions(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions TO authenticated;
GRANT ALL ON public.questions TO service_role;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "questions_read" ON public.questions FOR SELECT TO authenticated USING (is_public OR auth.uid() = user_id);
CREATE POLICY "questions_insert" ON public.questions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "questions_update" ON public.questions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "questions_delete" ON public.questions FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_questions_updated BEFORE UPDATE ON public.questions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_questions_topic ON public.questions (topic_id);
CREATE INDEX idx_questions_subject ON public.questions (subject_id);
CREATE INDEX idx_questions_user ON public.questions (user_id);

-- ============ study sessions ============
CREATE TABLE public.study_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES public.contests(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  gross_seconds INTEGER NOT NULL DEFAULT 0,
  net_seconds INTEGER NOT NULL DEFAULT 0,
  activity TEXT,
  questions_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_sessions TO authenticated;
GRANT ALL ON public.study_sessions TO service_role;
ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions_own" ON public.study_sessions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_sessions_updated BEFORE UPDATE ON public.study_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_sessions_user_date ON public.study_sessions (user_id, session_date DESC);

-- ============ question attempts ============
CREATE TABLE public.question_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES public.contests(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.study_sessions(id) ON DELETE SET NULL,
  chosen_answer TEXT,
  is_correct BOOLEAN,
  time_spent_seconds INTEGER,
  declared_confidence SMALLINT,
  mode public.attempt_mode NOT NULL DEFAULT 'estudo',
  attempt_number INTEGER NOT NULL DEFAULT 1,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_attempts TO authenticated;
GRANT ALL ON public.question_attempts TO service_role;
ALTER TABLE public.question_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attempts_own" ON public.question_attempts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_attempts_user_q ON public.question_attempts (user_id, question_id, attempt_number);
CREATE INDEX idx_attempts_answered ON public.question_attempts (user_id, answered_at DESC);

-- ============ error log ============
CREATE TABLE public.error_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_id UUID REFERENCES public.question_attempts(id) ON DELETE SET NULL,
  question_id UUID REFERENCES public.questions(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  root_topic_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  category public.error_category,
  diagnosis TEXT,
  intervention TEXT,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.error_entries TO authenticated;
GRANT ALL ON public.error_entries TO service_role;
ALTER TABLE public.error_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "errors_own" ON public.error_entries FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_errors_updated BEFORE UPDATE ON public.error_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_errors_user ON public.error_entries (user_id, occurred_at DESC);

-- ============ flashcards ============
CREATE TABLE public.flashcards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  type public.flashcard_type NOT NULL DEFAULT 'pergunta_resposta',
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  question_id UUID REFERENCES public.questions(id) ON DELETE SET NULL,
  difficulty SMALLINT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  origin TEXT,
  is_suspended BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flashcards TO authenticated;
GRANT ALL ON public.flashcards TO service_role;
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flashcards_own" ON public.flashcards FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_flashcards_updated BEFORE UPDATE ON public.flashcards FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_flashcards_user ON public.flashcards (user_id, topic_id);

-- ============ generated materials ============
CREATE TABLE public.generated_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type public.material_type NOT NULL DEFAULT 'resumo',
  content TEXT,
  content_json JSONB,
  contest_id UUID REFERENCES public.contests(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  source_ids UUID[] NOT NULL DEFAULT '{}',
  file_path TEXT,
  generation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_materials TO authenticated;
GRANT ALL ON public.generated_materials TO service_role;
ALTER TABLE public.generated_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "materials_own" ON public.generated_materials FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_materials_updated BEFORE UPDATE ON public.generated_materials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_materials_user ON public.generated_materials (user_id, type);

-- ============ study plans ============
CREATE TABLE public.study_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contest_id UUID REFERENCES public.contests(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_plans TO authenticated;
GRANT ALL ON public.study_plans TO service_role;
ALTER TABLE public.study_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans_own" ON public.study_plans FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON public.study_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.plan_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.study_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  block_date DATE,
  position INTEGER NOT NULL DEFAULT 0,
  planned_minutes INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_blocks TO authenticated;
GRANT ALL ON public.plan_blocks TO service_role;
ALTER TABLE public.plan_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blocks_own" ON public.plan_blocks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_blocks_updated BEFORE UPDATE ON public.plan_blocks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_blocks_plan ON public.plan_blocks (plan_id, block_date);

CREATE TABLE public.plan_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.study_plans(id) ON DELETE CASCADE,
  block_id UUID REFERENCES public.plan_blocks(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  activity TEXT,
  scheduled_date DATE,
  planned_minutes INTEGER,
  actual_minutes INTEGER,
  status public.task_status NOT NULL DEFAULT 'pendente',
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_tasks TO authenticated;
GRANT ALL ON public.plan_tasks TO service_role;
ALTER TABLE public.plan_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks_own" ON public.plan_tasks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.plan_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_tasks_user_date ON public.plan_tasks (user_id, scheduled_date, status);

-- ============ reviews ============
CREATE TABLE public.review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL DEFAULT 'topico',
  topic_id UUID REFERENCES public.topics(id) ON DELETE CASCADE,
  flashcard_id UUID REFERENCES public.flashcards(id) ON DELETE CASCADE,
  question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE,
  material_id UUID REFERENCES public.generated_materials(id) ON DELETE SET NULL,
  scheduled_for DATE NOT NULL DEFAULT CURRENT_DATE,
  completed_at TIMESTAMPTZ,
  result TEXT,
  difficulty SMALLINT,
  interval_days INTEGER,
  ease_factor NUMERIC(4,2),
  next_review_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.review_events TO authenticated;
GRANT ALL ON public.review_events TO service_role;
ALTER TABLE public.review_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews_own" ON public.review_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_reviews_updated BEFORE UPDATE ON public.review_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_reviews_user_due ON public.review_events (user_id, scheduled_for);

-- ============ AI cache (process once -> store -> reuse) ============
CREATE TABLE public.ai_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'rapida',
  input_hash TEXT NOT NULL,
  input_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  model TEXT,
  status public.processing_status NOT NULL DEFAULT 'pendente',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_results_unique UNIQUE (user_id, task_type, input_hash)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_results TO authenticated;
GRANT ALL ON public.ai_results TO service_role;
ALTER TABLE public.ai_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_results_own" ON public.ai_results FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_ai_results_updated BEFORE UPDATE ON public.ai_results FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_ai_results_lookup ON public.ai_results (task_type, input_hash);