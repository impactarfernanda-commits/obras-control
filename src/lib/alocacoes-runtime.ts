export type AlocacoesQueryOperation =
  "funcionarios" | "funcionarios_historicos" | "obras" | "alocacoes" | "registros" | "auditoria";

export const ALOCACAO_ACTION_BUTTON_CLASS = "w-full justify-center sm:w-44";

type QueryErrorLike = {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  message?: unknown;
  stack?: unknown;
};

export type FuncionarioAlocacaoEntrada = {
  id?: unknown;
  nome?: unknown;
  categoria_mo?: unknown;
  ativo?: unknown;
  data_admissao?: unknown;
  data_desligamento?: unknown;
  deleted_at?: unknown;
  visivel_obras_control?: unknown;
};

export type FuncionarioAlocacao = {
  id: string;
  nome: string;
  categoria_mo: string | null;
  ativo: boolean;
  data_admissao: string | null;
  data_desligamento: string | null;
  deleted_at: string | null;
  visivel_obras_control: boolean | null;
};

export function logAlocacoesQueryError(operation: AlocacoesQueryOperation, error: unknown) {
  const candidate = error && typeof error === "object" ? (error as QueryErrorLike) : {};
  console.error(`[Alocacoes][${operation}]`, {
    name: typeof candidate.name === "string" ? candidate.name : "Error",
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    status:
      typeof candidate.status === "number" || typeof candidate.status === "string"
        ? candidate.status
        : undefined,
    message: typeof candidate.message === "string" ? candidate.message : "Erro desconhecido",
    stack: typeof candidate.stack === "string" ? candidate.stack : undefined,
  });
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizarFuncionariosAlocacao(rows: unknown): {
  validos: FuncionarioAlocacao[];
  ignorados: number;
} {
  if (!Array.isArray(rows)) return { validos: [], ignorados: 0 };

  const ids = new Set<string>();
  const validos: FuncionarioAlocacao[] = [];
  let ignorados = 0;

  for (const raw of rows) {
    const row = raw && typeof raw === "object" ? (raw as FuncionarioAlocacaoEntrada) : {};
    const id = nullableString(row.id);
    const nome = nullableString(row.nome);
    if (!id || !nome || ids.has(id)) {
      ignorados += 1;
      continue;
    }
    ids.add(id);
    validos.push({
      id,
      nome,
      categoria_mo: nullableString(row.categoria_mo),
      ativo: row.ativo === true,
      data_admissao: nullableString(row.data_admissao),
      data_desligamento: nullableString(row.data_desligamento),
      deleted_at: nullableString(row.deleted_at),
      visivel_obras_control:
        typeof row.visivel_obras_control === "boolean" ? row.visivel_obras_control : null,
    });
  }

  return { validos, ignorados };
}

export function logLinhasFuncionariosIgnoradas(ignorados: number) {
  if (ignorados > 0) console.warn("[Alocacoes][funcionarios_invalidos]", { count: ignorados });
}

export function rotuloFuncionarioAlocacao(funcionario: FuncionarioAlocacao) {
  const categoria = funcionario.categoria_mo?.trim() || "Sem função";
  const desligamento = funcionario.data_desligamento
    ? ` — desligado em ${new Date(`${funcionario.data_desligamento}T00:00:00`).toLocaleDateString("pt-BR")}`
    : "";
  return `${funcionario.nome} — ${categoria}${desligamento}`;
}
