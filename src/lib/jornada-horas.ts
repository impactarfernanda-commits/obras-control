const MINUTOS_DIA = 1440;
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const JORNADA_CALCULO_VERSAO = "jornada-v2";
export const ADICIONAL_NOTURNO_PERCENTUAL = 20;
export const MINUTOS_HORA_NOTURNA_REDUZIDA = 52.5;

export type SegmentoJornada = {
  data: string;
  inicioMinutoDia: number;
  fimMinutoDia: number;
  minutosBrutos: number;
  minutosIntervalo: number;
  minutosLiquidos: number;
  minutosNormais: number;
  minutosHe50: number;
  minutosHe100: number;
  minutosSemAdicionalHe: number;
  minutosNoturnosReais: number;
  minutosNoturnosRemuneraveis: number;
};

export type CalculoJornada = {
  valido: boolean;
  erro?: string;
  dataInicio: string;
  dataSaida: string;
  atravessaMeiaNoite: boolean;
  permanenciaMinutos: number;
  intervaloMinutos: number;
  totalTrabalhadoMinutos: number;
  minutosNormais: number;
  minutosHe50: number;
  minutosHe100: number;
  minutosSemAdicionalHe: number;
  minutosNoturnosReais: number;
  minutosNoturnosRemuneraveis: number;
  minutosNoturnosNormaisRemuneraveis: number;
  minutosNoturnosHe50Remuneraveis: number;
  minutosNoturnosHe100Remuneraveis: number;
  minutosNoturnosSemAdicionalHeRemuneraveis: number;
  horasNormais: number;
  horasExtras: number;
  total: number;
  excepcionalAcima10h: boolean;
  excepcionalAcima12h: boolean;
  exigeJustificativa: boolean;
  segmentos: SegmentoJornada[];
  versaoCalculo: typeof JORNADA_CALCULO_VERSAO;
};

function minutosDoHorario(horario: string) {
  if (!timeRegex.test(horario)) return null;
  const [hora, minuto] = horario.split(":").map(Number);
  return hora * 60 + minuto;
}

