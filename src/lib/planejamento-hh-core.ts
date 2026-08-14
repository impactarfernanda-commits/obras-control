import { custoDoDia, horasPadraoDoDia } from "./custos-core.ts";

export type TipoMO = "MOI" | "MOD";
export type TipoAusencia =
  | "ferias"
  | "folga_campo"
  | "atestado"
  | "falta_justificada"
  | "falta_nao_justificada"
  | "suspensao"
  | "afastamento"
  | "outro";

export type RegistroGerencial = {
  data: string;
  tipo_registro: "horas" | "falta" | "ferias" | "folga_campo";
  falta_tipo?: string | null;
  horas_normais?: number | null;
  horas_extras?: number | null;
};

export type ResultadoRegistroGerencial = {
  hhRealizado: number;
  horasAusencia: number;
  tipoAusencia: TipoAusencia | null;
  remunerada: boolean;
};

export type CustoVigencia = {
  funcionarioId: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  categoriaMo: string;
  custoMensalTotal: number;
  statusHistorico: "estimado_inicial" | "apurado_por_vigencia";
};

export function vigenciaNaData(vigencias: CustoVigencia[], funcionarioId: string, data: string) {
  return vigencias.find(
    (v) =>
      v.funcionarioId === funcionarioId &&
      v.vigenciaInicio <= data &&
      (v.vigenciaFim == null || v.vigenciaFim >= data),
  );
}

export function custoRegistroNaVigencia(input: {
  vigencia: CustoVigencia;
  diasUteis: number;
  registro: RegistroGerencial;
}) {
  return input.registro.tipo_registro === "horas"
    ? custoDoDia({
        custoMensal: input.vigencia.custoMensalTotal,
        diasUteis: input.diasUteis,
        dataISO: input.registro.data,
        horasNormais: input.registro.horas_normais,
        horasExtras: input.registro.horas_extras,
      })
    : custoAusenciaDoDia({
        custoMensal: input.vigencia.custoMensalTotal,
        diasUteis: input.diasUteis,
        registro: input.registro,
      });
}

const FALTAS: Record<string, { tipo: TipoAusencia; remunerada: boolean }> = {
  nao_justificada: { tipo: "falta_nao_justificada", remunerada: false },
  justificada: { tipo: "falta_justificada", remunerada: true },
  atestado: { tipo: "atestado", remunerada: true },
  suspensao: { tipo: "suspensao", remunerada: false },
  afastamento: { tipo: "afastamento", remunerada: true },
  outro: { tipo: "outro", remunerada: false },
};

export function classificarRegistroGerencial(
  registro: RegistroGerencial,
): ResultadoRegistroGerencial {
  if (registro.tipo_registro === "horas") {
    return {
      hhRealizado: Number(registro.horas_normais || 0) + Number(registro.horas_extras || 0),
      horasAusencia: 0,
      tipoAusencia: null,
      remunerada: false,
    };
  }
  const horasAusencia = horasPadraoDoDia(registro.data);
  if (registro.tipo_registro === "ferias") {
    return { hhRealizado: 0, horasAusencia, tipoAusencia: "ferias", remunerada: true };
  }
  if (registro.tipo_registro === "folga_campo") {
    return { hhRealizado: 0, horasAusencia, tipoAusencia: "folga_campo", remunerada: true };
  }
  const falta = FALTAS[registro.falta_tipo ?? "outro"] ?? FALTAS.outro;
  return { hhRealizado: 0, horasAusencia, tipoAusencia: falta.tipo, remunerada: falta.remunerada };
}

export function indicadores(previsto: number, realizado: number) {
  return {
    saldo: previsto - realizado,
    percentual:
      previsto > 0
        ? Math.round((realizado / previsto) * 1000000) / 10000
        : realizado > 0
          ? null
          : 0,
  };
}

export function custoAusenciaDoDia(input: {
  custoMensal: number;
  diasUteis: number;
  registro: RegistroGerencial;
}) {
  const classificacao = classificarRegistroGerencial(input.registro);
  if (!classificacao.remunerada || classificacao.horasAusencia <= 0 || input.diasUteis <= 0)
    return 0;
  return input.custoMensal / input.diasUteis;
}

export function normalizarFuncaoOrcamento(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}
