export type TipoMaoObraLegado = "montagem" | "civil" | "indireta";

export type CentroCustoInterpretado = {
  codigoBase: string;
  tipoMaoObra: TipoMaoObraLegado;
  valorOriginal: string;
};

export type ObraParaConciliacao = {
  id: string;
  nome: string;
  codigo?: string | number | null;
};

const HIFENS_EQUIVALENTES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

export function interpretarCentroCusto(value: unknown): CentroCustoInterpretado | null {
  const valorOriginal = String(value ?? "").trim();
  const normalizado = valorOriginal
    .replace(HIFENS_EQUIVALENTES, "-")
    .replace(/\s*-\s*/g, "-")
    .toUpperCase();
  const match = normalizado.match(/^(\d+)(?:-([MC]))?$/);
  if (!match) return null;

  return {
    codigoBase: match[1],
    tipoMaoObra: match[2] === "M" ? "montagem" : match[2] === "C" ? "civil" : "indireta",
    valorOriginal,
  };
}

export function normalizarCodigoCentro(value: unknown): string | null {
  const codigo = String(value ?? "").trim();
  return /^\d+$/.test(codigo) ? codigo : null;
}

export function extrairCodigoInicialDoNome(nome: string): string | null {
  return nome.trim().match(/^(\d+)(?=\s*(?:-|$))/)?.[1] ?? null;
}

export function criarIndiceCentrosExistentes<T extends ObraParaConciliacao>(obras: T[]) {
  const porCodigo = new Map<string, T>();

  // O campo codigo tem prioridade sobre o fallback do nome, inclusive se a ordem mudar.
  for (const obra of obras) {
    const codigo = normalizarCodigoCentro(obra.codigo);
    if (codigo && !porCodigo.has(codigo)) porCodigo.set(codigo, obra);
  }
  for (const obra of obras) {
    const codigo = extrairCodigoInicialDoNome(obra.nome);
    if (codigo && !porCodigo.has(codigo)) porCodigo.set(codigo, obra);
  }

  return porCodigo;
}

export function conciliarCentroCusto<T extends ObraParaConciliacao>(
  interpretado: CentroCustoInterpretado,
  indice: ReadonlyMap<string, T>,
): T | null {
  return indice.get(interpretado.codigoBase) ?? null;
}
