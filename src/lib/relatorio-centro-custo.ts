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
import {
  apurarCustosRegime,
  regimeNaData,
  type AlocacaoReferencia,
  type RegimeVigencia,
} from "./regimes.ts";
import {
  SUPERVISOR_CC_DATA_CORTE,
  SUPERVISOR_CC_VIGENCIAS_ATIVAS,
  categoriaEhSupervisor,
  ratearSupervisorPorVigencias,
  type VigenciaCentroCusto,
} from "./supervisor-cc.ts";

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
  data_admissao?: string | null;
  data_desligamento?: string | null;
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
  regime: "Local" | "Alojado" | "Local / Alojado" | "Não informado";
  custoRegimeLocal: number;
  custoRegimeAlojado: number;
  custoRegime: number;
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
  custoRegimeLocal: number;
  custoRegimeAlojado: number;
  linhas: LinhaComposicaoCentro[];
};

type AcumuladorLinha = Omit<LinhaComposicaoCentro, "dias" | "regime" | "custoRegime" | "total"> & {
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
  periodoInicial?: string;
  periodoFinal?: string;
  vigenciasRegime?: readonly RegimeVigencia[];
  alocacoesReferenciaRegime?: readonly AlocacaoReferencia[];
  alocacoesReferenciaClassificacao?: readonly AlocacaoRelatorio[];
  vigenciasCentroCusto?: readonly VigenciaCentroCusto[];
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

  function ultimaClassificacaoModValida(funcionario: FuncionarioRelatorio, data: string) {
    let ultima: { data: string; tipoMod: Exclude<TipoModRelatorio, "A classificar"> } | undefined;
    let primeiraNoPeriodo:
      { data: string; tipoMod: Exclude<TipoModRelatorio, "A classificar"> } | undefined;
    for (const alocacao of input.alocacoesReferenciaClassificacao ?? input.alocacoes) {
      if (alocacao.funcionario_id !== funcionario.id) continue;
      if (input.resolverTipo(alocacao, funcionario) !== "MOD") continue;
      const tipoMod = classificarTipoMod(funcionario.categoria_mo, alocacao.especialidade_ajudante);
      if (tipoMod === "A classificar") continue;
      if (alocacao.data <= data && (!ultima || alocacao.data > ultima.data))
        ultima = { data: alocacao.data, tipoMod };
      if (
        input.periodoInicial &&
        input.periodoFinal &&
        alocacao.data >= input.periodoInicial &&
        alocacao.data <= input.periodoFinal &&
        (!primeiraNoPeriodo || alocacao.data < primeiraNoPeriodo.data)
      )
        primeiraNoPeriodo = { data: alocacao.data, tipoMod };
    }
    return ultima?.tipoMod ?? primeiraNoPeriodo?.tipoMod;
  }

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
      custoRegimeLocal: 0,
      custoRegimeAlojado: 0,
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
    if (
      SUPERVISOR_CC_VIGENCIAS_ATIVAS &&
      alocacao.data >= SUPERVISOR_CC_DATA_CORTE &&
      categoriaEhSupervisor(funcionario.categoria_mo)
    )
      continue;
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

  if (
    SUPERVISOR_CC_VIGENCIAS_ATIVAS &&
    input.periodoInicial &&
    input.periodoFinal &&
    input.periodoFinal >= SUPERVISOR_CC_DATA_CORTE
  ) {
    const inicioNovaRegra =
      input.periodoInicial < SUPERVISOR_CC_DATA_CORTE
        ? SUPERVISOR_CC_DATA_CORTE
        : input.periodoInicial;
    for (const funcionario of input.funcionarios.filter((item) =>
      categoriaEhSupervisor(item.categoria_mo),
    )) {
      const custo = input.custos.get(funcionario.id);
      if (!custo || custo.total <= 0) continue;
      const resultado = ratearSupervisorPorVigencias({
        funcionarioId: funcionario.id,
        competenciaInicio: inicioNovaRegra,
        competenciaFim: input.periodoFinal,
        dataAdmissao: funcionario.data_admissao,
        dataDesligamento: funcionario.data_desligamento,
        custoMensal: custo.total,
        regime: null,
        vigencias: input.vigenciasCentroCusto ?? [],
      });
      if (resultado.datasSemVigencia.length > 0)
        avisos.add("Há Supervisores com lacuna de vigência de centro de custo no período ativo.");
      for (const parcela of resultado.parcelas) {
        const linha = obterLinha(parcela.obraId, funcionario, "MOI", null, false);
        linha.custoBase += parcela.custoMensal;
        for (let data = parcela.inicioEfetivo; data <= parcela.fimEfetivo;) {
          linha.datas.add(data);
          const vigente = regimeNaData([...(input.vigenciasRegime ?? [])], funcionario.id, data);
          if (vigente?.regime === "alojado") linha.custoRegimeAlojado += 77;
          else if (!vigente)
            avisos.add("Regime não informado para Supervisor com vigência de centro de custo.");
          else
            avisos.add("Supervisor com regime Local requer revisão; refeição não foi presumida.");
          const proxima = new Date(`${data}T00:00:00Z`);
          proxima.setUTCDate(proxima.getUTCDate() + 1);
          data = proxima.toISOString().slice(0, 10);
        }
      }
    }
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

  if (input.periodoInicial && input.periodoFinal) {
    const diasTrabalhados = input.registros
      .filter(
        (registro) =>
          (registro.tipo_registro == null || registro.tipo_registro === "horas") &&
          !registro.ausencia &&
          Number(registro.horas_normais || 0) + Number(registro.horas_extras || 0) > 0,
      )
      .map((registro) => ({
        funcionarioId: registro.funcionario_id,
        obraId: registro.obra_id,
        data: registro.data,
      }));
    const vigencias = [...(input.vigenciasRegime ?? [])].filter((vigencia) => {
      const funcionario = funcMap.get(vigencia.funcionarioId);
      return !(
        SUPERVISOR_CC_VIGENCIAS_ATIVAS &&
        input.periodoInicial! >= SUPERVISOR_CC_DATA_CORTE &&
        funcionario &&
        categoriaEhSupervisor(funcionario.categoria_mo)
      );
    });
    const apuracao = apurarCustosRegime({
      vigencias,
      alocacoes: [...(input.alocacoesReferenciaRegime ?? [])],
      diasTrabalhados,
      inicio: input.periodoInicial,
      fim: input.periodoFinal,
      funcionarioElegivelNaData: (funcionarioId, data) => {
        const funcionario = funcMap.get(funcionarioId);
        return Boolean(
          funcionario &&
          (!funcionario.data_admissao || funcionario.data_admissao <= data) &&
          (!funcionario.data_desligamento || funcionario.data_desligamento >= data),
        );
      },
    });
    if (apuracao.existeRegimeNaoInformado)
      avisos.add("Regime não informado para funcionário com dia trabalhado no período.");
    if (apuracao.existeAlojadoSemCc) avisos.add("Alojado sem CC de referência.");
    for (const lancamento of apuracao.lancamentos) {
      if (!lancamento.obraId) continue;
      const funcionario = funcMap.get(lancamento.funcionarioId);
      if (!funcionario) continue;
      const alocacao = alocIndex.get(
        chave(lancamento.funcionarioId, lancamento.obraId, lancamento.data),
      );
      const tipo = input.resolverTipo(alocacao, funcionario);
      const tipoModDaData =
        input.segmentarMod !== false && tipo === "MOD"
          ? classificarTipoMod(funcionario.categoria_mo, alocacao?.especialidade_ajudante)
          : null;
      const tipoMod =
        tipoModDaData === "A classificar" && lancamento.regime === "alojado"
          ? (ultimaClassificacaoModValida(funcionario, lancamento.data) ?? tipoModDaData)
          : tipoModDaData;
      const linha = obterLinha(
        lancamento.obraId,
        funcionario,
        tipo,
        tipoMod,
        !alocacao?.tipo_mao_obra,
      );
      if (lancamento.regime === "local") linha.custoRegimeLocal += lancamento.valor;
      else linha.custoRegimeAlojado += lancamento.valor;
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
      regime: (() => {
        const regimes = new Set(
          (input.vigenciasRegime ?? [])
            .filter((vigencia) => vigencia.funcionarioId === linha.funcionarioId)
            .map((vigencia) => vigencia.regime),
        );
        if (regimes.size > 1) return "Local / Alojado";
        const vigente = regimeNaData(
          [...(input.vigenciasRegime ?? [])],
          linha.funcionarioId,
          input.periodoFinal ?? "9999-12-31",
        )?.regime;
        return vigente === "local" ? "Local" : vigente === "alojado" ? "Alojado" : "Não informado";
      })(),
      custoRegimeLocal: linha.custoRegimeLocal,
      custoRegimeAlojado: linha.custoRegimeAlojado,
      custoRegime: linha.custoRegimeLocal + linha.custoRegimeAlojado,
      total:
        linha.custoBase +
        linha.custoHE +
        linha.custoAdicionalNoturno +
        linha.custoRegimeLocal +
        linha.custoRegimeAlojado,
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
      custoRegimeLocal: composicao.reduce((total, linha) => total + linha.custoRegimeLocal, 0),
      custoRegimeAlojado: composicao.reduce((total, linha) => total + linha.custoRegimeAlojado, 0),
      linhas: composicao,
    });
  }

  centros.sort((a, b) => b.total - a.total);
  return { centros, avisos: Array.from(avisos) };
}
