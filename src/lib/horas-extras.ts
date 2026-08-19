export type CustoMensalVariavel = {
  salario: number;
  encargos: number;
  prov13: number;
  provAvisoPrevio: number;
  provFerias: number;
};

export type RegistroHoraExtra = {
  data: string;
  horasExtras: number | null | undefined;
};

export type ClassificacaoHoras = {
  horasNormaisApuradas: number;
  horasExtra50Apuradas: number;
  horasExtra100Apuradas: number;
};

export type CustoHoraExtra = {
  horas50: number;
  horas100: number;
  remuneracao50: number;
  remuneracao100: number;
  remuneracao: number;
  encargos: number;
  provisao13: number;
  provisaoAviso: number;
  provisaoFerias: number;
  custoTotal: number;
};

export type CustoJornadaDetalhada = CustoHoraExtra & {
  horasNoturnasRemuneraveis: number;
  adicionalNoturno: number;
};

export const CUSTO_HORA_EXTRA_ZERO: CustoHoraExtra = {
  horas50: 0,
  horas100: 0,
  remuneracao50: 0,
  remuneracao100: 0,
  remuneracao: 0,
  encargos: 0,
  provisao13: 0,
  provisaoAviso: 0,
  provisaoFerias: 0,
  custoTotal: 0,
};

function diaDaSemana(dataISO: string) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return new Date(ano, (mes ?? 1) - 1, dia ?? 1).getDay();
}

export function classificarHorasPorData(input: {
  data: string;
  horasNormais: number | null | undefined;
  horasExtras: number | null | undefined;
  feriado?: boolean;
}): ClassificacaoHoras {
  const horasNormais = Math.max(0, Number(input.horasNormais || 0));
  const horasExtras = Math.max(0, Number(input.horasExtras || 0));
  const total = horasNormais + horasExtras;
  const diaSemana = diaDaSemana(input.data);

  if (input.feriado || diaSemana === 0) {
    return {
      horasNormaisApuradas: 0,
      horasExtra50Apuradas: 0,
      horasExtra100Apuradas: total,
    };
  }
  if (diaSemana === 6) {
    return {
      horasNormaisApuradas: 0,
      horasExtra50Apuradas: total,
      horasExtra100Apuradas: 0,
    };
  }
  return {
    horasNormaisApuradas: horasNormais,
    horasExtra50Apuradas: horasExtras,
    horasExtra100Apuradas: 0,
  };
}

/**
 * Domingos e feriados informados por uma fonte confiável são HE 100%.
 * Enquanto não houver fonte de feriados configurada, passe um conjunto vazio.
 */
export function isHoraExtra100(dataISO: string, feriados: ReadonlySet<string> = new Set()) {
  return diaDaSemana(dataISO) === 0 || feriados.has(dataISO);
}

export function calcularCustoHorasExtras(
  custoBase: CustoMensalVariavel,
  registros: readonly RegistroHoraExtra[],
  feriados: ReadonlySet<string> = new Set(),
): CustoHoraExtra {
  const salario = Number(custoBase.salario || 0);
  if (salario <= 0) return { ...CUSTO_HORA_EXTRA_ZERO };

  let horas50 = 0;
  let horas100 = 0;
  for (const registro of registros) {
    const horas = Math.max(0, Number(registro.horasExtras || 0));
    if (isHoraExtra100(registro.data, feriados)) horas100 += horas;
    else horas50 += horas;
  }

  const valorHora = salario / 220;
  const remuneracao50 = horas50 * valorHora * 1.5;
  const remuneracao100 = horas100 * valorHora * 2;
  const remuneracao = remuneracao50 + remuneracao100;
  const encargos = remuneracao * (Number(custoBase.encargos || 0) / salario);
  const provisao13 = remuneracao * (Number(custoBase.prov13 || 0) / salario);
  const provisaoAviso = remuneracao * (Number(custoBase.provAvisoPrevio || 0) / salario);
  const provisaoFerias = remuneracao * (Number(custoBase.provFerias || 0) / salario);
  const custoTotal = remuneracao + encargos + provisao13 + provisaoAviso + provisaoFerias;

  return {
    horas50,
    horas100,
    remuneracao50,
    remuneracao100,
    remuneracao,
    encargos,
    provisao13,
    provisaoAviso,
    provisaoFerias,
    custoTotal,
  };
}

