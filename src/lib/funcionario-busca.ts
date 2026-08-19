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

function relevanciaFuncionario(funcionario: FuncionarioBusca, busca: string, tokens: string[]) {
  const nome = normalizarTermoBusca(funcionario.nome);
  const funcao = normalizarTermoBusca(funcionario.categoria_mo ?? "");
  const todosNoNome = tokens.every((token) => nome.includes(token));
  const todosNoNomeOuFuncao = tokens.every(
    (token) => nome.includes(token) || funcao.includes(token),
  );

  if (!todosNoNomeOuFuncao) return null;
  if (nome === busca) return 0;
  if (nome.startsWith(busca)) return 1;
  if (todosNoNome) return 2;
  return 3;
}

export function filtrarFuncionariosBusca<T extends FuncionarioBusca>(
  funcionarios: readonly T[],
  termo: string,
) {
  const busca = normalizarTermoBusca(termo);
  if (!busca) return [...funcionarios];

  const tokens = busca.split(/\s+/).filter(Boolean);

  return funcionarios
    .map((funcionario, indice) => ({
      funcionario,
      indice,
      relevancia: relevanciaFuncionario(funcionario, busca, tokens),
    }))
    .filter((item): item is typeof item & { relevancia: number } => item.relevancia !== null)
    .sort((a, b) => a.relevancia - b.relevancia || a.indice - b.indice)
    .map(({ funcionario }) => funcionario);
}
