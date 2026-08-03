const HORA_EM_MINUTOS = 60;
const INTERVALO_PADRAO_HORAS = 1;
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export function diaDaSemanaISO(dataISO: string) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return new Date(ano, (mes ?? 1) - 1, dia ?? 1).getDay();
}

export function totalHorasTrabalhadas(entrada: string, saida: string): number {
  if (!timeRegex.test(entrada) || !timeRegex.test(saida)) return 0;
  const [horaEntrada, minutoEntrada] = entrada.split(":").map(Number);
  const [horaSaida, minutoSaida] = saida.split(":").map(Number);
  const diferenca =
    horaSaida * HORA_EM_MINUTOS + minutoSaida - (horaEntrada * HORA_EM_MINUTOS + minutoEntrada);
  if (diferenca <= 0) return 0;
  return Math.max(
    0,
    Math.round((diferenca / HORA_EM_MINUTOS - INTERVALO_PADRAO_HORAS) * 100) / 100,
  );
}

export function jornadaNormal(dataISO: string): number {
  const dia = diaDaSemanaISO(dataISO);
  if (dia === 0 || dia === 6) return 0;
  return dia === 5 ? 8 : 9;
}

export function calcularHorasJornada(entrada: string, saida: string, dataISO: string) {
  const total = totalHorasTrabalhadas(entrada, saida);
  const normais = Math.min(total, jornadaNormal(dataISO));
  const extras = Math.max(0, total - normais);
  return {
    total,
    horasNormais: Math.round(normais * 100) / 100,
    horasExtras: Math.round(extras * 100) / 100,
  };
}

export function payloadHorasPermitido(dataISO: string, horasNormais: number, horasExtras: number) {
  return horasExtras === 0 || horasNormais > 0 || [0, 6].includes(diaDaSemanaISO(dataISO));
}

export function justificativaExtrasObrigatoria(horasExtras: number) {
  return horasExtras > 2;
}
