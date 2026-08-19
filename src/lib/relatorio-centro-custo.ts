import type { CustoBreakdown } from "./custos-core";
import {
  calcularCustoHorasExtras,
  calcularCustoJornadaDetalhada,
  classificarHorasPorData,
} from "./horas-extras.ts";
import type { DetalheJornadaVisual } from "./horas-visualizacao.ts";
import {
  categoriaEhAjudante,
  classificarTipoMod,
  type EspecialidadeAjudante,
  type TipoModRelatorio,
} from "./especialidade-ajudante.ts";

export type TipoRelatorio = "MOD" | "MOI";

export type AlocacaoRelatorio = {
  funcionario_id: string;
  obra_id: string;
  data: string;
  tipo_mao_obra: "montagem" | "civil" | "indireta" | null;
  especialidade_ajudante?: EspecialidadeAjudante | null;
};

export type RegistroRelatorio = {
  id?: string;
  funcionario_id: string;
  obra_id: string;
  data: string;
  horas_normais: number;
  horas_extras: number;
  ausencia: boolean;
  tipo_registro?: "horas" | "falta" | "ferias" | "folga_campo";
  falta_tipo?: string | null;
  detalhe?: DetalheJornadaVisual | null;
};

export type FuncionarioRelatorio = {
  id: string;
  nome: string;
  categoria_mo: string;
};

export type LinhaComposicaoCentro = {
  funcionarioId: string;
  funcionarioNome: string;
  funcao: string;
  tipo: TipoRelatorio;
  tipoMod?: TipoModRelatorio | null;
  tipoInferido: boolean;
  dias: number;
  horasNormais: number;
  horas50: number;
  horas100: number;
  horasSemAdicionalHe: number;
  horasNoturnasRemuneraveis: number;
  custoBase: number;
  custoHE: number;
  custoAdicionalNoturno: number;
  total: number;
};

export type CentroConsolidado = {
  id: string;
  nome: string;
  mod: number;
  modCivil: number;
  modMontagem: number;
  modAClassificar: number;
  moi: number;
  total: number;
  funcs: number;
  dias: number;
  custoHE: number;
  custoAdicionalNoturno: number;
  linhas: LinhaComposicaoCentro[];
};

type AcumuladorLinha = Omit<LinhaComposicaoCentro, "dias" | "total"> & {
  datas: Set<string>;
};

type Input = {
  alocacoes: readonly AlocacaoRelatorio[];
  registros: readonly RegistroRelatorio[];
  funcionarios: readonly FuncionarioRelatorio[];
  custos: ReadonlyMap<string, CustoBreakdown>;
  obras: ReadonlyMap<string, string>;
  diasUteis: number;
  resolverTipo: (
    alocacao: AlocacaoRelatorio | undefined,
    funcionario: FuncionarioRelatorio,
  ) => TipoRelatorio;
  calcularCustoBase: (input: {
    custoMensal: number;
    diasUteis: number;
    dataISO: string;
    horasNormais: number | null;
    ausencia: boolean | null;
  }) => number;
  horasNormaisPadrao: (dataISO: string) => number;
  segmentarMod?: boolean;
  feriados?: ReadonlySet<string>;
};

function chave(funcionarioId: string, obraId: string, data: string) {
  return `${funcionarioId}|${obraId}|${data}`;
}

function chaveLinha(
  obraId: string,
  funcionarioId: string,
  tipo: TipoRelatorio,
  tipoMod: TipoModRelatorio | null,
) {
  return `${obraId}|${funcionarioId}|${tipo}|${tipoMod ?? ""}`;
}

