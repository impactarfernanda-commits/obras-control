export const LIMITE_HORAS_EXTRAS_SEM_JUSTIFICATIVA = 2;
export const LIMITE_MINUTOS_JORNADA_SEM_JUSTIFICATIVA = 10 * 60;

type RegraJustificativaExtras = {
  horasExtras: number;
  totalTrabalhadoMinutos: number;
};

/**
 * Espelha as duas validações persistidas no fluxo atual:
 * - registros_horas.extras_justificativa: horas_extras acima de 2h;
 * - obras_salvar_jornada_v2: jornada trabalhada acima de 10h.
 */
export function exigeJustificativaExtras({
  horasExtras,
  totalTrabalhadoMinutos,
}: RegraJustificativaExtras) {
  return (
    horasExtras > LIMITE_HORAS_EXTRAS_SEM_JUSTIFICATIVA ||
    totalTrabalhadoMinutos > LIMITE_MINUTOS_JORNADA_SEM_JUSTIFICATIVA
  );
}

export function justificativaExtrasValida(
  regra: RegraJustificativaExtras,
  justificativa: string | null | undefined,
) {
  return !exigeJustificativaExtras(regra) || Boolean(justificativa?.trim());
}
