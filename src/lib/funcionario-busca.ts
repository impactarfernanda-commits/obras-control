export type FuncionarioBusca = {
  id: string;
  nome: string;
  categoria_mo?: string | null;
  ativo?: boolean;
  data_desligamento?: string | null;
};

function normalizarTermoBusca(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export function filtrarFuncionariosBusca<T extends FuncionarioBusca>(
  funcionarios: readonly T[],
  termo: string,
) {
  const busca = normalizarTermoBusca(termo);
  if (!busca) return [...funcionarios];

  return funcionarios.filter((funcionario) =>
    normalizarTermoBusca(
      [funcionario.nome, funcionario.categoria_mo ?? ""].filter(Boolean).join(" "),
    ).includes(busca),
  );
}