export function adicionarDiasISO(dataISO: string, quantidade: number) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const data = new Date(ano, (mes ?? 1) - 1, dia ?? 1);
  data.setDate(data.getDate() + quantidade);
  const pad = (valor: number) => String(valor).padStart(2, "0");
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`;
}

export function diaDaSemanaISO(dataISO: string) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return new Date(ano, (mes ?? 1) - 1, dia ?? 1).getDay();
}

export function funcaoEhSupervisor(funcao: string | null | undefined) {
  const normalizada = (funcao ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  return /^SUPERVISOR(?:\s|[-/]|$)/.test(normalizada);
}

export function jornadaNormal(dataISO: string): number {
  const dia = diaDaSemanaISO(dataISO);
  if (dia === 0 || dia === 6) return 0;
  return dia === 5 ? 8 : 9;
}

type SegmentoBruto = Pick<
  SegmentoJornada,
  "data" | "inicioMinutoDia" | "fimMinutoDia" | "minutosBrutos"
>;

function criarSegmentos(dataISO: string, inicio: number, fimAbsoluto: number): SegmentoBruto[] {
  const cortes = new Set([inicio, fimAbsoluto]);
  for (let dia = 0; dia <= 1; dia += 1) {
    const base = dia * MINUTOS_DIA;
    for (const minuto of [0, 300, 1320, MINUTOS_DIA]) {
      const corte = base + minuto;
      if (corte > inicio && corte < fimAbsoluto) cortes.add(corte);
    }
  }
  const pontos = [...cortes].sort((a, b) => a - b);
  return pontos.slice(0, -1).map((ponto, indice) => {
    const fim = pontos[indice + 1];
    const deslocamentoDia = Math.floor(ponto / MINUTOS_DIA);
    return {
      data: adicionarDiasISO(dataISO, deslocamentoDia),
      inicioMinutoDia: ponto % MINUTOS_DIA,
      fimMinutoDia: fim % MINUTOS_DIA || MINUTOS_DIA,
      minutosBrutos: fim - ponto,
    };
  });
}

function ratearIntervalo(segmentos: SegmentoBruto[], intervalo: number, permanencia: number) {
  // Regra formal: maior resto, com desempate pelo segmento cronologicamente anterior.
  // O rateio acontece antes da classificação de custo e é idêntico para qualquer função.
  const parcelas = segmentos.map((segmento, indice) => {
    const produto = segmento.minutosBrutos * intervalo;
    return {
      indice,
      minutos: Math.floor(produto / permanencia),
      restoInteiro: produto % permanencia,
    };
  });
  const faltantes = intervalo - parcelas.reduce((total, item) => total + item.minutos, 0);
  const ordem = [...parcelas].sort(
    (a, b) => b.restoInteiro - a.restoInteiro || a.indice - b.indice,
  );
  for (let i = 0; i < faltantes; i += 1) parcelas[ordem[i].indice].minutos += 1;
  return parcelas.map((item) => item.minutos);
}

function invalido(data: string, intervalo: number, erro: string): CalculoJornada {
  return {
    valido: false,
    erro,
    dataInicio: data,
    dataSaida: data,
    atravessaMeiaNoite: false,
    permanenciaMinutos: 0,
    intervaloMinutos: intervalo,
    totalTrabalhadoMinutos: 0,
    minutosNormais: 0,
    minutosHe50: 0,
    minutosHe100: 0,
    minutosSemAdicionalHe: 0,
    minutosNoturnosReais: 0,
    minutosNoturnosRemuneraveis: 0,
    minutosNoturnosNormaisRemuneraveis: 0,
    minutosNoturnosHe50Remuneraveis: 0,
    minutosNoturnosHe100Remuneraveis: 0,
    minutosNoturnosSemAdicionalHeRemuneraveis: 0,
    horasNormais: 0,
    horasExtras: 0,
    total: 0,
    excepcionalAcima10h: false,
    excepcionalAcima12h: false,
    exigeJustificativa: false,
    segmentos: [],
    versaoCalculo: JORNADA_CALCULO_VERSAO,
  };
}

export function calcularJornadaDetalhada(input: {
  data: string;
  horaEntrada: string;
  horaSaida: string;
  intervaloMinutos?: number;
  feriados?: ReadonlySet<string>;
  funcao?: string | null;
}): CalculoJornada {
  const entrada = minutosDoHorario(input.horaEntrada);
  const saida = minutosDoHorario(input.horaSaida);
  const intervalo = Number(input.intervaloMinutos ?? 60);
  if (entrada === null || saida === null)
    return invalido(input.data, intervalo, "Informe horários válidos.");
  if (!Number.isInteger(intervalo) || intervalo < 0)
    return invalido(input.data, intervalo, "O intervalo deve ser um número inteiro não negativo.");
  if (entrada === saida)
    return invalido(input.data, intervalo, "Entrada e saída não podem ser iguais.");
  const atravessaMeiaNoite = saida < entrada;
  const fimAbsoluto = saida + (atravessaMeiaNoite ? MINUTOS_DIA : 0);
  const permanencia = fimAbsoluto - entrada;
  if (intervalo >= permanencia)
    return invalido(input.data, intervalo, "O intervalo deve ser menor que a permanência.");

  const brutos = criarSegmentos(input.data, entrada, fimAbsoluto);
  const intervalos = ratearIntervalo(brutos, intervalo, permanencia);
  const supervisor = funcaoEhSupervisor(input.funcao);
  let limiteNormal: number | null = null;
  let normaisUsados = 0;
  const segmentos = brutos.map((segmento, indice): SegmentoJornada => {
    const liquidos = segmento.minutosBrutos - intervalos[indice];
    const dia = diaDaSemanaISO(segmento.data);
    const feriado = input.feriados?.has(segmento.data) ?? false;
    const noturno = segmento.inicioMinutoDia >= 1320 || segmento.fimMinutoDia <= 300;
    let minutosNormais = 0;
    let minutosHe50 = 0;
    let minutosHe100 = 0;
    let minutosSemAdicionalHe = 0;
    if (supervisor) {
      if (feriado || dia === 0 || dia === 6) {
        minutosSemAdicionalHe = liquidos;
      } else {
        if (limiteNormal === null) limiteNormal = jornadaNormal(segmento.data) * 60;
        minutosNormais = Math.min(liquidos, Math.max(0, limiteNormal - normaisUsados));
        normaisUsados += minutosNormais;
        minutosSemAdicionalHe = liquidos - minutosNormais;
      }
    } else if (feriado || dia === 0) minutosHe100 = liquidos;
    else if (dia === 6) minutosHe50 = liquidos;
    else {
      if (limiteNormal === null) limiteNormal = jornadaNormal(segmento.data) * 60;
      minutosNormais = Math.min(liquidos, Math.max(0, limiteNormal - normaisUsados));
      normaisUsados += minutosNormais;
      minutosHe50 = liquidos - minutosNormais;
    }
    const minutosNoturnosReais = noturno ? liquidos : 0;
    return {
      ...segmento,
      minutosIntervalo: intervalos[indice],
      minutosLiquidos: liquidos,
      minutosNormais,
      minutosHe50,
      minutosHe100,
      minutosSemAdicionalHe,
      minutosNoturnosReais,
      minutosNoturnosRemuneraveis:
        Math.round(((minutosNoturnosReais * 60) / MINUTOS_HORA_NOTURNA_REDUZIDA) * 10000) / 10000,
    };
  });
  const somar = (campo: keyof SegmentoJornada) =>
    segmentos.reduce((t, s) => t + Number(s[campo]), 0);
  const totalTrabalhadoMinutos = permanencia - intervalo;
  const minutosNormais = somar("minutosNormais");
  const minutosHe50 = somar("minutosHe50");
  const minutosHe100 = somar("minutosHe100");
  const minutosSemAdicionalHe = somar("minutosSemAdicionalHe");
  const minutosNoturnosReais = somar("minutosNoturnosReais");
  const remunerarNoturnos = (
    campo: "minutosNormais" | "minutosHe50" | "minutosHe100" | "minutosSemAdicionalHe",
  ) =>
    Math.round(
      ((segmentos.reduce(
        (total, segmento) => total + (segmento.minutosNoturnosReais > 0 ? segmento[campo] : 0),
        0,
      ) *
        60) /
        MINUTOS_HORA_NOTURNA_REDUZIDA) *
        10000,
    ) / 10000;
  const minutosNoturnosNormaisRemuneraveis = remunerarNoturnos("minutosNormais");
  const minutosNoturnosHe50Remuneraveis = remunerarNoturnos("minutosHe50");
  const minutosNoturnosHe100Remuneraveis = remunerarNoturnos("minutosHe100");
  const minutosNoturnosSemAdicionalHeRemuneraveis = remunerarNoturnos("minutosSemAdicionalHe");
  const minutosNoturnosRemuneraveis =
    Math.round(
      (minutosNoturnosNormaisRemuneraveis +
        minutosNoturnosHe50Remuneraveis +
        minutosNoturnosHe100Remuneraveis +
        minutosNoturnosSemAdicionalHeRemuneraveis) *
        10000,
    ) / 10000;
  return {
    valido: true,
    dataInicio: input.data,
    dataSaida: adicionarDiasISO(input.data, atravessaMeiaNoite ? 1 : 0),
    atravessaMeiaNoite,
    permanenciaMinutos: permanencia,
    intervaloMinutos: intervalo,
    totalTrabalhadoMinutos,
    minutosNormais,
    minutosHe50,
    minutosHe100,
    minutosSemAdicionalHe,
    minutosNoturnosReais,
    minutosNoturnosRemuneraveis,
    minutosNoturnosNormaisRemuneraveis,
    minutosNoturnosHe50Remuneraveis,
    minutosNoturnosHe100Remuneraveis,
    minutosNoturnosSemAdicionalHeRemuneraveis,
    horasNormais: Math.round((minutosNormais / 60) * 100) / 100,
    horasExtras: Math.round(((minutosHe50 + minutosHe100) / 60) * 100) / 100,
    total: Math.round((totalTrabalhadoMinutos / 60) * 100) / 100,
    excepcionalAcima10h: totalTrabalhadoMinutos > 600,
    excepcionalAcima12h: totalTrabalhadoMinutos > 720,
    exigeJustificativa: totalTrabalhadoMinutos > 720,
    segmentos,
    versaoCalculo: JORNADA_CALCULO_VERSAO,
  };
}

export function totalHorasTrabalhadas(entrada: string, saida: string, intervaloMinutos = 60) {
  return calcularJornadaDetalhada({
    data: "2000-01-03",
    horaEntrada: entrada,
    horaSaida: saida,
    intervaloMinutos,
  }).total;
}

export function calcularHorasJornada(
  entrada: string,
  saida: string,
  dataISO: string,
  intervaloMinutos = 60,
) {
  const c = calcularJornadaDetalhada({
    data: dataISO,
    horaEntrada: entrada,
    horaSaida: saida,
    intervaloMinutos,
  });
  return { total: c.total, horasNormais: c.horasNormais, horasExtras: c.horasExtras };
}

export function payloadHorasPermitido(dataISO: string, horasNormais: number, horasExtras: number) {
  return horasExtras === 0 || horasNormais > 0 || [0, 6].includes(diaDaSemanaISO(dataISO));
}

export function justificativaExtrasObrigatoria(horasExtras: number) {
  return horasExtras > 2;
}
