import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarTodasPaginas } from "./paginacao.ts";

export const OBRAS_ULTIMO_REGISTRO_SELECT = "id,nome,registros_horas(data)";
export const REGISTROS_HORAS_RELACIONAMENTO = "registros_horas";

export interface ObraComUltimoRegistro {
  id: string;
  nome: string;
  registros_horas: Array<{ data: string }>;
}

export interface AlertaObraSemLancamento {
  tipo: "obra_sem_lancamento";
  titulo: string;
  mensagem: string;
  severidade: "warning" | "critical";
  metadata: { obra_id: string; obra_nome: string; dias: number };
  dedupe_key: string;
}

function dataIsoValida(valor: unknown): valor is string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
}

export function validarObrasComUltimoRegistro(valor: unknown): ObraComUltimoRegistro[] {
  if (!Array.isArray(valor)) throw new Error("Resposta inválida ao consultar obras e lançamentos");

  for (const item of valor) {
    if (typeof item !== "object" || item === null) {
      throw new Error("Obra inválida na consulta do último lançamento");
    }

    const obra = item as Record<string, unknown>;
    if (typeof obra.id !== "string" || typeof obra.nome !== "string") {
      throw new Error("Identificação inválida de obra na consulta do último lançamento");
    }
    if (!Array.isArray(obra.registros_horas) || obra.registros_horas.length > 1) {
      throw new Error("Relacionamento de registros de horas inválido para a obra");
    }

    for (const registro of obra.registros_horas) {
      if (
        typeof registro !== "object" ||
        registro === null ||
        !dataIsoValida((registro as Record<string, unknown>).data)
      ) {
        throw new Error("Data inválida no último lançamento da obra");
      }
    }
  }

  return valor as ObraComUltimoRegistro[];
}

export async function buscarObrasComUltimoRegistro(
  admin: SupabaseClient,
): Promise<ObraComUltimoRegistro[]> {
  const obras = await buscarTodasPaginas<unknown>((inicio, fim) =>
    admin
      .from("obras")
      .select(OBRAS_ULTIMO_REGISTRO_SELECT)
      .order("id", { ascending: true })
      .order("data", { referencedTable: REGISTROS_HORAS_RELACIONAMENTO, ascending: false })
      .order("id", { referencedTable: REGISTROS_HORAS_RELACIONAMENTO, ascending: false })
      .limit(1, { referencedTable: REGISTROS_HORAS_RELACIONAMENTO })
      .range(inicio, fim),
  );

  return validarObrasComUltimoRegistro(obras);
}

export function criarAlertasObrasSemLancamento({
  obras,
  hoje,
  hojeStr,
  diasSemLancamento,
}: {
  obras: ObraComUltimoRegistro[];
  hoje: Date;
  hojeStr: string;
  diasSemLancamento: number;
}): AlertaObraSemLancamento[] {
  const alertas: AlertaObraSemLancamento[] = [];

  for (const obra of obras) {
    const ultimo = obra.registros_horas[0]?.data;
    const dias = ultimo
      ? Math.floor((hoje.getTime() - new Date(ultimo).getTime()) / 86400000)
      : 999;

    if (dias > diasSemLancamento) {
      alertas.push({
        tipo: "obra_sem_lancamento",
        titulo: `Centro de custo sem lançamentos: ${obra.nome}`,
        mensagem: ultimo
          ? `O centro de custo ${obra.nome} não recebe registros de horas há ${dias} dias (último: ${new Date(ultimo).toLocaleDateString("pt-BR")}).`
          : `O centro de custo ${obra.nome} nunca recebeu registros de horas.`,
        severidade: dias > 7 ? "critical" : "warning",
        metadata: { obra_id: obra.id, obra_nome: obra.nome, dias },
        dedupe_key: `obra_sem_lancamento:${obra.id}:${hojeStr}`,
      });
    }
  }

  return alertas;
}
