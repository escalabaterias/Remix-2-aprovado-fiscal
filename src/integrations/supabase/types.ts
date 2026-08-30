export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      ai_results: {
        Row: {
          created_at: string;
          error_message: string | null;
          id: string;
          input_hash: string;
          input_ref: Json;
          model: string | null;
          output: Json | null;
          status: Database["public"]["Enums"]["processing_status"];
          task_type: string;
          tier: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          input_hash: string;
          input_ref?: Json;
          model?: string | null;
          output?: Json | null;
          status?: Database["public"]["Enums"]["processing_status"];
          task_type: string;
          tier?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          input_hash?: string;
          input_ref?: Json;
          model?: string | null;
          output?: Json | null;
          status?: Database["public"]["Enums"]["processing_status"];
          task_type?: string;
          tier?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      availability_weeks: {
        Row: {
          created_at: string;
          id: string;
          minutes_fri: number;
          minutes_mon: number;
          minutes_sat: number;
          minutes_sun: number;
          minutes_thu: number;
          minutes_tue: number;
          minutes_wed: number;
          notes: string | null;
          updated_at: string;
          user_id: string;
          week_start: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          minutes_fri?: number;
          minutes_mon?: number;
          minutes_sat?: number;
          minutes_sun?: number;
          minutes_thu?: number;
          minutes_tue?: number;
          minutes_wed?: number;
          notes?: string | null;
          updated_at?: string;
          user_id: string;
          week_start: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          minutes_fri?: number;
          minutes_mon?: number;
          minutes_sat?: number;
          minutes_sun?: number;
          minutes_thu?: number;
          minutes_tue?: number;
          minutes_wed?: number;
          notes?: string | null;
          updated_at?: string;
          user_id?: string;
          week_start?: string;
        };
        Relationships: [];
      };
      contest_topics: {
        Row: {
          contest_id: string;
          created_at: string;
          edital_id: string | null;
          id: string;
          in_edital: boolean;
          incidence_score: number | null;
          is_studied: boolean;
          notes: string | null;
          priority: number;
          relevance_score: number | null;
          studied_at: string | null;
          subject_id: string;
          topic_id: string | null;
          updated_at: string;
          user_id: string;
          weight: number | null;
        };
        Insert: {
          contest_id: string;
          created_at?: string;
          edital_id?: string | null;
          id?: string;
          in_edital?: boolean;
          incidence_score?: number | null;
          is_studied?: boolean;
          notes?: string | null;
          priority?: number;
          relevance_score?: number | null;
          studied_at?: string | null;
          subject_id: string;
          topic_id?: string | null;
          updated_at?: string;
          user_id: string;
          weight?: number | null;
        };
        Update: {
          contest_id?: string;
          created_at?: string;
          edital_id?: string | null;
          id?: string;
          in_edital?: boolean;
          incidence_score?: number | null;
          is_studied?: boolean;
          notes?: string | null;
          priority?: number;
          relevance_score?: number | null;
          studied_at?: string | null;
          subject_id?: string;
          topic_id?: string | null;
          updated_at?: string;
          user_id?: string;
          weight?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "contest_topics_contest_id_fkey";
            columns: ["contest_id"];
            isOneToOne: false;
            referencedRelation: "contests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contest_topics_edital_id_fkey";
            columns: ["edital_id"];
            isOneToOne: false;
            referencedRelation: "editais";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contest_topics_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contest_topics_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      contests: {
        Row: {
          area: string | null;
          created_at: string;
          description: string | null;
          edital_source_url: string | null;
          exam_board: string | null;
          exam_date: string | null;
          id: string;
          name: string;
          organization: string | null;
          role_title: string | null;
          status: Database["public"]["Enums"]["contest_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          area?: string | null;
          created_at?: string;
          description?: string | null;
          edital_source_url?: string | null;
          exam_board?: string | null;
          exam_date?: string | null;
          id?: string;
          name: string;
          organization?: string | null;
          role_title?: string | null;
          status?: Database["public"]["Enums"]["contest_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          area?: string | null;
          created_at?: string;
          description?: string | null;
          edital_source_url?: string | null;
          exam_board?: string | null;
          exam_date?: string | null;
          id?: string;
          name?: string;
          organization?: string | null;
          role_title?: string | null;
          status?: Database["public"]["Enums"]["contest_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      editais: {
        Row: {
          contest_id: string;
          created_at: string;
          file_path: string | null;
          id: string;
          is_rectification: boolean;
          notes: string | null;
          parent_edital_id: string | null;
          processed_at: string | null;
          processed_content: Json | null;
          processing_status: Database["public"]["Enums"]["processing_status"];
          published_at: string | null;
          raw_content: string | null;
          source: string | null;
          status: Database["public"]["Enums"]["edital_status"];
          updated_at: string;
          url: string | null;
          user_id: string;
          version: string;
          version_number: number;
        };
        Insert: {
          contest_id: string;
          created_at?: string;
          file_path?: string | null;
          id?: string;
          is_rectification?: boolean;
          notes?: string | null;
          parent_edital_id?: string | null;
          processed_at?: string | null;
          processed_content?: Json | null;
          processing_status?: Database["public"]["Enums"]["processing_status"];
          published_at?: string | null;
          raw_content?: string | null;
          source?: string | null;
          status?: Database["public"]["Enums"]["edital_status"];
          updated_at?: string;
          url?: string | null;
          user_id: string;
          version?: string;
          version_number?: number;
        };
        Update: {
          contest_id?: string;
          created_at?: string;
          file_path?: string | null;
          id?: string;
          is_rectification?: boolean;
          notes?: string | null;
          parent_edital_id?: string | null;
          processed_at?: string | null;
          processed_content?: Json | null;
          processing_status?: Database["public"]["Enums"]["processing_status"];
          published_at?: string | null;
          raw_content?: string | null;
          source?: string | null;
          status?: Database["public"]["Enums"]["edital_status"];
          updated_at?: string;
          url?: string | null;
          user_id?: string;
          version?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "editais_contest_id_fkey";
            columns: ["contest_id"];
            isOneToOne: false;
            referencedRelation: "contests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "editais_parent_edital_id_fkey";
            columns: ["parent_edital_id"];
            isOneToOne: false;
            referencedRelation: "editais";
            referencedColumns: ["id"];
          },
        ];
      };
      error_entries: {
        Row: {
          attempt_id: string | null;
          category: Database["public"]["Enums"]["error_category"] | null;
          created_at: string;
          diagnosis: string | null;
          id: string;
          intervention: string | null;
          is_resolved: boolean;
          notes: string | null;
          occurred_at: string;
          question_id: string | null;
          resolved_at: string | null;
          root_topic_id: string | null;
          subject_id: string | null;
          topic_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          attempt_id?: string | null;
          category?: Database["public"]["Enums"]["error_category"] | null;
          created_at?: string;
          diagnosis?: string | null;
          id?: string;
          intervention?: string | null;
          is_resolved?: boolean;
          notes?: string | null;
          occurred_at?: string;
          question_id?: string | null;
          resolved_at?: string | null;
          root_topic_id?: string | null;
          subject_id?: string | null;
          topic_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          attempt_id?: string | null;
          category?: Database["public"]["Enums"]["error_category"] | null;
          created_at?: string;
          diagnosis?: string | null;
          id?: string;
          intervention?: string | null;
          is_resolved?: boolean;
          notes?: string | null;
          occurred_at?: string;
          question_id?: string | null;
          resolved_at?: string | null;
          root_topic_id?: string | null;
          subject_id?: string | null;
          topic_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "error_entries_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "question_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "error_entries_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "error_entries_root_topic_id_fkey";
            columns: ["root_topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "error_entries_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "error_entries_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      flashcards: {
        Row: {
          back: string;
          created_at: string;
          difficulty: number | null;
          front: string;
          id: string;
          is_suspended: boolean;
          origin: string | null;
          question_id: string | null;
          source_id: string | null;
          subject_id: string | null;
          tags: string[];
          topic_id: string | null;
          type: Database["public"]["Enums"]["flashcard_type"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          back: string;
          created_at?: string;
          difficulty?: number | null;
          front: string;
          id?: string;
          is_suspended?: boolean;
          origin?: string | null;
          question_id?: string | null;
          source_id?: string | null;
          subject_id?: string | null;
          tags?: string[];
          topic_id?: string | null;
          type?: Database["public"]["Enums"]["flashcard_type"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          back?: string;
          created_at?: string;
          difficulty?: number | null;
          front?: string;
          id?: string;
          is_suspended?: boolean;
          origin?: string | null;
          question_id?: string | null;
          source_id?: string | null;
          subject_id?: string | null;
          tags?: string[];
          topic_id?: string | null;
          type?: Database["public"]["Enums"]["flashcard_type"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "flashcards_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "flashcards_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "flashcards_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "flashcards_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      generated_materials: {
        Row: {
          content: string | null;
          content_json: Json | null;
          contest_id: string | null;
          created_at: string;
          file_path: string | null;
          generation_metadata: Json;
          id: string;
          source_ids: string[];
          subject_id: string | null;
          title: string;
          topic_id: string | null;
          type: Database["public"]["Enums"]["material_type"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content?: string | null;
          content_json?: Json | null;
          contest_id?: string | null;
          created_at?: string;
          file_path?: string | null;
          generation_metadata?: Json;
          id?: string;
          source_ids?: string[];
          subject_id?: string | null;
          title: string;
          topic_id?: string | null;
          type?: Database["public"]["Enums"]["material_type"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content?: string | null;
          content_json?: Json | null;
          contest_id?: string | null;
          created_at?: string;
          file_path?: string | null;
          generation_metadata?: Json;
          id?: string;
          source_ids?: string[];
          subject_id?: string | null;
          title?: string;
          topic_id?: string | null;
          type?: Database["public"]["Enums"]["material_type"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "generated_materials_contest_id_fkey";
            columns: ["contest_id"];
            isOneToOne: false;
            referencedRelation: "contests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generated_materials_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generated_materials_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_history: {
        Row: {
          attempt_id: string | null;
          confidence: number;
          contest_id: string | null;
          correct_questions: number;
          created_at: string;
          id: string;
          last_studied_at: string | null;
          mastery_after: number;
          mastery_before: number;
          reason: string | null;
          review_count: number;
          session_id: string | null;
          subject_id: string | null;
          topic_id: string;
          total_questions: number;
          user_id: string;
        };
        Insert: {
          attempt_id?: string | null;
          confidence?: number;
          contest_id?: string | null;
          correct_questions?: number;
          created_at?: string;
          id?: string;
          last_studied_at?: string | null;
          mastery_after?: number;
          mastery_before?: number;
          reason?: string | null;
          review_count?: number;
          session_id?: string | null;
          subject_id?: string | null;
          topic_id: string;
          total_questions?: number;
          user_id: string;
        };
        Update: {
          attempt_id?: string | null;
          confidence?: number;
          contest_id?: string | null;
          correct_questions?: number;
          created_at?: string;
          id?: string;
          last_studied_at?: string | null;
          mastery_after?: number;
          mastery_before?: number;
          reason?: string | null;
          review_count?: number;
          session_id?: string | null;
          subject_id?: string | null;
          topic_id?: string;
          total_questions?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_history_contest_id_fkey";
            columns: ["contest_id"];
            isOneToOne: false;
            referencedRelation: "contests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_history_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_history_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_blocks: {
        Row: {
          block_date: string | null;
          created_at: string;
          cycle_number: number | null;
          id: string;
          name: string;
          notes: string | null;
          plan_id: string;
          planned_minutes: number | null;
          position: number;
          updated_at: string;
          user_id: string;
          week_start: string | null;
        };
        Insert: {
          block_date?: string | null;
          created_at?: string;
          cycle_number?: number | null;
          id?: string;
          name: string;
          notes?: string | null;
          plan_id: string;
          planned_minutes?: number | null;
          position?: number;
          updated_at?: string;
          user_id: string;
          week_start?: string | null;
        };
        Update: {
          block_date?: string | null;
          created_at?: string;
          cycle_number?: number | null;
          id?: string;
          name?: string;
          notes?: string | null;
          plan_id?: string;
          planned_minutes?: number | null;
          position?: number;
          updated_at?: string;
          user_id?: string;
          week_start?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "plan_blocks_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "study_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_tasks: {
        Row: {
          activity: string | null;
          activity_type: Database["public"]["Enums"]["activity_kind"] | null;
          actual_minutes: number | null;
          block_id: string | null;
          completed_at: string | null;
          correct_count: number;
          created_at: string;
          gross_minutes: number | null;
          id: string;
          notes: string | null;
          original_date: string | null;
          plan_id: string;
          planned_minutes: number | null;
          position: number;
          priority_reason: string | null;
          priority_score: number | null;
          questions_count: number;
          rescheduled_count: number;
          review_event_id: string | null;
          scheduled_date: string | null;
          session_id: string | null;
          source: string;
          status: Database["public"]["Enums"]["task_status"];
          subject_id: string | null;
          title: string;
          topic_id: string | null;
          updated_at: string;
          user_id: string;
          wrong_count: number;
        };
        Insert: {
          activity?: string | null;
          activity_type?: Database["public"]["Enums"]["activity_kind"] | null;
          actual_minutes?: number | null;
          block_id?: string | null;
          completed_at?: string | null;
          correct_count?: number;
          created_at?: string;
          gross_minutes?: number | null;
          id?: string;
          notes?: string | null;
          original_date?: string | null;
          plan_id: string;
          planned_minutes?: number | null;
          position?: number;
          priority_reason?: string | null;
          priority_score?: number | null;
          questions_count?: number;
          rescheduled_count?: number;
          review_event_id?: string | null;
          scheduled_date?: string | null;
          session_id?: string | null;
          source?: string;
          status?: Database["public"]["Enums"]["task_status"];
          subject_id?: string | null;
          title: string;
          topic_id?: string | null;
          updated_at?: string;
          user_id: string;
          wrong_count?: number;
        };
        Update: {
          activity?: string | null;
          activity_type?: Database["public"]["Enums"]["activity_kind"] | null;
          actual_minutes?: number | null;
          block_id?: string | null;
          completed_at?: string | null;
          correct_count?: number;
          created_at?: string;
          gross_minutes?: number | null;
          id?: string;
          notes?: string | null;
          original_date?: string | null;
          plan_id?: string;
          planned_minutes?: number | null;
          position?: number;
          priority_reason?: string | null;
          priority_score?: number | null;
          questions_count?: number;
          rescheduled_count?: number;
          review_event_id?: string | null;
          scheduled_date?: string | null;
          session_id?: string | null;
          source?: string;
          status?: Database["public"]["Enums"]["task_status"];
          subject_id?: string | null;
          title?: string;
          topic_id?: string | null;
          updated_at?: string;
          user_id?: string;
          wrong_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "plan_tasks_block_id_fkey";
            columns: ["block_id"];
            isOneToOne: false;
            referencedRelation: "plan_blocks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_tasks_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "study_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_tasks_review_event_id_fkey";
            columns: ["review_event_id"];
            isOneToOne: false;
            referencedRelation: "review_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_tasks_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "study_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_tasks_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_tasks_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          coach_autonomy: Database["public"]["Enums"]["coach_autonomy"];
          coach_intensity: Database["public"]["Enums"]["coach_intensity"];
          created_at: string;
          email: string | null;
          experience_level: string | null;
          full_name: string | null;
          id: string;
          preferences: Json;
          settings: Json;
          target_area: string | null;
          timezone: string;
          updated_at: string;
          weekly_availability: Json;
          weekly_availability_hours: number | null;
        };
        Insert: {
          coach_autonomy?: Database["public"]["Enums"]["coach_autonomy"];
          coach_intensity?: Database["public"]["Enums"]["coach_intensity"];
          created_at?: string;
          email?: string | null;
          experience_level?: string | null;
          full_name?: string | null;
          id: string;
          preferences?: Json;
          settings?: Json;
          target_area?: string | null;
          timezone?: string;
          updated_at?: string;
          weekly_availability?: Json;
          weekly_availability_hours?: number | null;
        };
        Update: {
          coach_autonomy?: Database["public"]["Enums"]["coach_autonomy"];
          coach_intensity?: Database["public"]["Enums"]["coach_intensity"];
          created_at?: string;
          email?: string | null;
          experience_level?: string | null;
          full_name?: string | null;
          id?: string;
          preferences?: Json;
          settings?: Json;
          target_area?: string | null;
          timezone?: string;
          updated_at?: string;
          weekly_availability?: Json;
          weekly_availability_hours?: number | null;
        };
        Relationships: [];
      };
      question_attempts: {
        Row: {
          answered_at: string;
          attempt_number: number;
          chosen_answer: string | null;
          contest_id: string | null;
          created_at: string;
          declared_confidence: number | null;
          id: string;
          is_correct: boolean | null;
          mode: Database["public"]["Enums"]["attempt_mode"];
          notes: string | null;
          question_id: string;
          session_id: string | null;
          time_spent_seconds: number | null;
          user_id: string;
        };
        Insert: {
          answered_at?: string;
          attempt_number?: number;
          chosen_answer?: string | null;
          contest_id?: string | null;
          created_at?: string;
          declared_confidence?: number | null;
          id?: string;
          is_correct?: boolean | null;
          mode?: Database["public"]["Enums"]["attempt_mode"];
          notes?: string | null;
          question_id: string;
          session_id?: string | null;
          time_spent_seconds?: number | null;
          user_id: string;
        };
        Update: {
          answered_at?: string;
          attempt_number?: number;
          chosen_answer?: string | null;
          contest_id?: string | null;
          created_at?: string;
          declared_confidence?: number | null;
          id?: string;
          is_correct?: boolean | null;
          mode?: Database["public"]["Enums"]["attempt_mode"];
          notes?: string | null;
          question_id?: string;
          session_id?: string | null;
          time_spent_seconds?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "question_attempts_contest_id_fkey";
            columns: ["contest_id"];
            isOneToOne: false;
            referencedRelation: "contests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_attempts_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_attempts_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "study_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      question_set_items: {
        Row: {
          attempt_id: string | null;
          chosen_answer: string | null;
          created_at: string;
          id: string;
          is_answered: boolean;
          is_correct: boolean | null;
          notes: string | null;
          position: number;
          question_id: string;
          set_id: string;
          time_spent_seconds: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          attempt_id?: string | null;
          chosen_answer?: string | null;
          created_at?: string;
          id?: string;
          is_answered?: boolean;
          is_correct?: boolean | null;
          notes?: string | null;
          position?: number;
          question_id: string;
          set_id: string;
          time_spent_seconds?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          attempt_id?: string | null;
          chosen_answer?: string | null;
          created_at?: string;
          id?: string;
          is_answered?: boolean;
          is_correct?: boolean | null;
          notes?: string | null;
          position?: number;
          question_id?: string;
          set_id?: string;
          time_spent_seconds?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "question_set_items_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "question_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_set_items_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_set_items_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "question_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      question_sets: {
        Row: {
          completed_at: string | null;
          contest_id: string | null;
          correct_count: number;
          created_at: string;
          description: string | null;
          id: string;
          is_completed: boolean;
          is_timed: boolean;
          metadata: Json;
          name: string;
          score: number | null;
          subject_id: string | null;
          tags: string[];
          time_limit_minutes: number | null;
          topic_id: string | null;
          total_questions: number;
          type: Database["public"]["Enums"]["question_set_type"];
          updated_at: string;
          user_id: string;
          wrong_count: number;
        };
        Insert: {
          completed_at?: string | null;
          contest_id?: string | null;
          correct_count?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_completed?: boolean;
          is_timed?: boolean;
          metadata?: Json;
          name: string;
          score?: number | null;
          subject_id?: string | null;
          tags?: string[];
          time_limit_minutes?: number | null;
          topic_id?: string | null;
          total_questions?: number;
          type?: Database["public"]["Enums"]["question_set_type"];
          updated_at?: string;
          user_id: string;
          wrong_count?: number;
        };
        Update: {
          completed_at?: string | null;
          contest_id?: string | null;
          correct_count?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_completed?: boolean;
          is_timed?: boolean;
          metadata?: Json;
          name?: string;
          score?: number | null;
          subject_id?: string | null;
          tags?: string[];
          time_limit_minutes?: number | null;
          topic_id?: string | null;
          total_questions?: number;
          type?: Database["public"]["Enums"]["question_set_type"];
          updated_at?: string;
          user_id?: string;
          wrong_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "question_sets_contest_id_fkey";
            columns: ["contest_id"];
            isOneToOne: false;
            referencedRelation: "contests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_sets_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "question_sets_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      question_stats: {
        Row: {
          avg_time_seconds: number | null;
          best_time_seconds: number | null;
          correct_count: number;
          created_at: string;
          id: string;
          last_attempted_at: string | null;
          last_correct_at: string | null;
          last_wrong_at: string | null;
          mastery_contribution: number | null;
          question_id: string;
          streak_correct: number;
          streak_wrong: number;
          total_attempts: number;
          updated_at: string;
          user_id: string;
          wrong_count: number;
        };
        Insert: {
          avg_time_seconds?: number | null;
          best_time_seconds?: number | null;
          correct_count?: number;
          created_at?: string;
          id?: string;
          last_attempted_at?: string | null;
          last_correct_at?: string | null;
          last_wrong_at?: string | null;
          mastery_contribution?: number | null;
          question_id: string;
          streak_correct?: number;
          streak_wrong?: number;
          total_attempts?: number;
          updated_at?: string;
          user_id: string;
          wrong_count?: number;
        };
        Update: {
          avg_time_seconds?: number | null;
          best_time_seconds?: number | null;
          correct_count?: number;
          created_at?: string;
          id?: string;
          last_attempted_at?: string | null;
          last_correct_at?: string | null;
          last_wrong_at?: string | null;
          mastery_contribution?: number | null;
          question_id?: string;
          streak_correct?: number;
          streak_wrong?: number;
          total_attempts?: number;
          updated_at?: string;
          user_id?: string;
          wrong_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "question_stats_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      questions: {
        Row: {
          alternatives: Json;
          comment_count: number;
          contest_id: string | null;
          contest_name: string | null;
          correct_answer: string | null;
          created_at: string;
          difficulty: number | null;
          exam_board: string | null;
          explanation: string | null;
          id: string;
          image_url: string | null;
          is_public: boolean;
          is_true_false: boolean;
          metadata: Json;
          novelty: Database["public"]["Enums"]["question_novelty"] | null;
          origin: Database["public"]["Enums"]["question_origin"];
          parent_question_id: string | null;
          source_id: string | null;
          statement: string;
          subject_id: string | null;
          tags: string[];
          topic_id: string | null;
          updated_at: string;
          user_id: string | null;
          year: number | null;
        };
        Insert: {
          alternatives?: Json;
          comment_count?: number;
          contest_id?: string | null;
          contest_name?: string | null;
          correct_answer?: string | null;
          created_at?: string;
          difficulty?: number | null;
          exam_board?: string | null;
          explanation?: string | null;
          id?: string;
          image_url?: string | null;
          is_public?: boolean;
          is_true_false?: boolean;
          metadata?: Json;
          novelty?: Database["public"]["Enums"]["question_novelty"] | null;
          origin?: Database["public"]["Enums"]["question_origin"];
          parent_question_id?: string | null;
          source_id?: string | null;
          statement: string;
          subject_id?: string | null;
          tags?: string[];
          topic_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
          year?: number | null;
        };
        Update: {
          alternatives?: Json;
          comment_count?: number;
          contest_id?: string | null;
          contest_name?: string | null;
          correct_answer?: string | null;
          created_at?: string;
          difficulty?: number | null;
          exam_board?: string | null;
          explanation?: string | null;
          id?: string;
          image_url?: string | null;
          is_public?: boolean;
          is_true_false?: boolean;
          metadata?: Json;
          novelty?: Database["public"]["Enums"]["question_novelty"] | null;
          origin?: Database["public"]["Enums"]["question_origin"];
          parent_question_id?: string | null;
          source_id?: string | null;
          statement?: string;
          subject_id?: string | null;
          tags?: string[];
          topic_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
          year?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "questions_contest_id_fkey";
            columns: ["contest_id"];
            isOneToOne: false;
            referencedRelation: "contests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_parent_question_id_fkey";
            columns: ["parent_question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      review_events: {
        Row: {
          completed_at: string | null;
          confidence_at_review: number | null;
          content_type: Database["public"]["Enums"]["review_content_type"];
          created_at: string;
          difficulty: number | null;
          ease_factor: number | null;
          error_id: string | null;
          flashcard_id: string | null;
          id: string;
          intensity: Database["public"]["Enums"]["review_intensity"] | null;
          interval_days: number | null;
          mastery_at_review: number | null;
          material_id: string | null;
          next_review_date: string | null;
          notes: string | null;
          question_id: string | null;
          result: string | null;
          review_type_cat: Database["public"]["Enums"]["review_type"] | null;
          scheduled_for: string;
          session_id: string | null;
          subject_id: string | null;
          task_id: string | null;
          topic_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          confidence_at_review?: number | null;
          content_type?: Database["public"]["Enums"]["review_content_type"];
          created_at?: string;
          difficulty?: number | null;
          ease_factor?: number | null;
          error_id?: string | null;
          flashcard_id?: string | null;
          id?: string;
          intensity?: Database["public"]["Enums"]["review_intensity"] | null;
          interval_days?: number | null;
          mastery_at_review?: number | null;
          material_id?: string | null;
          next_review_date?: string | null;
          notes?: string | null;
          question_id?: string | null;
          result?: string | null;
          review_type_cat?: Database["public"]["Enums"]["review_type"] | null;
          scheduled_for?: string;
          session_id?: string | null;
          subject_id?: string | null;
          task_id?: string | null;
          topic_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          confidence_at_review?: number | null;
          content_type?: Database["public"]["Enums"]["review_content_type"];
          created_at?: string;
          difficulty?: number | null;
          ease_factor?: number | null;
          error_id?: string | null;
          flashcard_id?: string | null;
          id?: string;
          intensity?: Database["public"]["Enums"]["review_intensity"] | null;
          interval_days?: number | null;
          mastery_at_review?: number | null;
          material_id?: string | null;
          next_review_date?: string | null;
          notes?: string | null;
          question_id?: string | null;
          result?: string | null;
          review_type_cat?: Database["public"]["Enums"]["review_type"] | null;
          scheduled_for?: string;
          session_id?: string | null;
          subject_id?: string | null;
          task_id?: string | null;
          topic_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_events_error_id_fkey";
            columns: ["error_id"];
            isOneToOne: false;
            referencedRelation: "error_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_events_flashcard_id_fkey";
            columns: ["flashcard_id"];
            isOneToOne: false;
            referencedRelation: "flashcards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_events_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "generated_materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_events_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_events_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "study_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_events_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_events_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "plan_tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_events_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      sources: {
        Row: {
          author: string | null;
          contest_id: string | null;
          created_at: string;
          file_path: string | null;
          id: string;
          metadata: Json;
          origin: string | null;
          processed_at: string | null;
          processing_status: Database["public"]["Enums"]["processing_status"];
          published_at: string | null;
          reliability: number;
          subject_id: string | null;
          title: string;
          topic_id: string | null;
          type: Database["public"]["Enums"]["source_type"];
          updated_at: string;
          url: string | null;
          user_id: string;
        };
        Insert: {
          author?: string | null;
          contest_id?: string | null;
          created_at?: string;
          file_path?: string | null;
          id?: string;
          metadata?: Json;
          origin?: string | null;
          processed_at?: string | null;
          processing_status?: Database["public"]["Enums"]["processing_status"];
          published_at?: string | null;
          reliability?: number;
          subject_id?: string | null;
          title: string;
          topic_id?: string | null;
          type?: Database["public"]["Enums"]["source_type"];
          updated_at?: string;
          url?: string | null;
          user_id: string;
        };
        Update: {
          author?: string | null;
          contest_id?: string | null;
          created_at?: string;
          file_path?: string | null;
          id?: string;
          metadata?: Json;
          origin?: string | null;
          processed_at?: string | null;
          processing_status?: Database["public"]["Enums"]["processing_status"];
          published_at?: string | null;
          reliability?: number;
          subject_id?: string | null;
          title?: string;
          topic_id?: string | null;
          type?: Database["public"]["Enums"]["source_type"];
          updated_at?: string;
          url?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sources_contest_id_fkey";
            columns: ["contest_id"];
            isOneToOne: false;
            referencedRelation: "contests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sources_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sources_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      study_plans: {
        Row: {
          contest_id: string | null;
          created_at: string;
          end_date: string | null;
          id: string;
          is_active: boolean;
          name: string;
          settings: Json;
          start_date: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          contest_id?: string | null;
          created_at?: string;
          end_date?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          settings?: Json;
          start_date?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          contest_id?: string | null;
          created_at?: string;
          end_date?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          settings?: Json;
          start_date?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "study_plans_contest_id_fkey";
            columns: ["contest_id"];
            isOneToOne: false;
            referencedRelation: "contests";
            referencedColumns: ["id"];
          },
        ];
      };
      study_sessions: {
        Row: {
          activity: string | null;
          contest_id: string | null;
          correct_count: number;
          created_at: string;
          ended_at: string | null;
          gross_seconds: number;
          id: string;
          net_seconds: number;
          notes: string | null;
          questions_count: number;
          session_date: string;
          started_at: string | null;
          subject_id: string | null;
          topic_id: string | null;
          updated_at: string;
          user_id: string;
          wrong_count: number;
        };
        Insert: {
          activity?: string | null;
          contest_id?: string | null;
          correct_count?: number;
          created_at?: string;
          ended_at?: string | null;
          gross_seconds?: number;
          id?: string;
          net_seconds?: number;
          notes?: string | null;
          questions_count?: number;
          session_date?: string;
          started_at?: string | null;
          subject_id?: string | null;
          topic_id?: string | null;
          updated_at?: string;
          user_id: string;
          wrong_count?: number;
        };
        Update: {
          activity?: string | null;
          contest_id?: string | null;
          correct_count?: number;
          created_at?: string;
          ended_at?: string | null;
          gross_seconds?: number;
          id?: string;
          net_seconds?: number;
          notes?: string | null;
          questions_count?: number;
          session_date?: string;
          started_at?: string | null;
          subject_id?: string | null;
          topic_id?: string | null;
          updated_at?: string;
          user_id?: string;
          wrong_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "study_sessions_contest_id_fkey";
            columns: ["contest_id"];
            isOneToOne: false;
            referencedRelation: "contests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_sessions_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_sessions_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      subjects: {
        Row: {
          area: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          is_global: boolean;
          is_quantitative: boolean;
          name: string;
          slug: string | null;
          updated_at: string;
        };
        Insert: {
          area?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_global?: boolean;
          is_quantitative?: boolean;
          name: string;
          slug?: string | null;
          updated_at?: string;
        };
        Update: {
          area?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_global?: boolean;
          is_quantitative?: boolean;
          name?: string;
          slug?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      topic_prerequisites: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          notes: string | null;
          prerequisite_topic_id: string;
          strength: number;
          topic_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          prerequisite_topic_id: string;
          strength?: number;
          topic_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          prerequisite_topic_id?: string;
          strength?: number;
          topic_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "topic_prerequisites_prerequisite_topic_id_fkey";
            columns: ["prerequisite_topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "topic_prerequisites_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      topics: {
        Row: {
          code: string | null;
          created_at: string;
          created_by: string | null;
          depth: number;
          description: string | null;
          id: string;
          is_global: boolean;
          kind: Database["public"]["Enums"]["topic_kind"];
          name: string;
          parent_id: string | null;
          position: number;
          subject_id: string;
          updated_at: string;
        };
        Insert: {
          code?: string | null;
          created_at?: string;
          created_by?: string | null;
          depth?: number;
          description?: string | null;
          id?: string;
          is_global?: boolean;
          kind?: Database["public"]["Enums"]["topic_kind"];
          name: string;
          parent_id?: string | null;
          position?: number;
          subject_id: string;
          updated_at?: string;
        };
        Update: {
          code?: string | null;
          created_at?: string;
          created_by?: string | null;
          depth?: number;
          description?: string | null;
          id?: string;
          is_global?: boolean;
          kind?: Database["public"]["Enums"]["topic_kind"];
          name?: string;
          parent_id?: string | null;
          position?: number;
          subject_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "topics_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "topics_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id"];
          },
        ];
      };
      user_topic_knowledge: {
        Row: {
          confidence: number | null;
          consistency: number | null;
          correct_questions: number;
          created_at: string;
          id: string;
          last_practiced_at: string | null;
          last_review_at: string | null;
          last_review_result: Database["public"]["Enums"]["review_result"] | null;
          last_studied_at: string | null;
          mastery: number | null;
          metrics: Json;
          next_review_at: string | null;
          retention: number | null;
          review_count: number;
          speed_score: number | null;
          topic_id: string;
          total_questions: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          confidence?: number | null;
          consistency?: number | null;
          correct_questions?: number;
          created_at?: string;
          id?: string;
          last_practiced_at?: string | null;
          last_review_at?: string | null;
          last_review_result?: Database["public"]["Enums"]["review_result"] | null;
          last_studied_at?: string | null;
          mastery?: number | null;
          metrics?: Json;
          next_review_at?: string | null;
          retention?: number | null;
          review_count?: number;
          speed_score?: number | null;
          topic_id: string;
          total_questions?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          confidence?: number | null;
          consistency?: number | null;
          correct_questions?: number;
          created_at?: string;
          id?: string;
          last_practiced_at?: string | null;
          last_review_at?: string | null;
          last_review_result?: Database["public"]["Enums"]["review_result"] | null;
          last_studied_at?: string | null;
          mastery?: number | null;
          metrics?: Json;
          next_review_at?: string | null;
          retention?: number | null;
          review_count?: number;
          speed_score?: number | null;
          topic_id?: string;
          total_questions?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_topic_knowledge_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      process_attempt_knowledge: {
        Args: {
          p_attempt_id: string;
          p_confidence: number;
          p_contest_id: string;
          p_correct_questions: number;
          p_error_category?: Database["public"]["Enums"]["error_category"];
          p_error_question_id?: string;
          p_error_root_topic_id?: string;
          p_last_studied_at: string;
          p_mastery_after: number;
          p_mastery_before: number;
          p_reason: string;
          p_review_count: number;
          p_session_id: string;
          p_subject_id: string;
          p_topic_id: string;
          p_total_questions: number;
          p_user_id: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      activity_kind:
        | "teoria"
        | "questoes"
        | "revisao"
        | "flashcards"
        | "simulado"
        | "exercicios"
        | "leitura"
        | "estudo_dirigido";
      attempt_mode: "estudo" | "revisao" | "simulado" | "diagnostico" | "flashcard" | "outro";
      coach_autonomy: "sugestivo" | "assistido" | "autonomo";
      coach_intensity: "leve" | "moderada" | "intensa";
      contest_status: "futuro" | "ativo" | "concluido" | "arquivado";
      edital_status: "rascunho" | "publicado" | "retificado" | "substituido" | "arquivado";
      error_category:
        | "conhecimento"
        | "esquecimento"
        | "interpretacao"
        | "calculo"
        | "atencao"
        | "estrategia"
        | "velocidade"
        | "outros";
      flashcard_type:
        "pergunta_resposta" | "cloze" | "contraste" | "pegadinha" | "recuperacao_ativa";
      material_type: "resumo" | "mapa_mental" | "mnemonico" | "pdf" | "revisao" | "outro";
      processing_status: "pendente" | "processando" | "processado" | "erro" | "ignorado";
      question_novelty: "conhecida" | "nova" | "inedita" | "variacao";
      question_origin:
        "banco_externo" | "manual" | "ocr" | "prova_oficial" | "ia" | "variacao_sistema";
      question_set_type: "simulado" | "lista" | "caderno" | "revisao" | "diagnostico";
      review_content_type: "topico" | "flashcard" | "questao" | "material";
      review_intensity: "leve" | "moderada" | "intensiva";
      review_result: "success" | "partial" | "fail";
      review_type: "manutencao" | "consolidacao" | "recuperacao" | "erro_direcionado";
      source_type:
        | "pdf"
        | "video"
        | "youtube"
        | "livro"
        | "legislacao"
        | "jurisprudencia"
        | "prova"
        | "questao"
        | "anotacao"
        | "site"
        | "documento"
        | "material_proprio"
        | "outro";
      task_status:
        | "pendente"
        | "em_andamento"
        | "concluida"
        | "adiada"
        | "cancelada"
        | "parcialmente_concluida"
        | "reagendada";
      topic_kind: "topico" | "subtopico" | "conceito";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      activity_kind: [
        "teoria",
        "questoes",
        "revisao",
        "flashcards",
        "simulado",
        "exercicios",
        "leitura",
        "estudo_dirigido",
      ],
      attempt_mode: ["estudo", "revisao", "simulado", "diagnostico", "flashcard", "outro"],
      coach_autonomy: ["sugestivo", "assistido", "autonomo"],
      coach_intensity: ["leve", "moderada", "intensa"],
      contest_status: ["futuro", "ativo", "concluido", "arquivado"],
      edital_status: ["rascunho", "publicado", "retificado", "substituido", "arquivado"],
      error_category: [
        "conhecimento",
        "esquecimento",
        "interpretacao",
        "calculo",
        "atencao",
        "estrategia",
        "velocidade",
        "outros",
      ],
      flashcard_type: ["pergunta_resposta", "cloze", "contraste", "pegadinha", "recuperacao_ativa"],
      material_type: ["resumo", "mapa_mental", "mnemonico", "pdf", "revisao", "outro"],
      processing_status: ["pendente", "processando", "processado", "erro", "ignorado"],
      question_novelty: ["conhecida", "nova", "inedita", "variacao"],
      question_origin: [
        "banco_externo",
        "manual",
        "ocr",
        "prova_oficial",
        "ia",
        "variacao_sistema",
      ],
      question_set_type: ["simulado", "lista", "caderno", "revisao", "diagnostico"],
      review_content_type: ["topico", "flashcard", "questao", "material"],
      review_intensity: ["leve", "moderada", "intensiva"],
      review_result: ["success", "partial", "fail"],
      review_type: ["manutencao", "consolidacao", "recuperacao", "erro_direcionado"],
      source_type: [
        "pdf",
        "video",
        "youtube",
        "livro",
        "legislacao",
        "jurisprudencia",
        "prova",
        "questao",
        "anotacao",
        "site",
        "documento",
        "material_proprio",
        "outro",
      ],
      task_status: [
        "pendente",
        "em_andamento",
        "concluida",
        "adiada",
        "cancelada",
        "parcialmente_concluida",
        "reagendada",
      ],
      topic_kind: ["topico", "subtopico", "conceito"],
    },
  },
} as const;
