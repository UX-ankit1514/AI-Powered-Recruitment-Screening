export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      actions: {
        Row: {
          at: string
          candidate_id: string
          company_id: string
          id: string
          new_value: Json | null
          note: string | null
          old_value: Json | null
          type: Database["public"]["Enums"]["action_type"]
          user_id: string | null
        }
        Insert: {
          at?: string
          candidate_id: string
          company_id: string
          id?: string
          new_value?: Json | null
          note?: string | null
          old_value?: Json | null
          type: Database["public"]["Enums"]["action_type"]
          user_id?: string | null
        }
        Update: {
          at?: string
          candidate_id?: string
          company_id?: string
          id?: string
          new_value?: Json | null
          note?: string | null
          old_value?: Json | null
          type?: Database["public"]["Enums"]["action_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "actions_candidate_id_company_id_fkey"
            columns: ["candidate_id", "company_id"]
            isOneToOne: false
            referencedRelation: "candidate_ranking"
            referencedColumns: ["candidate_id", "company_id"]
          },
          {
            foreignKeyName: "actions_candidate_id_company_id_fkey"
            columns: ["candidate_id", "company_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "actions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      apply_rate_limits: {
        Row: {
          at: string
          id: number
          ip_hash: string
        }
        Insert: {
          at?: string
          id?: number
          ip_hash: string
        }
        Update: {
          at?: string
          id?: number
          ip_hash?: string
        }
        Relationships: []
      }
      batches: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          done: number
          id: string
          job_id: string
          status: string
          total: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          done?: number
          id?: string
          job_id: string
          status?: string
          total?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          done?: number
          id?: string
          job_id?: string
          status?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_job_id_company_id_fkey"
            columns: ["job_id", "company_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      calls: {
        Row: {
          attempt: number
          batch_id: string | null
          bolna_execution_id: string | null
          call_kind: string
          callback_at: string | null
          candidate_id: string
          company_id: string
          cost: number | null
          created_at: string
          due_at: string
          duration_s: number | null
          id: string
          job_id: string
          locked_at: string | null
          outcome: Database["public"]["Enums"]["call_outcome"] | null
          recording_url: string | null
          reschedule_count: number
          scheduled: boolean
          score_attempts: number
          score_error: string | null
          score_next_at: string | null
          score_status: string | null
          started_at: string | null
          state: Database["public"]["Enums"]["call_state"]
          termination_reason: string | null
          transcript: string | null
        }
        Insert: {
          attempt?: number
          batch_id?: string | null
          bolna_execution_id?: string | null
          call_kind?: string
          callback_at?: string | null
          candidate_id: string
          company_id: string
          cost?: number | null
          created_at?: string
          due_at?: string
          duration_s?: number | null
          id?: string
          job_id: string
          locked_at?: string | null
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          recording_url?: string | null
          reschedule_count?: number
          scheduled?: boolean
          score_attempts?: number
          score_error?: string | null
          score_next_at?: string | null
          score_status?: string | null
          started_at?: string | null
          state?: Database["public"]["Enums"]["call_state"]
          termination_reason?: string | null
          transcript?: string | null
        }
        Update: {
          attempt?: number
          batch_id?: string | null
          bolna_execution_id?: string | null
          call_kind?: string
          callback_at?: string | null
          candidate_id?: string
          company_id?: string
          cost?: number | null
          created_at?: string
          due_at?: string
          duration_s?: number | null
          id?: string
          job_id?: string
          locked_at?: string | null
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          recording_url?: string | null
          reschedule_count?: number
          scheduled?: boolean
          score_attempts?: number
          score_error?: string | null
          score_next_at?: string | null
          score_status?: string | null
          started_at?: string | null
          state?: Database["public"]["Enums"]["call_state"]
          termination_reason?: string | null
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_batch_id_company_id_fkey"
            columns: ["batch_id", "company_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "calls_candidate_id_company_id_fkey"
            columns: ["candidate_id", "company_id"]
            isOneToOne: false
            referencedRelation: "candidate_ranking"
            referencedColumns: ["candidate_id", "company_id"]
          },
          {
            foreignKeyName: "calls_candidate_id_company_id_fkey"
            columns: ["candidate_id", "company_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "calls_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_job_id_company_id_fkey"
            columns: ["job_id", "company_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      candidates: {
        Row: {
          company_id: string
          consent_at: string | null
          consent_source: string | null
          created_at: string
          email: string | null
          id: string
          job_id: string
          name: string
          phone: string
          profile: Json | null
          resume_only_score: number | null
          resume_path: string | null
          source: string
          status: string
        }
        Insert: {
          company_id: string
          consent_at?: string | null
          consent_source?: string | null
          created_at?: string
          email?: string | null
          id?: string
          job_id: string
          name: string
          phone: string
          profile?: Json | null
          resume_only_score?: number | null
          resume_path?: string | null
          source: string
          status?: string
        }
        Update: {
          company_id?: string
          consent_at?: string | null
          consent_source?: string | null
          created_at?: string
          email?: string | null
          id?: string
          job_id?: string
          name?: string
          phone?: string
          profile?: Json | null
          resume_only_score?: number | null
          resume_path?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidates_job_id_company_id_fkey"
            columns: ["job_id", "company_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          culture_values: Json
          faq: Json
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          culture_values?: Json
          faq?: Json
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          culture_values?: Json
          faq?: Json
          id?: string
          name?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          ats_mode: string
          ats_rescue: boolean
          ats_top_pct: number
          calling_hours: Json
          company_id: string
          concurrency_limit: number
          created_at: string
          created_by: string | null
          culture_values: Json
          faq: Json
          id: string
          jd_text: string
          languages: string[]
          screening_started_at: string | null
          status: string
          title: string
        }
        Insert: {
          ats_mode?: string
          ats_rescue?: boolean
          ats_top_pct?: number
          calling_hours?: Json
          company_id: string
          concurrency_limit?: number
          created_at?: string
          created_by?: string | null
          culture_values?: Json
          faq?: Json
          id?: string
          jd_text?: string
          languages?: string[]
          screening_started_at?: string | null
          status?: string
          title: string
        }
        Update: {
          ats_mode?: string
          ats_rescue?: boolean
          ats_top_pct?: number
          calling_hours?: Json
          company_id?: string
          concurrency_limit?: number
          created_at?: string
          created_by?: string | null
          culture_values?: Json
          faq?: Json
          id?: string
          jd_text?: string
          languages?: string[]
          screening_started_at?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          company_id: string
          created_at: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      rubrics: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          custom_traits: Json
          id: string
          is_current: boolean
          job_id: string
          must_haves: Json
          nice_to_haves: Json
          version: number
          weights: Json
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          custom_traits?: Json
          id?: string
          is_current?: boolean
          job_id: string
          must_haves?: Json
          nice_to_haves?: Json
          version: number
          weights: Json
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          custom_traits?: Json
          id?: string
          is_current?: boolean
          job_id?: string
          must_haves?: Json
          nice_to_haves?: Json
          version?: number
          weights?: Json
        }
        Relationships: [
          {
            foreignKeyName: "rubrics_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rubrics_job_id_company_id_fkey"
            columns: ["job_id", "company_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      scores: {
        Row: {
          call_id: string
          candidate_id: string
          company_id: string
          created_at: string
          flags: Json
          id: string
          model_version: string | null
          must_have_results: Json
          profile_updates: Json | null
          prompt_version: string | null
          qualities: Json
          rubric_version: number
          short_exit: boolean
          summary: string
        }
        Insert: {
          call_id: string
          candidate_id: string
          company_id: string
          created_at?: string
          flags: Json
          id?: string
          model_version?: string | null
          must_have_results: Json
          profile_updates?: Json | null
          prompt_version?: string | null
          qualities: Json
          rubric_version: number
          short_exit?: boolean
          summary: string
        }
        Update: {
          call_id?: string
          candidate_id?: string
          company_id?: string
          created_at?: string
          flags?: Json
          id?: string
          model_version?: string | null
          must_have_results?: Json
          profile_updates?: Json | null
          prompt_version?: string | null
          qualities?: Json
          rubric_version?: number
          short_exit?: boolean
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "scores_call_id_company_id_fkey"
            columns: ["call_id", "company_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "scores_candidate_id_company_id_fkey"
            columns: ["candidate_id", "company_id"]
            isOneToOne: false
            referencedRelation: "candidate_ranking"
            referencedColumns: ["candidate_id", "company_id"]
          },
          {
            foreignKeyName: "scores_candidate_id_company_id_fkey"
            columns: ["candidate_id", "company_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "scores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          bolna_execution_id: string | null
          id: number
          payload: Json | null
          received_at: string
          status: string | null
        }
        Insert: {
          bolna_execution_id?: string | null
          id?: number
          payload?: Json | null
          received_at?: string
          status?: string | null
        }
        Update: {
          bolna_execution_id?: string | null
          id?: number
          payload?: Json | null
          received_at?: string
          status?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      candidate_ranking: {
        Row: {
          call_id: string | null
          candidate_id: string | null
          company_id: string | null
          current_rubric_version: number | null
          failed_must_have: boolean | null
          flags: Json | null
          job_id: string | null
          must_have_results: Json | null
          name: string | null
          overall: number | null
          pick: Database["public"]["Enums"]["pick"] | null
          qualities: Json | null
          resume_only_score: number | null
          score_id: string | null
          scored_rubric_version: number | null
          short_exit: boolean | null
          source: string | null
          status: string | null
          summary: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidates_job_id_company_id_fkey"
            columns: ["job_id", "company_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
    }
    Functions: {
      bump_batch_done: { Args: { p_batch_id: string }; Returns: undefined }
      claim_due_calls: {
        Args: { p_job_id?: string; p_limit?: number }
        Returns: {
          attempt: number
          call_id: string
          candidate_id: string
          company_id: string
          job_id: string
        }[]
      }
      claim_score_retries: {
        Args: { p_job_id?: string; p_limit?: number; p_max_attempts?: number }
        Returns: {
          attempt: number
          call_id: string
        }[]
      }
      save_rubric_version: {
        Args: {
          p_custom_traits: Json
          p_job_id: string
          p_must_haves: Json
          p_nice_to_haves: Json
          p_weights: Json
        }
        Returns: {
          company_id: string
          created_at: string
          created_by: string | null
          custom_traits: Json
          id: string
          is_current: boolean
          job_id: string
          must_haves: Json
          nice_to_haves: Json
          version: number
          weights: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "rubrics"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      action_type:
        | "shortlist"
        | "reject"
        | "override"
        | "note"
        | "recall"
        | "move_to_job"
      call_outcome:
        | "completed"
        | "short_exit"
        | "no_answer"
        | "busy"
        | "voicemail"
        | "wrong_person"
        | "declined"
        | "rescheduled"
        | "dropped"
        | "failed"
      call_state: "queued" | "dialing" | "in_call" | "finished"
      member_role: "admin" | "recruiter" | "hiring_manager"
      pick: "amazing" | "good" | "maybe" | "no"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      action_type: [
        "shortlist",
        "reject",
        "override",
        "note",
        "recall",
        "move_to_job",
      ],
      call_outcome: [
        "completed",
        "short_exit",
        "no_answer",
        "busy",
        "voicemail",
        "wrong_person",
        "declined",
        "rescheduled",
        "dropped",
        "failed",
      ],
      call_state: ["queued", "dialing", "in_call", "finished"],
      member_role: ["admin", "recruiter", "hiring_manager"],
      pick: ["amazing", "good", "maybe", "no"],
    },
  },
} as const

