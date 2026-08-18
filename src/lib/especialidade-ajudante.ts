export type EspecialidadeAjudante = "civil" | "montagem";
export type TipoModRelatorio = "Civil" | "Montagem" | "A classificar";
export const COMPETENCIA_INICIO_SEGMENTACAO_MOD = "2026-08";

export function competenciaUsaSegmentacaoMod(competencia: string) {
  return competencia.slice(0, 7) >= COMPETENCIA_INICIO_SEGMENTACAO_MOD;
}

export function normalizarCategoriaMo(categoria: string | null | undefined) {
  return (categoria ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase()
    .replace(/^MESTRE DE OBRA(?=$| I$| II$)/, "MESTRE DE OBRAS");
}

export function categoriaEhAjudante(categoria: string | null | undefined) {
  return normalizarCategoriaMo(categoria) === "AJUDANTE";
}

export const CATEGORIAS_MOD_CIVIL_CONHECIDAS = [
  "PEDREIRO",
  "CARPINTEIRO",
  "ARMADOR",
  "MESTRE DE OBRAS",
  "MESTRE DE OBRAS I",
  "MESTRE DE OBRAS II",
  "OPERADOR DE RETRO",
  "OPERADOR DE RETROESCAVADEIRA",
  "OPERADOR ESCAVADEIRA",
  "OPERADOR DE ESCAVADEIRA",
] as const;

export const CATEGORIAS_MOD_MONTAGEM_CONHECIDAS = [
  "MONTADOR",
  "MONTADOR I",
  "MONTADOR II",
  "MEIO OFICIAL MONTADOR",
  "ENCARREGADO DE MONTAGEM",
  "LIDER DE MONTAGEM",
] as const;

const MOD_CIVIL = new Set<string>(CATEGORIAS_MOD_CIVIL_CONHECIDAS);
const MOD_MONTAGEM = new Set<string>(CATEGORIAS_MOD_MONTAGEM_CONHECIDAS);

export function classificarTipoMod(
  categoria: string | null | undefined,
  especialidade: EspecialidadeAjudante | null | undefined,
): TipoModRelatorio {
  // A especialidade persistida pertence a alocacao e prevalece sobre mudancas futuras no cadastro.
  if (especialidade === "civil") return "Civil";
  if (especialidade === "montagem") return "Montagem";
  const canonica = normalizarCategoriaMo(categoria);
  if (canonica === "AJUDANTE") {
    return "A classificar";
  }
  if (MOD_CIVIL.has(canonica)) return "Civil";
  if (MOD_MONTAGEM.has(canonica)) return "Montagem";
  return "A classificar";
}
