import type { TipoMaoObraLegado } from "./importacao-legado-centros";

export type CelulaAlocacaoLegado = {
  sourceCellKey: string;
  funcionarioKey: string;
  funcionarioNome: string;
  funcionarioId?: string;
  obraId: string;
  data: string;
  valorOriginal: string;
  codigoBase: string;
  tipoMaoObra: TipoMaoObraLegado;
};

export type AlocacaoBancoAuditoria = {
  id: string;
  funcionario_id: string;
  obra_id: string;
  data: string;
};

export type CelulaExistenteAuditoria<T extends CelulaAlocacaoLegado = CelulaAlocacaoLegado> = T & {
  quantidadeMatches: number;
  idsExistentes: string[];
  alocacoesExistentes: AlocacaoBancoAuditoria[];
  obraIdsExistentes: string[];
  centroDiferenteNaPlanilha: boolean;
  motivo: string;
};

export function criarSourceCellKey(rowIndex: number, columnIndex: number, data: string) {
  return `linha ${rowIndex + 1} | coluna ${columnIndex + 1} | ${data}`;
}

export function chaveOperacional(funcionarioId: string, obraId: string, data: string) {
  return `${funcionarioId}|${obraId}|${data}`;
}

export function chaveFuncionarioData(funcionarioId: string, data: string) {
  return `${funcionarioId}|${data}`;
}

export function conciliarCelulasComAlocacoesExistentes<T extends CelulaAlocacaoLegado>(
  celulas: T[],
  registrosBanco: AlocacaoBancoAuditoria[],
) {
  const registrosPorFuncionarioData = new Map<string, AlocacaoBancoAuditoria[]>();
  for (const registro of registrosBanco) {
    const chave = chaveFuncionarioData(registro.funcionario_id, registro.data);
    const grupo = registrosPorFuncionarioData.get(chave) ?? [];
    grupo.push(registro);
    registrosPorFuncionarioData.set(chave, grupo);
  }

  const novas: T[] = [];
  const existentes: CelulaExistenteAuditoria<T>[] = [];
  for (const celula of celulas) {
    const matches = celula.funcionarioId
      ? (registrosPorFuncionarioData.get(chaveFuncionarioData(celula.funcionarioId, celula.data)) ??
        [])
      : [];
    if (matches.length === 0) {
      novas.push(celula);
      continue;
    }
    const obraIdsExistentes = Array.from(new Set(matches.map((match) => match.obra_id)));
    existentes.push({
      ...celula,
      quantidadeMatches: matches.length,
      idsExistentes: matches.map((match) => match.id),
      alocacoesExistentes: matches,
      obraIdsExistentes,
      centroDiferenteNaPlanilha: obraIdsExistentes.some((obraId) => obraId !== celula.obraId),
      motivo:
        "O funcionário já possui alocação na data; o registro existente será preservado e a célula da planilha será ignorada.",
    });
  }

  return {
    novas,
    existentes,
    celulasUnicasExistentes: existentes.length,
    totalMatchesBanco: existentes.reduce((total, item) => total + item.quantidadeMatches, 0),
    matchesAdicionaisBanco: existentes.reduce(
      (total, item) => total + Math.max(0, item.quantidadeMatches - 1),
      0,
    ),
    duplicidadesHistoricas: existentes.filter((item) => item.quantidadeMatches > 1),
  };
}

export function separarDuplicidadesInternas(celulas: CelulaAlocacaoLegado[]) {
  const primeiraPorChave = new Map<string, CelulaAlocacaoLegado>();
  const unicas: CelulaAlocacaoLegado[] = [];
  const duplicadas: Array<{
    celula: CelulaAlocacaoLegado;
    primeiraSourceCellKey: string;
  }> = [];

  for (const celula of celulas) {
    const identidadeFuncionario = celula.funcionarioId ?? celula.funcionarioKey;
    const chave = chaveOperacional(identidadeFuncionario, celula.obraId, celula.data);
    const primeira = primeiraPorChave.get(chave);
    if (primeira) {
      duplicadas.push({ celula, primeiraSourceCellKey: primeira.sourceCellKey });
    } else {
      primeiraPorChave.set(chave, celula);
      unicas.push(celula);
    }
  }
  return { unicas, duplicadas };
}

export function somarGruposMutuamenteExclusivos(grupos: Record<string, number>) {
  return Object.values(grupos).reduce((total, quantidade) => total + quantidade, 0);
}
