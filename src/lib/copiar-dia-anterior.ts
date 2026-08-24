import type { CalculoJornada } from "./jornada-horas";

export type ItemCopiaDia = {
  funcionario_id: string;
  nome: string;
  status: "adicionar" | "copiado" | "ja_existente" | "inelegivel" | "excluido_destino";
  motivo: string | null;
};

export type JornadaCopiaRascunho = {
  funcionarioId: string;
  incluirNaCopia: boolean;
  horaEntrada: string;
  horaSaida: string;
  intervaloMinutos: number;
  horasNormais: number;
  horasExtras: number;
  justificativa: string | null;
  observacoes: string | null;
  detalhe: CalculoJornada;
  ajustada: boolean;
};

export type ResumoCopiaDia = {
  origem_data: string;
  destino_data: string;
  total_origem: number;
  total_copiados: number;
  total_ja_existentes: number;
  total_inelegiveis: number;
  total_suprimidos: number;
  total_adicionar: number;
  itens: ItemCopiaDia[];
};

export function ultimaDataAnterior(datas: readonly string[], destino: string) {
  return datas.filter((data) => data < destino).sort((a, b) => b.localeCompare(a))[0] ?? null;
}

export function formatarDataCopia(data: string) {
  return new Date(`${data}T00:00:00`).toLocaleDateString("pt-BR");
}

export function totalSelecionadosCopia(
  itens: readonly ItemCopiaDia[],
  rascunhos: Readonly<Record<string, JornadaCopiaRascunho>>,
) {
  return itens.filter(
    (item) => item.status === "adicionar" && rascunhos[item.funcionario_id]?.incluirNaCopia,
  ).length;
}

export function totalNaoCopiar(
  itens: readonly ItemCopiaDia[],
  rascunhos: Readonly<Record<string, JornadaCopiaRascunho>>,
) {
  return itens.filter(
    (item) => item.status === "adicionar" && !rascunhos[item.funcionario_id]?.incluirNaCopia,
  ).length;
}

export function itensSelecionadosCopia<T extends ItemCopiaDia>(
  itens: readonly T[],
  rascunhos: Readonly<Record<string, JornadaCopiaRascunho>>,
) {
  return itens.filter(
    (item) => item.status === "adicionar" && rascunhos[item.funcionario_id]?.incluirNaCopia,
  );
}

export function logErroCopiaDia(etapa: "previa" | "aplicacao", error: unknown) {
  if (!import.meta.env.DEV) return;
  const detalhe = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  console.error(`[CopiarDiaAnterior][${etapa}]`, {
    message: typeof detalhe.message === "string" ? detalhe.message : "Erro desconhecido",
    code: typeof detalhe.code === "string" ? detalhe.code : undefined,
    details: typeof detalhe.details === "string" ? detalhe.details : undefined,
    hint: typeof detalhe.hint === "string" ? detalhe.hint : undefined,
  });
}
