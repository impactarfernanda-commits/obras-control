export type ColunaLegado = { index: number; date: string };

export type FuncionarioParaDesligamento = {
  id: string;
  nome: string;
  ativo: boolean;
  data_desligamento: string | null;
  deleted_at: string | null;
};

export type DesligamentoIdentificado = {
  funcionarioKey: string;
  funcionario: string;
  funcionarioId?: string;
  primeiraCelulaD: string;
  dataAtual: string | null;
  ativoAtual: boolean | null;
  acao: "aplicar" | "corrigir" | "manter" | "funcionario_novo" | "nao_encontrado";
};

export function dataLocalISO(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(
    data.getDate(),
  ).padStart(2, "0")}`;
}

export function primeiraDataDesligamento(
  row: unknown[],
  colunas: ColunaLegado[],
  estaDesligado: (value: unknown) => boolean,
): string | null {
  for (const coluna of [...colunas].sort((a, b) => a.date.localeCompare(b.date))) {
    if (estaDesligado(row[coluna.index])) return coluna.date;
  }
  return null;
}

export function planejarDesligamento(
  funcionarioKey: string,
  funcionario: string,
  primeiraCelulaD: string,
  existente?: FuncionarioParaDesligamento,
  funcionarioNovo = false,
): DesligamentoIdentificado {
  if (!existente) {
    return {
      funcionarioKey,
      funcionario,
      primeiraCelulaD,
      ativoAtual: null,
      dataAtual: null,
      acao: funcionarioNovo ? "funcionario_novo" : "nao_encontrado",
    };
  }
  return {
    funcionarioKey,
    funcionario,
    funcionarioId: existente.id,
    primeiraCelulaD,
    ativoAtual: existente.ativo,
    dataAtual: existente.data_desligamento,
    acao:
      !existente.ativo && existente.data_desligamento === primeiraCelulaD
        ? "manter"
        : existente.data_desligamento && existente.data_desligamento !== primeiraCelulaD
          ? "corrigir"
          : "aplicar",
  };
}

export function desligamentosParaAtualizar(itens: DesligamentoIdentificado[]) {
  return itens.filter(
    (item): item is DesligamentoIdentificado & { funcionarioId: string } =>
      Boolean(item.funcionarioId) && (item.acao === "aplicar" || item.acao === "corrigir"),
  );
}

export function validarDesligamentosAplicados(
  previstos: Array<DesligamentoIdentificado & { funcionarioId: string }>,
  atuais: Array<{ id: string; ativo: boolean; data_desligamento: string | null }>,
) {
  const porId = new Map(atuais.map((item) => [item.id, item]));
  return previstos.filter((previsto) => {
    const atual = porId.get(previsto.funcionarioId);
    return !atual || atual.ativo || atual.data_desligamento !== previsto.primeiraCelulaD;
  });
}

export function alocacoesAposDesligamento<
  T extends { id: string; funcionario_id: string; data: string },
>(desligamentos: DesligamentoIdentificado[], alocacoes: T[]): T[] {
  const dataPorId = new Map(
    desligamentos
      .filter((item): item is DesligamentoIdentificado & { funcionarioId: string } =>
        Boolean(item.funcionarioId),
      )
      .map((item) => [item.funcionarioId, item]),
  );
  return alocacoes.filter((alocacao) => {
    const desligamento = dataPorId.get(alocacao.funcionario_id);
    return desligamento && alocacao.data >= desligamento.primeiraCelulaD;
  });
}
