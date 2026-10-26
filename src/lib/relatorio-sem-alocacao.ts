import {
  SUPERVISOR_CC_DATA_CORTE,
  SUPERVISOR_CC_VIGENCIAS_ATIVAS,
  categoriaEhSupervisor,
} from "./supervisor-cc.ts";

export function dataLocalISO(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(
    data.getDate(),
  ).padStart(2, "0")}`;
}

export function datasUteisNoIntervalo(
  inicioISO: string,
  fimISO: string,
  feriados?: ReadonlySet<string>,
) {
  if (inicioISO > fimISO) return [];
  const datas: string[] = [];
  for (
    let data = new Date(inicioISO + "T00:00:00");
    data <= new Date(fimISO + "T00:00:00");
    data = new Date(data.getFullYear(), data.getMonth(), data.getDate() + 1)
  ) {
    const iso = dataLocalISO(data);
    if (data.getDay() !== 0 && data.getDay() !== 6 && !feriados?.has(iso)) datas.push(iso);
  }
  return datas;
}

export function diaUtilAnterior(dataISO: string, feriados?: ReadonlySet<string>) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  let data = new Date(ano, mes - 1, dia - 1);
  while (data.getDay() === 0 || data.getDay() === 6 || feriados?.has(dataLocalISO(data)))
    data = new Date(data.getFullYear(), data.getMonth(), data.getDate() - 1);
  return dataLocalISO(data);
}

export type VisaoPendencias = "para-tratar" | "todas";

export type FuncionarioBaseSemAlocacao = {
  id: string;
  categoria_mo: string;
  data_admissao: string | null;
  data_desligamento: string | null;
};

export type CoberturaSemAlocacao = {
  funcionario_id: string;
  data: string;
};

export type VigenciaCentroCustoSemAlocacao = {
  funcionario_id: string;
  vigencia_inicio: string;
  vigencia_fim: string | null;
};

export type PendenciaSemAlocacao<T extends FuncionarioBaseSemAlocacao> = T & {
  diasDisponiveis: number;
  diasComAlocacao: number;
  diasSemAlocacao: number;
  datasSemAlocacao: string[];
  admitidoNoPeriodo: boolean;
  desligadoNoPeriodo: boolean;
};

function subtrairDias(dataISO: string, dias: number) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return dataLocalISO(new Date(ano, mes - 1, dia - dias));
}

export function dataLimitePendencias(
  hojeISO: string,
  fimCompetenciaISO: string,
  visao: VisaoPendencias,
) {
  const limiteTolerancia = subtrairDias(hojeISO, visao === "para-tratar" ? 2 : 1);
  return fimCompetenciaISO < limiteTolerancia ? fimCompetenciaISO : limiteTolerancia;
}

export function filtrarDatasPendentes(
  datas: readonly string[],
  hojeISO: string,
  visao: VisaoPendencias,
) {
  const limite = dataLimitePendencias(hojeISO, "9999-12-31", visao);
  return datas.filter((data) => data <= limite);
}

export function calcularPendenciasSemAlocacao<T extends FuncionarioBaseSemAlocacao>(input: {
  funcionarios: readonly T[];
  coberturas: readonly CoberturaSemAlocacao[];
  feriados: ReadonlySet<string>;
  inicioCompetencia: string;
  fimCompetencia: string;
  dataLimiteAnalise: string;
  vigenciasCentroCusto?: readonly VigenciaCentroCustoSemAlocacao[];
}): PendenciaSemAlocacao<T>[] {
  const coberturasPorFuncionario = new Map<string, Set<string>>();
  for (const cobertura of input.coberturas) {
    const datas = coberturasPorFuncionario.get(cobertura.funcionario_id) ?? new Set<string>();
    datas.add(cobertura.data);
    coberturasPorFuncionario.set(cobertura.funcionario_id, datas);
  }

  return input.funcionarios
    .filter(
      (funcionario) =>
        !funcionario.data_admissao || funcionario.data_admissao <= input.dataLimiteAnalise,
    )
    .map((funcionario) => {
      const inicio =
        funcionario.data_admissao && funcionario.data_admissao > input.inicioCompetencia
          ? funcionario.data_admissao
          : input.inicioCompetencia;
      const fimAnteriorAoDesligamento = funcionario.data_desligamento
        ? diaUtilAnterior(funcionario.data_desligamento, input.feriados)
        : input.dataLimiteAnalise;
      const fim =
        fimAnteriorAoDesligamento < input.dataLimiteAnalise
          ? fimAnteriorAoDesligamento
          : input.dataLimiteAnalise;
      const diasDisponiveis = datasUteisNoIntervalo(inicio, fim, input.feriados);
      const datasCobertas = coberturasPorFuncionario.get(funcionario.id) ?? new Set<string>();
      const vigenciasSupervisor =
        SUPERVISOR_CC_VIGENCIAS_ATIVAS && categoriaEhSupervisor(funcionario.categoria_mo)
          ? (input.vigenciasCentroCusto ?? []).filter(
              (vigencia) => vigencia.funcionario_id === funcionario.id,
            )
          : [];
      const coberto = (data: string) =>
        datasCobertas.has(data) ||
        (SUPERVISOR_CC_VIGENCIAS_ATIVAS &&
          data >= SUPERVISOR_CC_DATA_CORTE &&
          vigenciasSupervisor.some(
            (vigencia) =>
              vigencia.vigencia_inicio <= data &&
              (!vigencia.vigencia_fim || vigencia.vigencia_fim >= data),
          ));
      const diasComAlocacao = diasDisponiveis.filter(coberto);
      const diasSemAlocacao = diasDisponiveis.filter((data) => !coberto(data));

      return {
        ...funcionario,
        diasDisponiveis: diasDisponiveis.length,
        diasComAlocacao: diasComAlocacao.length,
        diasSemAlocacao: diasSemAlocacao.length,
        datasSemAlocacao: diasSemAlocacao,
        admitidoNoPeriodo: Boolean(
          funcionario.data_admissao &&
          funcionario.data_admissao >= input.inicioCompetencia &&
          funcionario.data_admissao <= input.fimCompetencia,
        ),
        desligadoNoPeriodo: Boolean(
          funcionario.data_desligamento &&
          funcionario.data_desligamento >= input.inicioCompetencia &&
          funcionario.data_desligamento <= input.fimCompetencia,
        ),
      };
    });
}

export type AlocacaoHistorica = {
  funcionario_id: string;
  obra_id: string;
  data: string;
};

export function ultimasAlocacoesPorFuncionario(
  alocacoes: readonly AlocacaoHistorica[],
  dataReferencia: string,
) {
  const ultimas = new Map<string, AlocacaoHistorica>();
  for (const alocacao of alocacoes) {
    if (alocacao.data > dataReferencia) continue;
    const atual = ultimas.get(alocacao.funcionario_id);
    if (!atual || alocacao.data > atual.data) ultimas.set(alocacao.funcionario_id, alocacao);
  }
  return ultimas;
}
