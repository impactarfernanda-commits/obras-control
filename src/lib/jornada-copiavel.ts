/** Espelha a classificação conservadora da RPC; a RPC revalida na gravação. */
export function jornadaOrigemCopiavel(
  registros: readonly {
    obra_id: string;
    tipo_registro: string | null;
    ausencia: boolean | null;
    falta_tipo: string | null;
    motivo_ausencia: string | null;
    horas_normais: number | null;
    horas_extras: number | null;
  }[],
  obraId: string,
  existeAlocacao: boolean,
) {
  if (!existeAlocacao) return false;
  const valido = (r: (typeof registros)[number]) =>
    r.tipo_registro === "horas" &&
    r.ausencia === false &&
    r.falta_tipo == null &&
    r.motivo_ausencia == null &&
    Number(r.horas_normais ?? 0) + Number(r.horas_extras ?? 0) > 0;
  return (
    registros.filter((r) => r.obra_id === obraId && valido(r)).length === 1 &&
    registros.every(valido)
  );
}
