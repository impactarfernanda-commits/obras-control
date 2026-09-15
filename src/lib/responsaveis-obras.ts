export type ResponsavelObraRow = {
  obra_id: string;
  obra_nome: string;
  obra_status: string;
  obra_cargo_id: string | null;
  cargo_id: string | null;
  cargo_nome: string | null;
  cargo_ordem: number | null;
  vinculo_id: string | null;
  pessoa_id: string | null;
  pessoa_nome: string | null;
  pessoa_tipo: string | null;
  funcionario_id: string | null;
  total_obras_pessoa: number;
  compartilhado: boolean;
};

export type StatusResponsavel = "nao_definido" | "definido" | "compartilhado";

export function podeGerenciarResponsaveis(role: string | null | undefined): boolean {
  return role === "gerente" || role === "diretor";
}

export type CadastroResponsavelExclusao =
  | { tipo: "cargo"; id: string; nome: string }
  | { tipo: "pessoa"; id: string; nome: string; funcionario_id: string | null };

// A FK RESTRICT é a autoridade final, inclusive para vínculos de obras ocultas
// e para vínculos inseridos simultaneamente. Não depende de contagem via RLS.
export async function excluirCadastroResponsavel(
  role: string | null | undefined,
  alvo: CadastroResponsavelExclusao,
  excluir: (alvo: CadastroResponsavelExclusao) => Promise<{ id: string } | null>,
): Promise<void> {
  if (!podeGerenciarResponsaveis(role)) throw new Error("Sem permissão para excluir cadastros.");
  if (alvo.tipo === "pessoa" && alvo.funcionario_id !== null) {
    throw new Error(
      "Funcionários não podem ser excluídos por este módulo. Remova apenas os vínculos.",
    );
  }
  try {
    const removido = await excluir(alvo);
    if (!removido || removido.id !== alvo.id) {
      throw new Error("Cadastro não excluído. Verifique sua permissão ou atualize a lista.");
    }
  } catch (error) {
    if ((error as { code?: string })?.code === "23503") {
      throw new Error(
        alvo.tipo === "cargo"
          ? "Cargo em uso. Remova primeiro todos os vínculos com as obras, inclusive obras ocultas. Você também pode desativar o cargo."
          : "Pessoa manual em uso. Remova primeiro todos os vínculos com as obras, inclusive obras ocultas.",
      );
    }
    throw error;
  }
}

export type CargoDaObra = {
  id: string;
  cargoId: string;
  nome: string;
  ordem: number;
  pessoas: Array<{
    vinculoId: string;
    pessoaId: string;
    nome: string;
    tipo: string;
    status: Exclude<StatusResponsavel, "nao_definido">;
  }>;
};

export type ObraComResponsaveis = {
  id: string;
  nome: string;
  status: string;
  cargos: CargoDaObra[];
  totalDefinidos: number;
};

export function normalizarBuscaResponsaveis(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export function agruparResponsaveis(rows: readonly ResponsavelObraRow[]): ObraComResponsaveis[] {
  const obras = new Map<string, ObraComResponsaveis>();

  for (const row of rows) {
    let obra = obras.get(row.obra_id);
    if (!obra) {
      obra = {
        id: row.obra_id,
        nome: row.obra_nome,
        status: row.obra_status,
        cargos: [],
        totalDefinidos: 0,
      };
      obras.set(row.obra_id, obra);
    }
    if (!row.obra_cargo_id || !row.cargo_id || !row.cargo_nome) continue;

    let cargo = obra.cargos.find((item) => item.id === row.obra_cargo_id);
    if (!cargo) {
      cargo = {
        id: row.obra_cargo_id,
        cargoId: row.cargo_id,
        nome: row.cargo_nome,
        ordem: row.cargo_ordem ?? 0,
        pessoas: [],
      };
      obra.cargos.push(cargo);
    }
    if (row.vinculo_id && row.pessoa_id && row.pessoa_nome) {
      cargo.pessoas.push({
        vinculoId: row.vinculo_id,
        pessoaId: row.pessoa_id,
        nome: row.pessoa_nome,
        tipo: row.pessoa_tipo ?? "manual",
        status: row.compartilhado ? "compartilhado" : "definido",
      });
      obra.totalDefinidos += 1;
    }
  }

  return [...obras.values()]
    .map((obra) => ({
      ...obra,
      cargos: obra.cargos.sort(
        (a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"),
      ),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export function filtrarObrasResponsaveis(
  obras: readonly ObraComResponsaveis[],
  busca: string,
  mostrarFinalizadas = false,
): ObraComResponsaveis[] {
  const exibidas = mostrarFinalizadas
    ? [...obras]
    : obras.filter((obra) => obra.status !== "Concluída");
  const termo = normalizarBuscaResponsaveis(busca);
  if (!termo) return exibidas;
  return exibidas.filter((obra) =>
    normalizarBuscaResponsaveis(
      [
        obra.nome,
        ...obra.cargos.flatMap((cargo) => [cargo.nome, ...cargo.pessoas.map((p) => p.nome)]),
      ].join(" "),
    ).includes(termo),
  );
}

export function pessoasSemelhantes<T extends { nome: string }>(
  pessoas: readonly T[],
  nome: string,
): T[] {
  const termo = normalizarBuscaResponsaveis(nome);
  if (termo.length < 3) return [];
  return pessoas.filter((pessoa) => {
    const existente = normalizarBuscaResponsaveis(pessoa.nome);
    return existente.includes(termo) || termo.includes(existente);
  });
}
