export function dataLocalHoje() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(
    hoje.getDate(),
  ).padStart(2, "0")}`;
}

export function dataLancamentoFutura(data: string, hoje = dataLocalHoje()) {
  return Boolean(data) && data > hoje;
}

export function validarDataLancamento(data: string, tipo: "alocacao" | "horas") {
  if (!dataLancamentoFutura(data)) return;
  throw new Error(
    tipo === "alocacao"
      ? "Não é permitido lançar alocações em datas futuras."
      : "Não é permitido lançar horas em datas futuras.",
  );
}
