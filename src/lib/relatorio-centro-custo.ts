import type { CustoBreakdown } from "./custos";
import { calcularCustoHorasExtras, isHoraExtra100 } from "./horas-extras.ts";

export type TipoRelatorio = "MOD" | "MOI";

export type AlocacaoRelatorio = {
  funcionario_id: string;
  obra_id: string;
  data: string;
  tipo_mao_obra: "montagem" | "civil" | "indireta" | null;
};

export type RegistroRelatorio = {
  funcionario_id: string;
  obra_id: string;
  data: string;
  horas_normais: number;
  horas_extras: number;
  ausencia: boolean;
  tipo_registro?: "horas" | "falta";
  falta_tipo?: string | null;
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
  tipoInferido: boolean;
  dias: number;
  horasNormais: number;
  horas50: number;
  horas100: number;
  custoBase: number;
  custoHE: number;
  total: number;
};

export type CentroConsolidado = {
  id: string;
  nome: string;
  mod: number;
  moi: number;
  total: number;
  funcs: number;
  dias: number;
  custoHE: number;
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
};

function chave(funcionarioId: string, obraId: string, data: string) {
  return `${funcionarioId}|${obraId}|${data}`;
}

function chaveLinha(obraId: string, funcionarioId: string, tipo: TipoRelatorio) {
  return `${obraId}|${funcionarioId}|${tipo}`;
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
    tipoInferido: boolean,
  ) {
    const id = chaveLinha(obraId, funcionario.id, tipo);
    const atual = linhas.get(id) ?? {
      funcionarioId: funcionario.id,
      funcionarioNome: funcionario.nome,
      funcao: funcionario.categoria_mo,
      tipo,
      tipoInferido: false,
      datas: new Set<string>(),
      horasNormais: 0,
      horas50: 0,
      horas100: 0,
      custoBase: 0,
      custoHE: 0,
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
    const falta = registro?.tipo_registro === "falta";
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

    const custoBase = input.calcularCustoBase({
      custoMensal: custo.total,
      diasUteis: input.diasUteis,
      dataISO: alocacao.data,
      horasNormais: registro?.horas_normais ?? null,
      ausencia: falta || (registro?.ausencia ?? false),
    });
    if (custoBase <= 0) continue;

    const tipo = input.resolverTipo(alocacao, funcionario);
    const linha = obterLinha(alocacao.obra_id, funcionario, tipo, !alocacao.tipo_mao_obra);
    linha.datas.add(alocacao.data);
    linha.horasNormais += falta
      ? 0
      : (registro?.horas_normais ?? (input.horasNormaisPadrao(alocacao.data) || 9));
    linha.custoBase += custoBase;
  }

  for (const registro of input.registros) {
    if (registro.tipo_registro === "falta") continue;
    if (Number(registro.horas_extras || 0) <= 0) continue;
    const funcionario = funcMap.get(registro.funcionario_id);
    const custo = input.custos.get(registro.funcionario_id);
    if (!funcionario || !custo) continue;

    const alocacao = alocIndex.get(chave(registro.funcionario_id, registro.obra_id, registro.data));
    const tipo = input.resolverTipo(alocacao, funcionario);
    const linha = obterLinha(registro.obra_id, funcionario, tipo, !alocacao?.tipo_mao_obra);
    const horas = Number(registro.horas_extras || 0);
    if (isHoraExtra100(registro.data)) linha.horas100 += horas;
    else linha.horas50 += horas;
    linha.custoHE += calcularCustoHorasExtras(custo, [
      { data: registro.data, horasExtras: horas },
    ]).custoTotal;
  }

  const linhasPorCentro = new Map<string, LinhaComposicaoCentro[]>();
  for (const [id, linha] of linhas) {
    const obraId = id.split("|")[0];
    const final: LinhaComposicaoCentro = {
      funcionarioId: linha.funcionarioId,
      funcionarioNome: linha.funcionarioNome,
      funcao: linha.funcao,
      tipo: linha.tipo,
      tipoInferido: linha.tipoInferido,
      dias: linha.datas.size,
      horasNormais: linha.horasNormais,
      horas50: linha.horas50,
      horas100: linha.horas100,
      custoBase: linha.custoBase,
      custoHE: linha.custoHE,
      total: linha.custoBase + linha.custoHE,
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
    const moi = composicao
      .filter((linha) => linha.tipo === "MOI")
      .reduce((total, linha) => total + linha.total, 0);
    centros.push({
      id: obraId,
      nome: input.obras.get(obraId) ?? "-",
      mod,
      moi,
      total: mod + moi,
      funcs: new Set(composicao.map((linha) => linha.funcionarioId)).size,
      dias: composicao.reduce((total, linha) => total + linha.dias, 0),
      custoHE: composicao.reduce((total, linha) => total + linha.custoHE, 0),
      linhas: composicao,
    });
  }

  centros.sort((a, b) => b.total - a.total);
  return { centros, avisos: Array.from(avisos) };
}
