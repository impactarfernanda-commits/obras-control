export type FuncionarioCandidatoAlocacao = {
  id: string;
  nome: string;
  categoria_mo: string | null;
  ativo: boolean;
  deleted_at: string | null;
  visivel_obras_control: boolean | null;
};

export type AlocacaoAtual = {
  funcionario_id: string;
  obra_id: string;
  data: string;
};

export type ObraReferencia = {
  id: string;
  nome: string;
};

export type FiltrosFuncionariosAlocacao = {
  status: "all" | "ativo" | "inativo";
  tipo: "all" | "MOI" | "MOD";
  busca: string;
};

export function funcionariosElegiveisConsultaAlocacao<T extends FuncionarioCandidatoAlocacao>(
  funcionarios: readonly T[],
) {
  return funcionarios.filter(
    (funcionario) => funcionario.deleted_at === null && funcionario.visivel_obras_control === true,
  );
}

export function filtrarFuncionariosCandidatosAlocacao<T extends FuncionarioCandidatoAlocacao>(
  funcionarios: readonly T[],
  filtros: FiltrosFuncionariosAlocacao,
  resolverTipo: (categoria: string | null) => "MOI" | "MOD" | null,
) {
  const termo = filtros.busca.trim().toLocaleLowerCase("pt-BR");
  return funcionariosElegiveisConsultaAlocacao(funcionarios).filter((funcionario) => {
    if (filtros.status === "ativo" && funcionario.ativo !== true) return false;
    if (filtros.status === "inativo" && funcionario.ativo !== false) return false;
    if (filtros.tipo !== "all" && resolverTipo(funcionario.categoria_mo) !== filtros.tipo)
      return false;
    return !termo || funcionario.nome.toLocaleLowerCase("pt-BR").includes(termo);
  });
}

export function idsCanonicosFuncionarios(funcionarios: readonly { id: string }[]) {
  return Array.from(new Set(funcionarios.map((funcionario) => funcionario.id))).sort();
}

export const alocacoesCurrentKey = (userId: string, funcionarioIds: readonly string[]) =>
  ["alocacoes-current", userId, [...funcionarioIds]] as const;

export function ultimasAlocacoesPorFuncionario(alocacoesOrdenadas: readonly AlocacaoAtual[]) {
  const atuais = new Map<string, AlocacaoAtual>();
  for (const alocacao of alocacoesOrdenadas) {
    if (!atuais.has(alocacao.funcionario_id)) atuais.set(alocacao.funcionario_id, alocacao);
  }
  return atuais;
}

export function nomesObrasPorId(obras: readonly ObraReferencia[] | undefined) {
  return new Map((obras ?? []).map((obra) => [obra.id, obra.nome]));
}

export function nomeObraDaAlocacao(obraId: string, nomesPorId: ReadonlyMap<string, string>) {
  return nomesPorId.get(obraId) ?? `Centro de custo não disponível (${obraId})`;
}
