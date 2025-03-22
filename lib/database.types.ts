export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      messages: {
        Row: {
          last_sent_time: string | null;
          message_id: string;
          message_text: string;
          next_message_to_send: string | null;
          submission_id: string;
          timezone: string;
        };
        Insert: {
          last_sent_time?: string | null;
          message_id?: string;
          message_text: string;
          next_message_to_send?: string | null;
          submission_id: string;
          timezone: string;
        };
        Update: {
          last_sent_time?: string | null;
          message_id?: string;
          message_text?: string;
          next_message_to_send?: string | null;
          submission_id?: string;
          timezone?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_next_message_to_send_fkey";
            columns: ["next_message_to_send"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["message_id"];
          },
          {
            foreignKeyName: "messages_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "submissions";
            referencedColumns: ["submission_id"];
          },
        ];
      };
      quiz_questions: {
        Row: {
          answer_text: string;
          created_at: string | null;
          last_sent_time: string | null;
          next_question_id: string | null;
          question_id: string;
          question_text: string;
          submission_id: string;
          timezone: string;
        };
        Insert: {
          answer_text: string;
          created_at?: string | null;
          last_sent_time?: string | null;
          next_question_id?: string | null;
          question_id: string;
          question_text: string;
          submission_id: string;
          timezone: string;
        };
        Update: {
          answer_text?: string;
          created_at?: string | null;
          last_sent_time?: string | null;
          next_question_id?: string | null;
          question_id?: string;
          question_text?: string;
          submission_id?: string;
          timezone?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_next_question_id";
            columns: ["next_question_id"];
            isOneToOne: false;
            referencedRelation: "quiz_questions";
            referencedColumns: ["question_id"];
          },
          {
            foreignKeyName: "quiz_questions_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "quiz_submissions";
            referencedColumns: ["submission_id"];
          },
        ];
      };
      quiz_submissions: {
        Row: {
          cadence: string;
          created_at: string | null;
          first_question_id: string | null;
          last_sent_time: string | null;
          question_to_send: string | null;
          reading_level: string | null;
          repeat: string;
          start_time: string;
          submission_id: string;
          text_field: string | null;
          timezone: string;
          title: string | null;
          updated_at: string | null;
          uploaded_files: string[] | null;
          user_id: string;
        };
        Insert: {
          cadence: string;
          created_at?: string | null;
          first_question_id?: string | null;
          last_sent_time?: string | null;
          question_to_send?: string | null;
          reading_level?: string | null;
          repeat: string;
          start_time: string;
          submission_id: string;
          text_field?: string | null;
          timezone: string;
          title?: string | null;
          updated_at?: string | null;
          uploaded_files?: string[] | null;
          user_id: string;
        };
        Update: {
          cadence?: string;
          created_at?: string | null;
          first_question_id?: string | null;
          last_sent_time?: string | null;
          question_to_send?: string | null;
          reading_level?: string | null;
          repeat?: string;
          start_time?: string;
          submission_id?: string;
          text_field?: string | null;
          timezone?: string;
          title?: string | null;
          updated_at?: string | null;
          uploaded_files?: string[] | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quiz_submissions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      submissions: {
        Row: {
          cadence: string;
          created_at: string | null;
          first_message_id: string | null;
          last_sent_time: string | null;
          message_to_send: string | null;
          reading_level: string | null;
          repeat: string | null;
          start_time: string;
          submission_id: string;
          text_field: string | null;
          timezone: string;
          title: string | null;
          updated_at: string | null;
          uploaded_files: string[] | null;
          user_id: string;
        };
        Insert: {
          cadence: string;
          created_at?: string | null;
          first_message_id?: string | null;
          last_sent_time?: string | null;
          message_to_send?: string | null;
          reading_level?: string | null;
          repeat?: string | null;
          start_time: string;
          submission_id?: string;
          text_field?: string | null;
          timezone: string;
          title?: string | null;
          updated_at?: string | null;
          uploaded_files?: string[] | null;
          user_id: string;
        };
        Update: {
          cadence?: string;
          created_at?: string | null;
          first_message_id?: string | null;
          last_sent_time?: string | null;
          message_to_send?: string | null;
          reading_level?: string | null;
          repeat?: string | null;
          start_time?: string;
          submission_id?: string;
          text_field?: string | null;
          timezone?: string;
          title?: string | null;
          updated_at?: string | null;
          uploaded_files?: string[] | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_message_to_send";
            columns: ["message_to_send"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["message_id"];
          },
          {
            foreignKeyName: "submissions_first_message_id_fkey";
            columns: ["first_message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["message_id"];
          },
          {
            foreignKeyName: "submissions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          area_code: string;
          created_at: string | null;
          first_name: string;
          id: string;
          is_subscribed: boolean | null;
          last_name: string;
          phone_number: string;
          stripe_id: string | null;
          timezone: string;
          updated_at: string | null;
        };
        Insert: {
          area_code: string;
          created_at?: string | null;
          first_name: string;
          id: string;
          is_subscribed?: boolean | null;
          last_name: string;
          phone_number: string;
          stripe_id?: string | null;
          timezone: string;
          updated_at?: string | null;
        };
        Update: {
          area_code?: string;
          created_at?: string | null;
          first_name?: string;
          id?: string;
          is_subscribed?: boolean | null;
          last_name?: string;
          phone_number?: string;
          stripe_id?: string | null;
          timezone?: string;
          updated_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database[Extract<keyof Database, "public">];

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;
