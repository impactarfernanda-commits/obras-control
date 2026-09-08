import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Role } from "./access-control";
import { z } from "zod";
import { MENSAGEM_COMPETENCIA_FECHADA, mensagemErroCompetenciaFechada } from "./competencias.ts";
import { mensagemErroRegistro, registroEhAusenciaPlanejada } from "./registro-falta.ts";

export type AusenciaSelecionada = {
  id: string;
  funcionario_id: string;
  obra_id: string;
  data: string;
  tipo_registro: string;
  observacoes: string | null;
  created_by: string | null;
};

const periodoSchema = z.object({
  registro_id: z.string().min(1),
  ausencia_periodo_id: z.string().min(1).nullable(),
  funcionario_id: z.string().min(1),
  obra_id: z.string().min(1),
  tipo_registro: z.enum(["ferias", "folga_campo"]),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantidade_dias: z.number().int().positive(),
  observacoes: z.string().nullable(),
});
export type PeriodoAusencia = z.infer<typeof periodoSchema>;

export const QUERIES_AUSENCIAS = [
  "alocacoes-mes",
  "alocacoes-current",
  "registros-mes",
  "registros",
  "registros-week",
  "registros-cycle",
  "aloc-week",
  "registros-horas-detalhes",
  "registros-horas-detalhes-relatorio",
  "relatorio-sem-alocacao",
  "relatorio-centros-custo",
  "planejamento-hh",
  "regs-dash",
] as const;

export function permissoesAusencia(
  registroOnly: boolean,
  registro: AusenciaSelecionada,
  userId: string | undefined,
  role: Role | null,
) {
  const elegivel = registroOnly && !!userId && registroEhAusenciaPlanejada(registro);
  const criador = registro.created_by === userId;
  const gerente = role === "gerente" || role === "diretor";
  return {
    editar: elegivel && (criador || gerente || role === "coordenador"),
    excluir: elegivel && (criador || gerente),
  };
}

export function mensagemErroAusencia(error: { code?: string; message?: string }) {
  if (error.message?.toLowerCase().includes("competencia fechada")) {
    return MENSAGEM_COMPETENCIA_FECHADA;
  }
  return (
    mensagemErroCompetenciaFechada(error) ??
    (error.code === "42501"
      ? "Você não tem permissão para alterar este lançamento ou sua sessão expirou."
      : mensagemErroRegistro(error))
  );
}

function validarAusencia(registro: AusenciaSelecionada) {
  if (!registro.id || !registroEhAusenciaPlanejada(registro)) {
    throw new Error("Selecione um lançamento de Férias ou Folga de campo.");
  }
}

export async function obterPeriodoAusencia(
  client: SupabaseClient<Database>,
  registro: AusenciaSelecionada,
) {
  validarAusencia(registro);
  const { data, error } = await client.rpc("obras_obter_ausencia_planejada_periodo", {
    p_registro_id: registro.id,
  });
  if (error) throw new Error(mensagemErroAusencia(error));
  const resultado = periodoSchema.safeParse(data);
  if (
    !resultado.success ||
    resultado.data.registro_id !== registro.id ||
    resultado.data.funcionario_id !== registro.funcionario_id ||
    resultado.data.obra_id !== registro.obra_id ||
    resultado.data.tipo_registro !== registro.tipo_registro ||
    resultado.data.data_inicio > resultado.data.data_fim
  ) {
    throw new Error(
      "Não foi possível obter o período deste lançamento. Atualize a tela e tente novamente.",
    );
  }
  return resultado.data;
}

export async function editarAusencia(
  client: SupabaseClient<Database>,
  registro: AusenciaSelecionada,
  dataInicio: string,
  dataFim: string,
  observacoes: string,
) {
  validarAusencia(registro);
  const { error } = await client.rpc("obras_editar_ausencia_planejada_periodo", {
    p_registro_id: registro.id,
    p_data_inicio: dataInicio,
    p_data_fim: dataFim,
    p_observacoes: observacoes.trim() || null,
  });
  if (error) throw new Error(mensagemErroAusencia(error));
}

export async function excluirAusencia(
  client: SupabaseClient<Database>,
  registro: AusenciaSelecionada,
  confirmar: (mensagem: string) => boolean,
) {
  validarAusencia(registro);
  if (
    !confirmar("Excluir somente este lançamento? Os outros dias e as alocações serão preservados.")
  ) {
    return false;
  }
  const { error } = await client.rpc("obras_excluir_ausencia_planejada", {
    p_registro_id: registro.id,
  });
  if (error) throw new Error(mensagemErroAusencia(error));
  return true;
}
