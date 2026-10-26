export function normalizarCategoriaFuncionario(valor: string | null | undefined) {
  return (valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function categoriaEhSupervisor(valor: string | null | undefined) {
  return /^SUPERVISOR(?:\s|[-/]|$)/.test(normalizarCategoriaFuncionario(valor));
}
