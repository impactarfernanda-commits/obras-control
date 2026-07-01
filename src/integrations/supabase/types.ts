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
  public: {
    Tables: {
      alocacoes: {
        Row: {
          created_at: string
          created_by: string | null
          data: string
          funcionario_id: string
          id: string
          obra_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: string
          funcionario_id: string
          id?: string
          obra_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: string
          funcionario_id?: string
          id?: string
          obra_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alocacoes_funcionario_id_fkey"
            columns: ["funcionario_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alocacoes_funcionario_id_fkey"
            columns: ["funcionario_id"]
            isOneToOne: false
            referencedRelation: "funcionarios_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alocacoes_obra_id_fkey"
            columns: ["obra_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id"]
          },
        ]
      }
      beneficios_config: {
        Row: {
          assistencia_medica: number
          assistencia_odontologica: number
          id: boolean
          multibeneficio: number
          updated_at: string
          vale_alimentacao: number
        }
        Insert: {
          assistencia_medica?: number
          assistencia_odontologica?: number
          id?: boolean
          multibeneficio?: number
          updated_at?: string
          vale_alimentacao?: number
        }
        Update: {
          assistencia_medica?: number
          assistencia_odontologica?: number
          id?: boolean
          multibeneficio?: number
          updated_at?: string
          vale_alimentacao?: number
        }
        Relationships: []
      }
      categoria_salarios: {
        Row: {
          categoria: string
          encargos: number
          salario: number
          seguro_vida: number
          updated_at: string
        }
        Insert: {
          categoria: string
          encargos?: number
          salario?: number
          seguro_vida?: number
          updated_at?: string
        }
        Update: {
          categoria?: string
          encargos?: number
          salario?: number
          seguro_vida?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categoria_salarios_categoria_fkey"
            columns: ["categoria"]
            isOneToOne: true
            referencedRelation: "categorias"
            referencedColumns: ["nome"]
          },
        ]
      }
      categorias: {
        Row: {
          created_at: string
          nome: string
          tipo: string
        }
        Insert: {
          created_at?: string
          nome: string
          tipo: string
        }
        Update: {
          created_at?: string
          nome?: string
          tipo?: string
        }
        Relationships: []
      }
      custos_indiretos: {
        Row: {
          categoria_id: string
          created_at: string
          data: string
          descricao: string
          id: string
          obra_id: string
          responsavel_id: string
          updated_at: string
          valor: number
        }
        Insert: {
          categoria_id: string
          created_at?: string
          data: string
          descricao: string
          id?: string
          obra_id: string
          responsavel_id: string
          updated_at?: string
          valor: number
        }
        Update: {
          categoria_id?: string
          created_at?: string
          data?: string
          descricao?: string
          id?: string
          obra_id?: string
          responsavel_id?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "custos_indiretos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "custos_indiretos_categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_indiretos_obra_id_fkey"
            columns: ["obra_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id"]
          },
        ]
      }
      custos_indiretos_categorias: {
        Row: {
          created_at: string
          id: string
          nome: string
          predefinida: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          predefinida?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          predefinida?: boolean
        }
        Relationships: []
      }
      funcionarios: {
        Row: {
          ativo: boolean
          categoria_mo: string
          created_at: string
          data_desligamento: string | null
          encargos: number
          id: string
          nome: string
          salario: number
        }
        Insert: {
          ativo?: boolean
          categoria_mo: string
          created_at?: string
          data_desligamento?: string | null
          encargos?: number
          id?: string
          nome: string
          salario?: number
        }
        Update: {
          ativo?: boolean
          categoria_mo?: string
          created_at?: string
          data_desligamento?: string | null
          encargos?: number
          id?: string
          nome?: string
          salario?: number
        }
        Relationships: []
      }
      notificacao_config: {
        Row: {
          created_at: string
          frequencia_email: string
          thresholds: Json
          tipos_ativos: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          frequencia_email?: string
          thresholds?: Json
          tipos_ativos?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          frequencia_email?: string
          thresholds?: Json
          tipos_ativos?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notificacoes: {
        Row: {
          created_at: string
          dedupe_key: string | null
          id: string
          lida: boolean
          mensagem: string
          metadata: Json
          resolvida: boolean
          resolvida_em: string | null
          resolvida_por: string | null
          severidade: string
          tipo: string
          titulo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dedupe_key?: string | null
          id?: string
          lida?: boolean
          mensagem: string
          metadata?: Json
          resolvida?: boolean
          resolvida_em?: string | null
          resolvida_por?: string | null
          severidade?: string
          tipo: string
          titulo: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string | null
          id?: string
          lida?: boolean
          mensagem?: string
          metadata?: Json
          resolvida?: boolean
          resolvida_em?: string | null
          resolvida_por?: string | null
          severidade?: string
          tipo?: string
          titulo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      obras: {
        Row: {
          created_at: string
          data_inicio: string | null
          id: string
          nome: string
          status: string
        }
        Insert: {
          created_at?: string
          data_inicio?: string | null
          id?: string
          nome: string
          status?: string
        }
        Update: {
          created_at?: string
          data_inicio?: string | null
          id?: string
          nome?: string
          status?: string
        }
        Relationships: []
      }
      registros_horas: {
        Row: {
          ausencia: boolean
          created_at: string
          created_by: string | null
          data: string
          funcionario_id: string
          horas_extras: number
          horas_normais: number
          id: string
          justificativa_extras: string | null
          motivo_ausencia: string | null
          obra_id: string
          observacoes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ausencia?: boolean
          created_at?: string
          created_by?: string | null
          data: string
          funcionario_id: string
          horas_extras?: number
          horas_normais?: number
          id?: string
          justificativa_extras?: string | null
          motivo_ausencia?: string | null
          obra_id: string
          observacoes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ausencia?: boolean
          created_at?: string
          created_by?: string | null
          data?: string
          funcionario_id?: string
          horas_extras?: number
          horas_normais?: number
          id?: string
          justificativa_extras?: string | null
          motivo_ausencia?: string | null
          obra_id?: string
          observacoes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registros_horas_funcionario_id_fkey"
            columns: ["funcionario_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registros_horas_funcionario_id_fkey"
            columns: ["funcionario_id"]
            isOneToOne: false
            referencedRelation: "funcionarios_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registros_horas_obra_id_fkey"
            columns: ["obra_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          created_at: string
          id: string
          obra_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          obra_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          obra_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_obra_id_fkey"
            columns: ["obra_id"]
            isOneToOne: false
            referencedRelation: "obras"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      users_profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      funcionarios_safe: {
        Row: {
          ativo: boolean | null
          categoria_mo: string | null
          created_at: string | null
          data_desligamento: string | null
          encargos: number | null
          id: string | null
          nome: string | null
          salario: number | null
        }
        Insert: {
          ativo?: boolean | null
          categoria_mo?: string | null
          created_at?: string | null
          data_desligamento?: string | null
          encargos?: never
          id?: string | null
          nome?: string | null
          salario?: never
        }
        Update: {
          ativo?: boolean | null
          categoria_mo?: string | null
          created_at?: string | null
          data_desligamento?: string | null
          encargos?: never
          id?: string | null
          nome?: string | null
          salario?: never
        }
        Relationships: []
      }
    }
    Functions: {
      can_view_salario: { Args: { _user_id: string }; Returns: boolean }
      get_funcionario_salario_masked: {
        Args: { _id: string }
        Returns: {
          encargos: number
          salario: number
        }[]
      }
      get_user_level: { Args: { _user_id: string }; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "assistente"
        | "supervisor"
        | "coordenador"
        | "gerente"
        | "diretor"
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
  public: {
    Enums: {
      app_role: [
        "assistente",
        "supervisor",
        "coordenador",
        "gerente",
        "diretor",
      ],
    },
  },
} as const
