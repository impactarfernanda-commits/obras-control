export const SUPERVISOR_CC_DATA_CORTE = "2026-08-25";

// Suspensao temporaria definida pela direcao. Manter a infraestrutura de vigencias
// pronta para reativacao alterando somente este sinal.
export const SUPERVISOR_CC_VIGENCIAS_ATIVAS = false;

export function normalizarCategoriaFuncionario(valor: string | null | undefined) {
  return (valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function categoriaEhSupervisor(valor: string | null | undefined) {
  return /^SUPERVISOR(?:\s|[-/]|$)/.test(normalizarCategoriaFuncionario(valor));
}

export function supervisorPodeRegistrarTipoNoPeriodo(input: {
  categoria: string | null | undefined;
  tipoRegistro: "horas" | "falta" | "ferias" | "folga_campo";
  dataFim: string;
}) {
  if (
    !SUPERVISOR_CC_VIGENCIAS_ATIVAS ||
    !categoriaEhSupervisor(input.categoria) ||
    input.dataFim < SUPERVISOR_CC_DATA_CORTE
  )
    return true;
  return input.tipoRegistro === "ferias" || input.tipoRegistro === "folga_campo";
}

export type VigenciaCentroCusto = {
  id?: string;
  funcionarioId: string;
  obraId: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  origem?: string;
  observacao?: string | null;
};

export type ParcelaSupervisorCentroCusto = {
  funcionarioId: string;
  obraId: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  inicioEfetivo: string;
  fimEfetivo: string;
  dias: number;
  peso: number;
  custoMensal: number;
  custoRefeicaoAlojado: number;
};

function adicionarDias(dataISO: string, quantidade: number) {
  const data = new Date(`${dataISO}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + quantidade);
  return data.toISOString().slice(0, 10);
}

export function diasCorridosInclusivos(inicio: string, fim: string) {
  if (inicio > fim) return 0;
  return (
    Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000) +
    1
  );
}

export function periodoAtivoNaCompetencia(input: {
  competenciaInicio: string;
  competenciaFim: string;
  dataAdmissao?: string | null;
  dataDesligamento?: string | null;
}) {
  const inicio = [input.competenciaInicio, input.dataAdmissao].filter(Boolean).sort().at(-1)!;
  const fim = [input.competenciaFim, input.dataDesligamento].filter(Boolean).sort().at(0)!;
  return inicio <= fim ? { inicio, fim, dias: diasCorridosInclusivos(inicio, fim) } : null;
}

export function datasSemCoberturaVigencia(
  inicio: string,
  fim: string,
  vigencias: readonly VigenciaCentroCusto[],
) {
  const faltantes: string[] = [];
  for (let data = inicio; data <= fim; data = adicionarDias(data, 1)) {
    if (
      !vigencias.some((v) => v.vigenciaInicio <= data && (!v.vigenciaFim || v.vigenciaFim >= data))
    )
      faltantes.push(data);
  }
  return faltantes;
}

function distribuirCentavos(
  total: number,
  parcelas: Array<{ dias: number; ordem: string }>,
  denominador: number,
) {
  const totalCentavos = Math.round(total * 100);
  const calculadas = parcelas.map((parcela, indice) => {
    const exato = (totalCentavos * parcela.dias) / denominador;
    const base = Math.floor(exato);
    return { indice, base, resto: exato - base, ordem: parcela.ordem };
  });
  const alvo = Math.round(
    parcelas.reduce((soma, parcela) => soma + (totalCentavos * parcela.dias) / denominador, 0),
  );
  let restantes = alvo - calculadas.reduce((soma, parcela) => soma + parcela.base, 0);
  for (const parcela of [...calculadas].sort(
    (a, b) => b.resto - a.resto || a.ordem.localeCompare(b.ordem),
  )) {
    if (restantes <= 0) break;
    parcela.base += 1;
    restantes -= 1;
  }
  return calculadas.sort((a, b) => a.indice - b.indice).map((parcela) => parcela.base / 100);
}

export function ratearSupervisorPorVigencias(input: {
  funcionarioId: string;
  competenciaInicio: string;
  competenciaFim: string;
  dataAdmissao?: string | null;
  dataDesligamento?: string | null;
  custoMensal: number;
  regime: "local" | "alojado" | null;
  vigencias: readonly VigenciaCentroCusto[];
}) {
  const ativo = periodoAtivoNaCompetencia(input);
  if (!ativo)
    return {
      parcelas: [] as ParcelaSupervisorCentroCusto[],
      diasAtivos: 0,
      datasSemVigencia: [] as string[],
    };
  const vigencias = input.vigencias
    .filter((v) => v.funcionarioId === input.funcionarioId)
    .map((vigencia) => {
      const inicioEfetivo = [ativo.inicio, vigencia.vigenciaInicio].sort().at(-1)!;
      const fimEfetivo = [ativo.fim, vigencia.vigenciaFim].filter(Boolean).sort().at(0)!;
      return {
        vigencia,
        inicioEfetivo,
        fimEfetivo,
        dias: diasCorridosInclusivos(inicioEfetivo, fimEfetivo),
      };
    })
    .filter((item) => item.dias > 0)
    .sort(
      (a, b) =>
        a.inicioEfetivo.localeCompare(b.inicioEfetivo) ||
        a.vigencia.obraId.localeCompare(b.vigencia.obraId),
    );
  const custos = distribuirCentavos(
    input.custoMensal,
    vigencias.map((item) => ({
      dias: item.dias,
      ordem: `${item.inicioEfetivo}|${item.vigencia.obraId}`,
    })),
    ativo.dias,
  );
  const parcelas = vigencias.map((item, indice): ParcelaSupervisorCentroCusto => ({
    funcionarioId: input.funcionarioId,
    obraId: item.vigencia.obraId,
    vigenciaInicio: item.vigencia.vigenciaInicio,
    vigenciaFim: item.vigencia.vigenciaFim,
    inicioEfetivo: item.inicioEfetivo,
    fimEfetivo: item.fimEfetivo,
    dias: item.dias,
    peso: item.dias / ativo.dias,
    custoMensal: custos[indice],
    custoRefeicaoAlojado: input.regime === "alojado" ? item.dias * 77 : 0,
  }));
  return {
    parcelas,
    diasAtivos: ativo.dias,
    datasSemVigencia: datasSemCoberturaVigencia(ativo.inicio, ativo.fim, input.vigencias),
  };
}
