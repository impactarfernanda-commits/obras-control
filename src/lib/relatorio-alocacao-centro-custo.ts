export type SituacaoAlocacaoCc = "alocado" | "ausencia" | "sem_alocacao" | "inconsistencia";
export type OrigemHorasAlocacaoCc = "detalhe" | "legado" | "sem_horas";

export type LinhaDiariaAlocacaoCc = {
  competencia: string;
  periodo_inicio: string;
  periodo_fim: string;
  funcionario_id: string;
  funcionario_nome: string;
  categoria: string;
  data: string;
  data_inicio: string | null;
  data_saida: string | null;
  hora_entrada: string | null;
  hora_saida: string | null;
  situacao: SituacaoAlocacaoCc;
  tipo_registro: string | null;
  falta_tipo: string | null;
  obra_id: string | null;
  obra_nome: string | null;
  minutos_normais: number;
  minutos_he_50: number;
  minutos_he_100: number;
  minutos_sem_adicional_he: number;
  minutos_noturnos: number;
  observacoes: string | null;
  possui_inconsistencia: boolean;
  tipo_inconsistencia: string | null;
  origem_horas: OrigemHorasAlocacaoCc;
  dia_esperado: boolean;
  dias_esperados_funcionario: number;
};

export type PartesCentroCusto = {
  centroCusto: string;
  obra: string;
  nomeCompleto: string;
  formatoReconhecido: boolean;
};

export function separarCentroCustoObra(nome: string | null | undefined): PartesCentroCusto {
  const nomeCompleto = nome?.trim() ?? "";
  const separador = nomeCompleto.indexOf(" - ");
  if (separador <= 0 || separador >= nomeCompleto.length - 3) {
    return {
      centroCusto: nomeCompleto || "Não definido",
      obra: nomeCompleto || "Não definida",
      nomeCompleto,
      formatoReconhecido: false,
    };
  }
  return {
    centroCusto: nomeCompleto.slice(0, separador).trim(),
    obra: nomeCompleto.slice(separador + 3).trim(),
    nomeCompleto,
    formatoReconhecido: true,
  };
}

export type ResumoAlocacaoCc = {
  funcionarioId: string;
  funcionarioNome: string;
  categoria: string;
  obraId: string;
  obraNome: string;
  centroCusto: string;
  obra: string;
  diasAlocados: number;
  horasNormais: number;
  horas50: number;
  horas100: number;
  horasSemAdicional: number;
  totalHoras: number;
  percentualDiasAlocados: number;
  diasEsperados: number;
  diasAusencia: number;
  diasSemAlocacao: number;
  percentualCobertura: number;
  percentualNaoDistribuido: number;
  possuiPendencia: boolean;
  observacaoPendencia: string;
};

export type FuncionarioAlocacaoCc = {
  funcionarioId: string;
  funcionarioNome: string;
  categoria: string;
  diasEsperados: number;
  diasAlocados: number;
  diasAusencia: number;
  diasSemAlocacao: number;
  percentualCobertura: number;
  linhas: ResumoAlocacaoCc[];
  detalhes: LinhaDiariaAlocacaoCc[];
};

export type RelatorioAlocacaoCc = {
  resumo: ResumoAlocacaoCc[];
  funcionarios: FuncionarioAlocacaoCc[];
  detalhes: LinhaDiariaAlocacaoCc[];
  inconsistencias: number;
};

const horas = (minutos: number) => Number(minutos || 0) / 60;
const chaveFuncionarioObra = (funcionarioId: string, obraId: string) =>
  `${funcionarioId}|${obraId}`;