export function consolidarCustosCentros(input: Input) {
  const funcMap = new Map(input.funcionarios.map((funcionario) => [funcionario.id, funcionario]));
  const regIndex = new Map(
    input.registros.map((registro) => [
      chave(registro.funcionario_id, registro.obra_id, registro.data),
      registro,
    ]),
  );
  const alocIndex = new Map(
    input.alocacoes.map((alocacao) => [
      chave(alocacao.funcionario_id, alocacao.obra_id, alocacao.data),
      alocacao,
    ]),
  );
  const linhas = new Map<string, AcumuladorLinha>();
  const avisos = new Set<string>();

  function obterLinha(
    obraId: string,
    funcionario: FuncionarioRelatorio,
    tipo: TipoRelatorio,
    tipoMod: TipoModRelatorio | null,
    tipoInferido: boolean,
  ) {
    const id = chaveLinha(obraId, funcionario.id, tipo, tipoMod);
    const atual = linhas.get(id) ?? {
      funcionarioId: funcionario.id,
      funcionarioNome: funcionario.nome,
      funcao: funcionario.categoria_mo,
      tipo,
      tipoMod,
      tipoInferido: false,
      datas: new Set<string>(),
      horasNormais: 0,
      horas50: 0,
      horas100: 0,
      horasSemAdicionalHe: 0,
      horasNoturnasRemuneraveis: 0,
      custoBase: 0,
      custoHE: 0,
      custoAdicionalNoturno: 0,
    };
    atual.tipoInferido ||= tipoInferido;
    linhas.set(id, atual);
    return atual;
  }

  for (const alocacao of input.alocacoes) {
    const funcionario = funcMap.get(alocacao.funcionario_id);
    if (!funcionario) {
      avisos.add("Ha alocacoes sem funcionario correspondente carregado no relatorio.");
      continue;
    }
    const custo = input.custos.get(alocacao.funcionario_id);
    if (!custo || custo.total <= 0) {
      avisos.add("Ha alocacoes com funcionario sem custo mensal calculado.");
      continue;
    }

    const registro = regIndex.get(chave(alocacao.funcionario_id, alocacao.obra_id, alocacao.data));
    const falta = registro
      ? (registro.tipo_registro != null && registro.tipo_registro !== "horas") || registro.ausencia
      : false;
    if (!registro) {
      avisos.add(
        "Ha alocacoes sem registro de horas correspondente; foi usada a jornada padrao do dia.",
      );
    } else if (
      !falta &&
      !registro.ausencia &&
      Number(registro.horas_normais || 0) + Number(registro.horas_extras || 0) <= 0
    ) {
      avisos.add("Ha registros de horas sem horas normais/extras; essas linhas nao geram custo.");
    }
    if (!alocacao.tipo_mao_obra) {
      avisos.add(
        "Ha alocacoes sem tipo de mao de obra; foi usado o tipo padrao da categoria ou MOD como fallback.",
      );
    }

    const horasRegistradas = registro?.horas_normais ?? input.horasNormaisPadrao(alocacao.data);
    const apuracao = registro?.detalhe
      ? {
          horasNormaisApuradas: registro.detalhe.minutos_normais / 60,
          horasExtra50Apuradas: registro.detalhe.minutos_he_50 / 60,
          horasExtra100Apuradas: registro.detalhe.minutos_he_100 / 60,
        }
      : classificarHorasPorData({
          data: alocacao.data,
          horasNormais: falta ? 0 : horasRegistradas,
          horasExtras: falta ? 0 : registro?.horas_extras,
          feriado: input.feriados?.has(alocacao.data),
        });
    const custoBase = input.calcularCustoBase({
      custoMensal: custo.total,
      diasUteis: input.diasUteis,
      dataISO: alocacao.data,
      horasNormais: apuracao.horasNormaisApuradas,
      ausencia: falta || (registro?.ausencia ?? false),
    });
    const totalHorasApuradas =
      apuracao.horasNormaisApuradas +
      apuracao.horasExtra50Apuradas +
      apuracao.horasExtra100Apuradas;
    if (custoBase <= 0 && totalHorasApuradas <= 0) continue;

    const tipo = input.resolverTipo(alocacao, funcionario);
    const tipoMod =
      input.segmentarMod !== false && tipo === "MOD"
        ? classificarTipoMod(funcionario.categoria_mo, alocacao.especialidade_ajudante)
        : null;
    if (tipoMod === "A classificar") {
      if (categoriaEhAjudante(funcionario.categoria_mo))
        avisos.add("Há alocações de ajudantes sem classificação entre Civil e Montagem.");
      else
        avisos.add(
          "Há categorias de mão de obra direta ainda sem classificação entre Civil e Montagem.",
        );
    }
    const linha = obterLinha(alocacao.obra_id, funcionario, tipo, tipoMod, !alocacao.tipo_mao_obra);
    linha.datas.add(alocacao.data);
    linha.horasNormais += apuracao.horasNormaisApuradas;
    linha.custoBase += custoBase;
  }

  for (const registro of input.registros) {
    if (registro.tipo_registro != null && registro.tipo_registro !== "horas") continue;
    const apuracao = registro.detalhe
      ? {
          horasNormaisApuradas: registro.detalhe.minutos_normais / 60,
          horasExtra50Apuradas: registro.detalhe.minutos_he_50 / 60,
          horasExtra100Apuradas: registro.detalhe.minutos_he_100 / 60,
        }
      : classificarHorasPorData({
          data: registro.data,
          horasNormais: registro.horas_normais,
          horasExtras: registro.horas_extras,
          feriado: input.feriados?.has(registro.data),
        });
    const horasExtrasApuradas = apuracao.horasExtra50Apuradas + apuracao.horasExtra100Apuradas;
    const horasNoturnasRemuneraveis =
      Number(registro.detalhe?.minutos_noturnos_remuneraveis ?? 0) / 60;
    if (horasExtrasApuradas <= 0 && horasNoturnasRemuneraveis <= 0) continue;
    const funcionario = funcMap.get(registro.funcionario_id);
    const custo = input.custos.get(registro.funcionario_id);
    if (!funcionario || !custo) continue;

    const alocacao = alocIndex.get(chave(registro.funcionario_id, registro.obra_id, registro.data));
    const tipo = input.resolverTipo(alocacao, funcionario);
    const tipoMod =
      input.segmentarMod !== false && tipo === "MOD"
        ? classificarTipoMod(funcionario.categoria_mo, alocacao?.especialidade_ajudante)
        : null;
    const linha = obterLinha(
      registro.obra_id,
      funcionario,
      tipo,
      tipoMod,
      !alocacao?.tipo_mao_obra,
    );
    linha.horas50 += apuracao.horasExtra50Apuradas;
    linha.horas100 += apuracao.horasExtra100Apuradas;
    linha.horasSemAdicionalHe += Number(registro.detalhe?.minutos_sem_adicional_he ?? 0) / 60;
    linha.horasNoturnasRemuneraveis += horasNoturnasRemuneraveis;
    if (registro.detalhe) {
      const custoDetalhado = calcularCustoJornadaDetalhada(custo, {
        horas50: apuracao.horasExtra50Apuradas,
        horas100: apuracao.horasExtra100Apuradas,
        horasNoturnasNormaisRemuneraveis:
          Number(registro.detalhe.minutos_noturnos_normais_remuneraveis ?? 0) / 60,
        horasNoturnas50Remuneraveis:
          Number(registro.detalhe.minutos_noturnos_he_50_remuneraveis ?? 0) / 60,
        horasNoturnas100Remuneraveis:
          Number(registro.detalhe.minutos_noturnos_he_100_remuneraveis ?? 0) / 60,
        horasNoturnasSemHeRemuneraveis:
          Number(registro.detalhe.minutos_noturnos_sem_adicional_he_remuneraveis ?? 0) / 60,
      });
      const fatorReflexos =
        custoDetalhado.remuneracao > 0 ? custoDetalhado.custoTotal / custoDetalhado.remuneracao : 0;
      linha.custoHE +=
        (custoDetalhado.remuneracao50 + custoDetalhado.remuneracao100) * fatorReflexos;
      linha.custoAdicionalNoturno += custoDetalhado.adicionalNoturno * fatorReflexos;
    } else {
      linha.custoHE += calcularCustoHorasExtras(
        custo,
        [{ data: registro.data, horasExtras: horasExtrasApuradas }],
        input.feriados,
      ).custoTotal;
    }
  }

  const linhasPorCentro = new Map<string, LinhaComposicaoCentro[]>();
  for (const [id, linha] of linhas) {
    const obraId = id.split("|")[0];
    const final: LinhaComposicaoCentro = {
      funcionarioId: linha.funcionarioId,
      funcionarioNome: linha.funcionarioNome,
      funcao: linha.funcao,
      tipo: linha.tipo,
      tipoMod: linha.tipoMod,
      tipoInferido: linha.tipoInferido,
      dias: linha.datas.size,
      horasNormais: linha.horasNormais,
      horas50: linha.horas50,
      horas100: linha.horas100,
      horasSemAdicionalHe: linha.horasSemAdicionalHe,
      horasNoturnasRemuneraveis: linha.horasNoturnasRemuneraveis,
      custoBase: linha.custoBase,
      custoHE: linha.custoHE,
      custoAdicionalNoturno: linha.custoAdicionalNoturno,
      total: linha.custoBase + linha.custoHE + linha.custoAdicionalNoturno,
    };
    const lista = linhasPorCentro.get(obraId) ?? [];
    lista.push(final);
    linhasPorCentro.set(obraId, lista);
  }

  const centros: CentroConsolidado[] = [];
  for (const [obraId, composicao] of linhasPorCentro) {
    composicao.sort(
      (a, b) =>
        a.tipo.localeCompare(b.tipo) || a.funcionarioNome.localeCompare(b.funcionarioNome, "pt-BR"),
    );
    const mod = composicao
      .filter((linha) => linha.tipo === "MOD")
      .reduce((total, linha) => total + linha.total, 0);
    const modCivil = composicao
      .filter((linha) => linha.tipo === "MOD" && linha.tipoMod === "Civil")
      .reduce((total, linha) => total + linha.total, 0);
    const modMontagem = composicao
      .filter((linha) => linha.tipo === "MOD" && linha.tipoMod === "Montagem")
      .reduce((total, linha) => total + linha.total, 0);
    const modAClassificar = composicao
      .filter((linha) => linha.tipo === "MOD" && linha.tipoMod === "A classificar")
      .reduce((total, linha) => total + linha.total, 0);
    const moi = composicao
      .filter((linha) => linha.tipo === "MOI")
      .reduce((total, linha) => total + linha.total, 0);
    centros.push({
      id: obraId,
      nome: input.obras.get(obraId) ?? "-",
      mod,
      modCivil,
      modMontagem,
      modAClassificar,
      moi,
      total: mod + moi,
      funcs: new Set(composicao.map((linha) => linha.funcionarioId)).size,
      dias: composicao.reduce((total, linha) => total + linha.dias, 0),
      custoHE: composicao.reduce((total, linha) => total + linha.custoHE, 0),
      custoAdicionalNoturno: composicao.reduce(
        (total, linha) => total + linha.custoAdicionalNoturno,
        0,
      ),
      linhas: composicao,
    });
  }

  centros.sort((a, b) => b.total - a.total);
  return { centros, avisos: Array.from(avisos) };
}
