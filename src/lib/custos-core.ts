export const ENCARGOS_PCT = 0.368;
export type Beneficios = {
  assistencia_medica: number;
  assistencia_odontologica: number;
  vale_alimentacao: number;
  multibeneficio: number;
};
export const BENEFICIOS_ZERO: Beneficios = {
  assistencia_medica: 0,
  assistencia_odontologica: 0,
  vale_alimentacao: 0,
  multibeneficio: 0,
};
export type CustoBreakdown = {
  salario: number;
  encargos: number;
  prov13: number;
  provAvisoPrevio: number;
  provFerias: number;
  beneficios: number;
  seguroVida: number;
  total: number;
};
export function totalBeneficios(b: Beneficios | null | undefined) {
  if (!b) return 0;
  return (
    Number(b.assistencia_medica || 0) +
    Number(b.assistencia_odontologica || 0) +
    Number(b.vale_alimentacao || 0) +
    Number(b.multibeneficio || 0)
  );
}
export function calcularCusto(
  salario: number | null | undefined,
  beneficios: Beneficios | null | undefined,
  seguroVida: number | null | undefined = 0,
): CustoBreakdown {
  const s = Number(salario || 0);
  const encargos = s * ENCARGOS_PCT;
  const prov13 = (s + encargos) / 12;
  const provAvisoPrevio = prov13;
  const provFerias = prov13 + prov13 / 3;
  const bnf = totalBeneficios(beneficios);
  const sv = Number(seguroVida || 0);
  return {
    salario: s,
    encargos,
    prov13,
    provAvisoPrevio,
    provFerias,
    beneficios: bnf,
    seguroVida: sv,
    total: s + encargos + prov13 + provAvisoPrevio + provFerias + bnf + sv,
  };
}
export const HE_MULTIPLICADOR = 1.5;
export function diasUteisNoIntervalo(start: Date, end: Date) {
  let count = 0;
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (d <= last) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) count += 1;
    d.setDate(d.getDate() + 1);
  }
  return count;
}
export function horasPadraoDoDia(dateISO: string) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dow = new Date(y, (m ?? 1) - 1, d ?? 1).getDay();
  if (dow >= 1 && dow <= 4) return 9;
  if (dow === 5) return 8;
  return 0;
}
export type DiaCustoInput = {
  custoMensal: number;
  diasUteis: number;
  dataISO: string;
  horasNormais?: number | null;
  horasExtras?: number | null;
  ausencia?: boolean | null;
};
export function custoDoDia(input: DiaCustoInput) {
  const { custoMensal, diasUteis, dataISO, horasNormais, horasExtras, ausencia } = input;
  if (ausencia || diasUteis <= 0 || custoMensal <= 0) return 0;
  const custoDiario = custoMensal / diasUteis;
  const padrao = horasPadraoDoDia(dataISO) || 9;
  if (horasNormais == null && horasExtras == null) return custoDiario;
  const valorHora = custoDiario / padrao;
  return (
    custoDiario * (Number(horasNormais || 0) / padrao) +
    valorHora * Number(horasExtras || 0) * HE_MULTIPLICADOR
  );
}