export function montarRelatorioAlocacaoCentroCusto(
  entrada: readonly LinhaDiariaAlocacaoCc[],
): RelatorioAlocacaoCc {
  const detalhes = [...entrada].sort(
    (a, b) =>
      a.funcionario_nome.localeCompare(b.funcionario_nome, "pt-BR") ||
      a.data.localeCompare(b.data) ||
      (a.obra_nome ?? "").localeCompare(b.obra_nome ?? "", "pt-BR"),
  );
  const porFuncionario = new Map<string, LinhaDiariaAlocacaoCc[]>();
  for (const linha of detalhes) {
    const atuais = porFuncionario.get(linha.funcionario_id) ?? [];
    atuais.push(linha);
    porFuncionario.set(linha.funcionario_id, atuais);
  }

  const funcionarios: FuncionarioAlocacaoCc[] = [];
  const resumo: ResumoAlocacaoCc[] = [];
  for (const [funcionarioId, linhas] of porFuncionario) {
    const primeira = linhas[0];
    const datasAlocadas = new Set(
      linhas
        .filter((linha) => linha.obra_id && linha.situacao === "alocado")
        .map((linha) => linha.data),
    );
    const datasAusencia = new Set(
      linhas.filter((linha) => linha.situacao === "ausencia").map((linha) => linha.data),
    );
    const datasSemAlocacao = new Set(
      linhas.filter((linha) => linha.situacao === "sem_alocacao").map((linha) => linha.data),
    );
    const diasEsperados = Math.max(0, ...linhas.map((linha) => linha.dias_esperados_funcionario));
    const percentualCobertura = diasEsperados ? (datasAlocadas.size / diasEsperados) * 100 : 0;
    const porObra = new Map<string, LinhaDiariaAlocacaoCc[]>();
    for (const linha of linhas) {
      if (!linha.obra_id || linha.situacao !== "alocado") continue;
      const chave = chaveFuncionarioObra(funcionarioId, linha.obra_id);
      const atuais = porObra.get(chave) ?? [];
      atuais.push(linha);
      porObra.set(chave, atuais);
    }
    const linhasResumo: ResumoAlocacaoCc[] = [];
    for (const linhasObra of porObra.values()) {
      const base = linhasObra[0];
      const partes = separarCentroCustoObra(base.obra_nome);
      const dias = new Set(linhasObra.map((linha) => linha.data)).size;
      const normais = linhasObra.reduce((total, linha) => total + horas(linha.minutos_normais), 0);
      const he50 = linhasObra.reduce((total, linha) => total + horas(linha.minutos_he_50), 0);
      const he100 = linhasObra.reduce((total, linha) => total + horas(linha.minutos_he_100), 0);
      const semAdicional = linhasObra.reduce(
        (total, linha) => total + horas(linha.minutos_sem_adicional_he),
        0,
      );
      const inconsistencias = linhasObra
        .filter((linha) => linha.possui_inconsistencia)
        .map((linha) => linha.tipo_inconsistencia ?? "Inconsistência")
        .filter((valor, indice, todos) => todos.indexOf(valor) === indice);
      if (!partes.formatoReconhecido)
        inconsistencias.push("Nome do centro de custo fora do padrão");
      const item: ResumoAlocacaoCc = {
        funcionarioId,
        funcionarioNome: base.funcionario_nome,
        categoria: base.categoria,
        obraId: base.obra_id!,
        obraNome: base.obra_nome ?? "",
        centroCusto: partes.centroCusto,
        obra: partes.obra,
        diasAlocados: dias,
        horasNormais: normais,
        horas50: he50,
        horas100: he100,
        horasSemAdicional: semAdicional,
        totalHoras: normais + he50 + he100 + semAdicional,
        percentualDiasAlocados: datasAlocadas.size ? (dias / datasAlocadas.size) * 100 : 0,
        diasEsperados,
        diasAusencia: datasAusencia.size,
        diasSemAlocacao: datasSemAlocacao.size,
        percentualCobertura,
        percentualNaoDistribuido: diasEsperados
          ? (Math.max(0, diasEsperados - datasAlocadas.size) / diasEsperados) * 100
          : 0,
        possuiPendencia:
          inconsistencias.length > 0 || datasSemAlocacao.size > 0 || datasAusencia.size > 0,
        observacaoPendencia: [
          ...inconsistencias,
          ...(datasAusencia.size ? [`${datasAusencia.size} dia(s) de ausência`] : []),
          ...(datasSemAlocacao.size ? [`${datasSemAlocacao.size} dia(s) sem alocação`] : []),
        ].join("; "),
      };
      linhasResumo.push(item);
      resumo.push(item);
    }
    linhasResumo.sort((a, b) =>
      a.centroCusto.localeCompare(b.centroCusto, "pt-BR", { numeric: true }),
    );
    funcionarios.push({
      funcionarioId,
      funcionarioNome: primeira.funcionario_nome,
      categoria: primeira.categoria,
      diasEsperados,
      diasAlocados: datasAlocadas.size,
      diasAusencia: datasAusencia.size,
      diasSemAlocacao: datasSemAlocacao.size,
      percentualCobertura,
      linhas: linhasResumo,
      detalhes: linhas,
    });
  }
  funcionarios.sort((a, b) => a.funcionarioNome.localeCompare(b.funcionarioNome, "pt-BR"));
  resumo.sort(
    (a, b) =>
      a.funcionarioNome.localeCompare(b.funcionarioNome, "pt-BR") ||
      a.centroCusto.localeCompare(b.centroCusto, "pt-BR", { numeric: true }),
  );
  return {
    resumo,
    funcionarios,
    detalhes,
    inconsistencias: detalhes.filter((linha) => linha.possui_inconsistencia).length,
  };
}
