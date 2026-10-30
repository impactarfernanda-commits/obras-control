import type { QueryKey } from "@tanstack/react-query";

export type PeriodoOperacional = Readonly<{
  inicio: string;
  fim: string;
}>;

type LinhaComData = Readonly<{ data: string }>;

type RealtimePayloadMinimo = Readonly<{
  eventType?: string;
  old?: unknown;
  new?: unknown;
}>;

export type DatasEventoOperacional = Readonly<{
  conservador: boolean;
  datas: readonly string[];
}>;

export type QueriesOperacionaisAfetadas = Readonly<{
  semana: boolean;
  competencia: boolean;
}>;

export type EstadoEdicaoOperacional = "idle" | "dirty" | "saving" | "saved" | "error";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function dataOperacionalValida(value: unknown): value is string {
  return typeof value === "string" && DATA_ISO.test(value);
}

export function periodoOperacionalValido(periodo: PeriodoOperacional): boolean {
  return (
    dataOperacionalValida(periodo.inicio) &&
    dataOperacionalValida(periodo.fim) &&
    periodo.inicio <= periodo.fim
  );
}

export function periodoContemData(periodo: PeriodoOperacional, data: string): boolean {
  return (
    periodoOperacionalValido(periodo) &&
    dataOperacionalValida(data) &&
    periodo.inicio <= data &&
    data <= periodo.fim
  );
}

export function periodoContemPeriodo(
  periodoExterno: PeriodoOperacional,
  periodoInterno: PeriodoOperacional,
): boolean {
  return (
    periodoOperacionalValido(periodoExterno) &&
    periodoOperacionalValido(periodoInterno) &&
    periodoExterno.inicio <= periodoInterno.inicio &&
    periodoInterno.fim <= periodoExterno.fim
  );
}

export function periodosSobrepoem(
  primeiro: PeriodoOperacional,
  segundo: PeriodoOperacional,
): boolean {
  return (
    periodoOperacionalValido(primeiro) &&
    periodoOperacionalValido(segundo) &&
    primeiro.inicio <= segundo.fim &&
    segundo.inicio <= primeiro.fim
  );
}

/**
 * Deriva um intervalo menor somente quando a origem cobre todo o destino e já
 * terminou de carregar. `undefined` nunca é convertido em uma lista vazia.
 */
export function derivarPeriodoCompleto<T extends LinhaComData>(
  dados: readonly T[] | undefined,
  periodoOrigem: PeriodoOperacional,
  periodoDestino: PeriodoOperacional,
): T[] | undefined {
  if (dados === undefined || !periodoContemPeriodo(periodoOrigem, periodoDestino)) {
    return undefined;
  }
  return dados.filter((item) => periodoContemData(periodoDestino, item.data));
}

function dataDoRegistro(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("data" in value)) return null;
  const data = (value as { data?: unknown }).data;
  return dataOperacionalValida(data) ? data : null;
}

/**
 * UPDATE considera as duas datas porque o registro pode sair de um período e
 * entrar em outro. Payloads incompletos usam o fallback conservador.
 */
export function datasDoEventoRealtime(payload: RealtimePayloadMinimo): DatasEventoOperacional {
  const eventType = payload.eventType?.toUpperCase();
  const dataAnterior = dataDoRegistro(payload.old);
  const dataNova = dataDoRegistro(payload.new);

  if (eventType === "INSERT" && dataNova) {
    return { conservador: false, datas: [dataNova] };
  }
  if (eventType === "DELETE" && dataAnterior) {
    return { conservador: false, datas: [dataAnterior] };
  }
  if (eventType === "UPDATE" && dataAnterior && dataNova) {
    return {
      conservador: false,
      datas: Array.from(new Set([dataAnterior, dataNova])),
    };
  }
  return { conservador: true, datas: [] };
}

export function identificarQueriesOperacionaisAfetadas(
  evento: DatasEventoOperacional,
  semana: PeriodoOperacional,
  competencia: PeriodoOperacional,
): QueriesOperacionaisAfetadas {
  if (evento.conservador) return { semana: true, competencia: true };
  return {
    semana: evento.datas.some((data) => periodoContemData(semana, data)),
    competencia: evento.datas.some((data) => periodoContemData(competencia, data)),
  };
}

export function devePreservarEdicaoLocal(estado: EstadoEdicaoOperacional | undefined): boolean {
  return estado === "dirty" || estado === "saving" || estado === "error";
}

export function resultadoPertenceAVersaoAtual(
  versaoAtual: number | undefined,
  versaoDaOperacao: number,
): boolean {
  return versaoAtual === versaoDaOperacao;
}

export const dadosOperacionaisKeys = {
  alocacoesSemana: (userId: string, obraId: string, periodo: PeriodoOperacional): QueryKey =>
    ["aloc-week", obraId, userId, periodo.inicio, periodo.fim] as const,
  registrosSemana: (userId: string, obraId: string, periodo: PeriodoOperacional): QueryKey =>
    ["registros-week", obraId, userId, periodo.inicio, periodo.fim] as const,
  alocacoesCompetencia: (userId: string, obraId: string, periodo: PeriodoOperacional): QueryKey =>
    ["aloc-cycle", obraId, userId, periodo.inicio, periodo.fim] as const,
  registrosCompetencia: (userId: string, obraId: string, periodo: PeriodoOperacional): QueryKey =>
    ["registros-cycle", obraId, userId, periodo.inicio, periodo.fim] as const,
};
