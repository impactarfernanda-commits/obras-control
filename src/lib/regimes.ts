export type Regime = "local" | "alojado";
export type RegimeVigencia = {
  funcionarioId: string;
  regime: Regime;
  vigenciaInicio: string;
  vigenciaFim: string | null;
};
export type AlocacaoReferencia = { funcionarioId: string; obraId: string; data: string };
export type DiaTrabalhado = AlocacaoReferencia;
export type LancamentoCustoRegime = {
  funcionarioId: string;
  obraId: string | null;
  data: string;
  regime: Regime;
  valor: number;
};

export const CUSTO_LOCAL_DIA_TRABALHADO = 45;
export const CUSTO_ALOJADO_DIA_CORRIDO = 77;
export const MARCO_INICIAL_REGIMES = "2026-07-25";

export function regimeNaData(vigencias: RegimeVigencia[], funcionarioId: string, data: string) {
  return vigencias.find(
    (item) =>
      item.funcionarioId === funcionarioId &&
      item.vigenciaInicio <= data &&
      (item.vigenciaFim == null || item.vigenciaFim >= data),
  );
}

export function ultimaAlocacaoNaData(
  alocacoes: AlocacaoReferencia[],
  funcionarioId: string,
  data: string,
) {
  let ultima: AlocacaoReferencia | undefined;
  for (const alocacao of alocacoes) {
    if (alocacao.funcionarioId !== funcionarioId || alocacao.data > data) continue;
    if (!ultima || alocacao.data > ultima.data) ultima = alocacao;
  }
  return ultima;
}

export function datasISOEntre(inicio: string, fim: string) {
  const datas: string[] = [];
  const atual = new Date(`${inicio}T00:00:00Z`);
  const limite = new Date(`${fim}T00:00:00Z`);
  while (atual <= limite) {
    datas.push(atual.toISOString().slice(0, 10));
    atual.setUTCDate(atual.getUTCDate() + 1);
  }
  return datas;
}

export function apurarCustosRegime(input: {
  vigencias: RegimeVigencia[];
  alocacoes: AlocacaoReferencia[];
  diasTrabalhados: DiaTrabalhado[];
  inicio: string;
  fim: string;
  funcionarioElegivelNaData?: (funcionarioId: string, data: string) => boolean;
}) {
  const lancamentos: LancamentoCustoRegime[] = [];
  const chavesLocais = new Set<string>();
  let existeRegimeNaoInformado = false;
  let existeAlojadoSemCc = false;

  for (const dia of input.diasTrabalhados) {
    if (dia.data < MARCO_INICIAL_REGIMES || dia.data < input.inicio || dia.data > input.fim)
      continue;
    const regime = regimeNaData(input.vigencias, dia.funcionarioId, dia.data)?.regime;
    if (!regime) {
      existeRegimeNaoInformado = true;
      continue;
    }
    if (regime !== "local") continue;
    const chave = `${dia.funcionarioId}|${dia.obraId}|${dia.data}`;
    if (chavesLocais.has(chave)) continue;
    chavesLocais.add(chave);
    lancamentos.push({ ...dia, regime, valor: CUSTO_LOCAL_DIA_TRABALHADO });
  }

  const funcionarios = new Set(input.vigencias.map((vigencia) => vigencia.funcionarioId));
  for (const funcionarioId of funcionarios) {
    for (const data of datasISOEntre(input.inicio, input.fim)) {
      if (data < MARCO_INICIAL_REGIMES) continue;
      if (input.funcionarioElegivelNaData?.(funcionarioId, data) === false) continue;
      if (regimeNaData(input.vigencias, funcionarioId, data)?.regime !== "alojado") continue;
      const referencia = ultimaAlocacaoNaData(input.alocacoes, funcionarioId, data);
      if (!referencia) existeAlojadoSemCc = true;
      lancamentos.push({
        funcionarioId,
        obraId: referencia?.obraId ?? null,
        data,
        regime: "alojado",
        valor: CUSTO_ALOJADO_DIA_CORRIDO,
      });
    }
  }
  return { lancamentos, existeRegimeNaoInformado, existeAlojadoSemCc };
}

export function vigenciaInicialOuMudanca(regimeAtual: Regime | null, dataMudanca: string) {
  return regimeAtual == null ? MARCO_INICIAL_REGIMES : dataMudanca;
}
