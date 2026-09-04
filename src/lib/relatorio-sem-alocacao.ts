export function dataLocalISO(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(
    data.getDate(),
  ).padStart(2, "0")}`;
}

export function datasUteisNoIntervalo(inicioISO: string, fimISO: string) {
  if (inicioISO > fimISO) return [];
  const datas: string[] = [];
  for (
    let data = new Date(inicioISO + "T00:00:00");
    data <= new Date(fimISO + "T00:00:00");
    data = new Date(data.getFullYear(), data.getMonth(), data.getDate() + 1)
  ) {
    if (data.getDay() !== 0 && data.getDay() !== 6) datas.push(dataLocalISO(data));
  }
  return datas;
}

export function diaUtilAnterior(dataISO: string) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  let data = new Date(ano, mes - 1, dia - 1);
  while (data.getDay() === 0 || data.getDay() === 6)
    data = new Date(data.getFullYear(), data.getMonth(), data.getDate() - 1);
  return dataLocalISO(data);
}

export type VisaoPendencias = "para-tratar" | "todas";

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
