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

export function codigoCcResponsaveis(nome: string): string | null {
  return nome.match(/^\s*(?:CC\s*)?(\d+(?:\.\d+)*)\s*(?:-|–|—|$)/i)?.[1] ?? null;
}

export function consolidarDesdobramentosResponsaveis(
  obras: readonly ObraComResponsaveis[],
): ObraComResponsaveis[] {
  const codigos = new Set(obras.map((obra) => codigoCcResponsaveis(obra.nome)).filter(Boolean));
  return obras.filter((obra) => {
    const codigo = codigoCcResponsaveis(obra.nome);
    if (!codigo?.includes(".")) return true;
    return !codigos.has(codigo.split(".")[0]);
  });
}

export function obrasExibidasResponsaveis(
  obras: readonly ObraComResponsaveis[],
  mostrarFinalizadas = false,
): ObraComResponsaveis[] {
  return consolidarDesdobramentosResponsaveis(
    filtrarObrasResponsaveis(obras, "", mostrarFinalizadas),
  );
}

export function selecionarCcsColados(
  obras: readonly ObraComResponsaveis[],
  texto: string,
): { ids: string[]; naoEncontrados: string[] } {
  const codigos = [
    ...new Set(
      texto
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  const porCodigo = new Map(obras.map((obra) => [codigoCcResponsaveis(obra.nome), obra.id]));
  return {
    ids: codigos.map((codigo) => porCodigo.get(codigo)).filter((id): id is string => !!id),
    naoEncontrados: codigos.filter((codigo) => !porCodigo.has(codigo)),
  };
}

export function resumirVinculosLote(
  obraIds: readonly string[],
  existentes: ReadonlySet<string>,
): { novos: number; existentes: number } {
  return {
    novos: obraIds.filter((id) => !existentes.has(id)).length,
    existentes: obraIds.filter((id) => existentes.has(id)).length,
  };
}

export async function vincularResponsavelEmLote(
  role: string | null | undefined,
  obraIds: readonly string[],
  vincular: (obraId: string) => Promise<"criado" | "existente">,
): Promise<{
  criados: number;
  existentes: number;
  falhas: Array<{ obraId: string; erro: string }>;
}> {
  if (!podeGerenciarResponsaveis(role))
    throw new Error("Sem permissão para vincular responsáveis.");
  const resultado = {
    criados: 0,
    existentes: 0,
    falhas: [] as Array<{ obraId: string; erro: string }>,
  };
  for (const obraId of new Set(obraIds)) {
    try {
      const estado = await vincular(obraId);
      if (estado === "criado") resultado.criados += 1;
      else resultado.existentes += 1;
    } catch (error) {
      resultado.falhas.push({
        obraId,
        erro: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return resultado;
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

export type BlocoHierarquia = { pessoaId: string; nome: string; obras: ObraComResponsaveis[] };

export function montarHierarquiaResponsaveis(
  obras: readonly ObraComResponsaveis[],
  busca: string,
  mostrarFinalizadas = false,
): {
  diretores: BlocoHierarquia[];
  gerentes: BlocoHierarquia[];
  coordenadoresDiretos: BlocoHierarquia[];
  semGestor: ObraComResponsaveis[];
} {
  const exibidas = obrasExibidasResponsaveis(obras, mostrarFinalizadas);
  const termo = normalizarBuscaResponsaveis(busca);
  const obrasCompativeis = new Set(
    filtrarObrasResponsaveis(exibidas, busca, true).map((obra) => obra.id),
  );
  const porCargo = (
    nomeCargo: string,
    elegivel: (obra: ObraComResponsaveis) => boolean,
    ignorarBusca = false,
  ) => {
    const blocos = new Map<string, BlocoHierarquia>();
    for (const obra of exibidas) {
      if (!elegivel(obra)) continue;
      for (const cargo of obra.cargos.filter((item) => item.nome === nomeCargo)) {
        for (const pessoa of cargo.pessoas) {
          const bloco = blocos.get(pessoa.pessoaId) ?? {
            pessoaId: pessoa.pessoaId,
            nome: pessoa.nome,
            obras: [],
          };
          bloco.obras.push(obra);
          blocos.set(pessoa.pessoaId, bloco);
        }
      }
    }
    return [...blocos.values()]
      .map((bloco) => ({
        ...bloco,
        obras:
          ignorarBusca || (termo && normalizarBuscaResponsaveis(bloco.nome).includes(termo))
            ? bloco.obras
            : bloco.obras.filter((obra) => obrasCompativeis.has(obra.id)),
      }))
      .filter((bloco) => bloco.obras.length > 0)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  };
  const temGerente = (obra: ObraComResponsaveis) =>
    obra.cargos.some((cargo) => cargo.nome === "Gerente de Obras" && cargo.pessoas.length > 0);
  const temCoordenadorDireto = (obra: ObraComResponsaveis) =>
    !temGerente(obra) &&
    obra.cargos.some((cargo) => cargo.nome === "Coordenador" && cargo.pessoas.length > 0);
  const gerentes = porCargo("Gerente de Obras", temGerente);
  const coordenadoresDiretos = porCargo("Coordenador", temCoordenadorDireto);
  const semGestor = exibidas.filter(
    (obra) => !temGerente(obra) && !temCoordenadorDireto(obra) && obrasCompativeis.has(obra.id),
  );
  const diretores = porCargo("Diretor de Obras", () => true, true);
  return { diretores, gerentes, coordenadoresDiretos, semGestor };
}

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
