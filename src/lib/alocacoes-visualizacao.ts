import { tipoCategoria, type Categoria } from "./categorias-core.ts";

export function inicioDaSemanaSegunda(data: Date): Date {
  const inicio = new Date(data);
  const deslocamento = (inicio.getDay() + 6) % 7;
  inicio.setDate(inicio.getDate() - deslocamento);
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

export function semanaInicialDaCompetencia(
  ano: number,
  mes: number,
  referencia: Date = new Date(),
): Date {
  const competenciaAtual = ano === referencia.getFullYear() && mes === referencia.getMonth();
  return inicioDaSemanaSegunda(competenciaAtual ? referencia : new Date(ano, mes, 1));
}

function pesoTipo(
  categoria: string | null | undefined,
  categorias: Categoria[] | null | undefined,
) {
  const tipo = tipoCategoria(categoria, categorias);
  if (tipo === "MOI") return 0;
  if (tipo === "MOD") return 1;
  return 2;
}

export function compararCategoriasPorTipoENome(
  categoriaA: string | null | undefined,
  categoriaB: string | null | undefined,
  categorias: Categoria[] | null | undefined,
): number {
  return (
    pesoTipo(categoriaA, categorias) - pesoTipo(categoriaB, categorias) ||
    (categoriaA ?? "").localeCompare(categoriaB ?? "", "pt-BR", { sensitivity: "base" })
  );
}

export function ordenarFuncionariosPorTipoENome<T extends { nome: string }>(
  funcionarios: readonly T[],
  categorias: Categoria[] | null | undefined,
  obterCategoria: (funcionario: T) => string | null | undefined,
): T[] {
  return [...funcionarios].sort(
    (a, b) =>
      compararCategoriasPorTipoENome(obterCategoria(a), obterCategoria(b), categorias) ||
      a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }),
  );
}
