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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_config: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          ai_run_id: string | null
          ai_started_at: string | null
          ai_status: Database["public"]["Enums"]["ai_status"]
          channel: Database["public"]["Enums"]["conversation_channel"]
          created_at: string
          handoff_at: string | null
          handoff_reason: string | null
          id: string
          last_message_at: string
          last_message_preview: string | null
          line_user_id: string | null
          mode: Database["public"]["Enums"]["conversation_mode"]
          realtime_token: string
          short_code: string | null
          unread_count: number
          web_session_id: string | null
        }
        Insert: {
          ai_run_id?: string | null
          ai_started_at?: string | null
          ai_status?: Database["public"]["Enums"]["ai_status"]
          channel: Database["public"]["Enums"]["conversation_channel"]
          created_at?: string
          handoff_at?: string | null
          handoff_reason?: string | null
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          line_user_id?: string | null
          mode?: Database["public"]["Enums"]["conversation_mode"]
          realtime_token?: string
          short_code?: string | null
          unread_count?: number
          web_session_id?: string | null
        }
        Update: {
          ai_run_id?: string | null
          ai_started_at?: string | null
          ai_status?: Database["public"]["Enums"]["ai_status"]
          channel?: Database["public"]["Enums"]["conversation_channel"]
          created_at?: string
          handoff_at?: string | null
          handoff_reason?: string | null
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          line_user_id?: string | null
          mode?: Database["public"]["Enums"]["conversation_mode"]
          realtime_token?: string
          short_code?: string | null
          unread_count?: number
          web_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_line_user_id_fkey"
            columns: ["line_user_id"]
            isOneToOne: false
            referencedRelation: "line_users"
            referencedColumns: ["id"]
          },
        ]
      }
      faq_entries: {
        Row: {
          answer: string
          created_at: string
          id: string
          is_active: boolean
          question: string
          sort_order: number
          tags: string[]
          updated_at: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          is_active?: boolean
          question: string
          sort_order?: number
          tags?: string[]
          updated_at?: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          is_active?: boolean
          question?: string
          sort_order?: number
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      line_users: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          is_friend: boolean
          language: string | null
          line_user_id: string
          picture_url: string | null
          profile_fetched_at: string | null
          status_message: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          is_friend?: boolean
          language?: string | null
          line_user_id: string
          picture_url?: string | null
          profile_fetched_at?: string | null
          status_message?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          is_friend?: boolean
          language?: string | null
          line_user_id?: string
          picture_url?: string | null
          profile_fetched_at?: string | null
          status_message?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      line_webhook_events: {
        Row: {
          event_type: string
          is_redelivery: boolean
          payload: Json | null
          received_at: string
          webhook_event_id: string
        }
        Insert: {
          event_type: string
          is_redelivery?: boolean
          payload?: Json | null
          received_at?: string
          webhook_event_id: string
        }
        Update: {
          event_type?: string
          is_redelivery?: boolean
          payload?: Json | null
          received_at?: string
          webhook_event_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          content_type: string
          conversation_id: string
          created_at: string
          delivery_error: string | null
          delivery_status: string
          direction: Database["public"]["Enums"]["message_direction"]
          id: string
          line_event_id: string | null
          line_message_id: string | null
          line_reply_token: string | null
          line_reply_token_at: string | null
          quoted_line_message_id: string | null
          raw: Json | null
          sender: Database["public"]["Enums"]["message_sender"]
        }
        Insert: {
          content?: string
          content_type?: string
          conversation_id: string
          created_at?: string
          delivery_error?: string | null
          delivery_status?: string
          direction: Database["public"]["Enums"]["message_direction"]
          id?: string
          line_event_id?: string | null
          line_message_id?: string | null
          line_reply_token?: string | null
          line_reply_token_at?: string | null
          quoted_line_message_id?: string | null
          raw?: Json | null
          sender: Database["public"]["Enums"]["message_sender"]
        }
        Update: {
          content?: string
          content_type?: string
          conversation_id?: string
          created_at?: string
          delivery_error?: string | null
          delivery_status?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          id?: string
          line_event_id?: string | null
          line_message_id?: string | null
          line_reply_token?: string | null
          line_reply_token_at?: string | null
          quoted_line_message_id?: string | null
          raw?: Json | null
          sender?: Database["public"]["Enums"]["message_sender"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      gen_short_code: { Args: never; Returns: string }
      ingest_line_message: {
        Args: {
          p_content: string
          p_content_type: string
          p_event_type: string
          p_is_redelivery: boolean
          p_line_message_id: string
          p_line_user_id: string
          p_quoted_line_message_id: string
          p_raw: Json
          p_reply_token: string
          p_webhook_event_id: string
        }
        Returns: {
          contact_id: string
          conversation_id: string
          is_duplicate: boolean
          message_id: string
          needs_profile: boolean
          realtime_token: string
        }[]
      }
      search_faq: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          answer: string
          question: string
          score: number
        }[]
      }
    }
    Enums: {
      ai_status: "idle" | "running" | "error"
      conversation_channel: "line" | "web"
      conversation_mode: "ai" | "manual"
      message_direction: "inbound" | "outbound"
      message_sender: "line_user" | "web_visitor" | "operator" | "ai" | "system"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ai_status: ["idle", "running", "error"],
      conversation_channel: ["line", "web"],
      conversation_mode: ["ai", "manual"],
      message_direction: ["inbound", "outbound"],
      message_sender: ["line_user", "web_visitor", "operator", "ai", "system"],
    },
  },
} as const