/**
 * A HE noturna combina hora reduzida, adicional de 20% e multiplicador de HE.
 * `adicionalNoturno` expõe a diferença noturna já contida nas parcelas combinadas,
 * para apresentação sem somá-la novamente ao total.
 */
export function calcularCustoJornadaDetalhada(
  custoBase: CustoMensalVariavel,
  input: {
    horas50: number;
    horas100: number;
    horasNoturnasNormaisRemuneraveis: number;
    horasNoturnas50Remuneraveis: number;
    horasNoturnas100Remuneraveis: number;
    horasNoturnasSemHeRemuneraveis: number;
  },
): CustoJornadaDetalhada {
  const salario = Number(custoBase.salario || 0);
  const horas50 = Math.max(0, Number(input.horas50 || 0));
  const horas100 = Math.max(0, Number(input.horas100 || 0));
  const noturnasNormais = Math.max(0, Number(input.horasNoturnasNormaisRemuneraveis || 0));
  const noturnas50 = Math.max(0, Number(input.horasNoturnas50Remuneraveis || 0));
  const noturnas100 = Math.max(0, Number(input.horasNoturnas100Remuneraveis || 0));
  const noturnasSemHe = Math.max(0, Number(input.horasNoturnasSemHeRemuneraveis || 0));
  const horasNoturnasRemuneraveis = noturnasNormais + noturnas50 + noturnas100 + noturnasSemHe;
  if (salario <= 0)
    return { ...CUSTO_HORA_EXTRA_ZERO, horasNoturnasRemuneraveis, adicionalNoturno: 0 };
  const valorHora = salario / 220;
  const horasNoturnas50Reais = noturnas50 * (52.5 / 60);
  const horasNoturnas100Reais = noturnas100 * (52.5 / 60);
  const remuneracao50 =
    Math.max(0, horas50 - horasNoturnas50Reais) * valorHora * 1.5 + noturnas50 * valorHora * 1.5;
  const remuneracao100 =
    Math.max(0, horas100 - horasNoturnas100Reais) * valorHora * 2 + noturnas100 * valorHora * 2;
  const adicionalNoturnoNormal = (noturnasNormais + noturnasSemHe) * valorHora * 0.2;
  const adicionalNoturno =
    adicionalNoturnoNormal + noturnas50 * valorHora * 1.5 * 0.2 + noturnas100 * valorHora * 2 * 0.2;
  const remuneracao = remuneracao50 + remuneracao100 + adicionalNoturno;
  const proporcao = (valor: number) => remuneracao * (Number(valor || 0) / salario);
  const encargos = proporcao(custoBase.encargos);
  const provisao13 = proporcao(custoBase.prov13);
  const provisaoAviso = proporcao(custoBase.provAvisoPrevio);
  const provisaoFerias = proporcao(custoBase.provFerias);
  return {
    horas50,
    horas100,
    horasNoturnasRemuneraveis,
    remuneracao50,
    remuneracao100,
    adicionalNoturno,
    remuneracao,
    encargos,
    provisao13,
    provisaoAviso,
    provisaoFerias,
    custoTotal: remuneracao + encargos + provisao13 + provisaoAviso + provisaoFerias,
  };
}

export function formatarHorasDecimais(horas: number) {
  const minutos = Math.round(Math.max(0, Number(horas || 0)) * 60);
  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}

export function podeVisualizarDetalhamentoFinanceiro(isManagerOrAbove: boolean) {
  return isManagerOrAbove;
}
