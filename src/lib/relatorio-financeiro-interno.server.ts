import {
  calcularCusto,
  custoDoDia,
  diasUteisNoIntervalo,
  horasPadraoDoDia,
  type Beneficios,
  type CustoBreakdown,
} from "./custos-core.ts";
import { tipoCategoria, type Categoria } from "./categorias-core.ts";
import { competenciaUsaSegmentacaoMod } from "./especialidade-ajudante.ts";
import {
  consolidarCustosCentros,
  type AlocacaoRelatorio,
  type RegistroRelatorio,
} from "./relatorio-centro-custo.ts";
import { consolidarCustoFuncionario } from "./relatorio-funcionario.ts";
import type { DetalheJornadaVisual } from "./horas-visualizacao.ts";
import type { RegimeVigencia } from "./regimes.ts";
import type { VigenciaCentroCusto } from "./supervisor-cc.ts";

export type FuncionarioFinanceiroInterno = {
  id: string;
  nome: string;
  categoria_mo: string;
  ativo?: boolean;
  salario: number | null;
  deleted_at: string | null;
  visivel_obras_control: boolean | null;
  data_admissao: string | null;
  data_desligamento: string | null;
};

export type AlocacaoFinanceiraInterna = AlocacaoRelatorio & {
  id?: string;
  hora_entrada?: string | null;
  hora_saida?: string | null;
};

export type RegistroFinanceiroInterno = RegistroRelatorio & {
  observacoes?: string | null;
};

export type AlocacaoDiariaFinanceira = {
  obra_id: string;
  data: string;
  hora_entrada: string | null;
  hora_saida: string | null;
};

export type DetalheDiarioFinanceiro = Pick<
  DetalheJornadaVisual,
  | "minutos_normais"
  | "minutos_he_50"
  | "minutos_he_100"
  | "minutos_sem_adicional_he"
  | "minutos_noturnos_reais"
  | "minutos_noturnos_remuneraveis"
  | "jornada_excepcional"
>;

export type RegistroDiarioFinanceiro = {
  id?: string;
  obra_id: string;
  data: string;
  horas_normais: number;
  horas_extras: number;
  ausencia: boolean;
  tipo_registro?: "horas" | "falta" | "ferias" | "folga_campo";
  falta_tipo?: string | null;
  observacoes: string | null;
  detalhe: DetalheDiarioFinanceiro | null;
};

export type EntradaProcessamentoFinanceiroInterno = {
  competencia: string;
  periodo: { start: string; end: string; startDate: Date; endDate: Date };
  funcionarios: FuncionarioFinanceiroInterno[];
  beneficios: Beneficios | null;
  seguros: Array<{ categoria: string; seguro_vida: number | null }>;
  categorias: Categoria[];
  obras: Array<{ id: string; nome: string }>;
  alocacoes: AlocacaoFinanceiraInterna[];
  registros: RegistroFinanceiroInterno[];
  detalhes?: Array<DetalheJornadaVisual & { registro_horas_id: string }>;
  feriados?: string[];
  vigenciasRegime?: RegimeVigencia[];
  alocacoesReferenciaRegime?: Array<{
    funcionarioId: string;
    obraId: string;
    data: string;
  }>;
  alocacoesReferenciaClassificacao?: AlocacaoRelatorio[];
  vigenciasCentroCusto?: VigenciaCentroCusto[];
};

export type ProjecaoFinanceiraFuncionarioInterna = {
  funcionarioId: string;
  funcionarioNome: string;
  categoria: string;
  tipo: "MOD" | "MOI" | null;
  ativo: boolean;
  dataAdmissao: string | null;
  dataDesligamento: string | null;
  custoMensal: CustoBreakdown;
  totalMensalIntegral: number;
  proporcionalCompetencia: ReturnType<typeof consolidarCustoFuncionario>;
  totalProporcionalCompetencia: number;
  alocacoes: AlocacaoDiariaFinanceira[];
  registros: RegistroDiarioFinanceiro[];
};

export async function executarProcessamentoFinanceiroAutorizado(input: {
  roles: string[];
  rolesPermitidas: readonly string[];
  mensagemProibido: string;
  incluirProjecaoFolha: boolean;
  carregarEntrada: () => Promise<EntradaProcessamentoFinanceiroInterno>;
}) {
  if (!input.roles.some((role) => input.rolesPermitidas.includes(role)))
    throw new Error(input.mensagemProibido);
  const entrada = await input.carregarEntrada();
  return {
    entrada,
    processamento: processarFinanceiroRelatoriosInterno(entrada, {
      incluirProjecaoFolha: input.incluirProjecaoFolha,
    }),
  };
}

export function processarFinanceiroRelatoriosInterno(
  input: EntradaProcessamentoFinanceiroInterno,
  options: { incluirProjecaoFolha: boolean },
) {
  const funcionarios = input.funcionarios.filter(
    (funcionario) => funcionario.deleted_at == null && funcionario.visivel_obras_control !== false,
  );
  const seguros = new Map(
    input.seguros.map((registro) => [registro.categoria, Number(registro.seguro_vida ?? 0)]),
  );
  const custos = new Map(
    funcionarios.map((funcionario) => [
      funcionario.id,
      calcularCusto(
        funcionario.salario,
        input.beneficios,
        seguros.get(funcionario.categoria_mo) ?? 0,
      ),
    ]),
  );
  const detalhePorRegistro = new Map(
    (input.detalhes ?? []).map((detalhe) => [detalhe.registro_horas_id, detalhe]),
  );
  const registros = input.registros.map((registro) => ({
    ...registro,
    detalhe: registro.id ? (detalhePorRegistro.get(registro.id) ?? null) : null,
  }));
  const segmentarMod = competenciaUsaSegmentacaoMod(input.competencia);
  const consolidacao = consolidarCustosCentros({
    alocacoes: input.alocacoes,
    registros,
    funcionarios,
    custos,
    obras: new Map(input.obras.map((obra) => [obra.id, obra.nome])),
    diasUteis: diasUteisNoIntervalo(input.periodo.startDate, input.periodo.endDate),
    resolverTipo: (alocacao, funcionario) => {
      if (alocacao?.tipo_mao_obra === "montagem" || alocacao?.tipo_mao_obra === "civil")
        return "MOD";
      if (alocacao?.tipo_mao_obra === "indireta") return "MOI";
      return tipoCategoria(funcionario.categoria_mo, input.categorias) ?? "MOD";
    },
    calcularCustoBase: (args) => custoDoDia({ ...args, horasExtras: 0 }),
    horasNormaisPadrao: horasPadraoDoDia,
    segmentarMod,
    feriados: new Set(input.feriados ?? []),
    periodoInicial: input.periodo.start,
    periodoFinal: input.periodo.end,
    vigenciasRegime: input.vigenciasRegime,
    alocacoesReferenciaRegime: input.alocacoesReferenciaRegime,
    alocacoesReferenciaClassificacao: input.alocacoesReferenciaClassificacao,
    vigenciasCentroCusto: input.vigenciasCentroCusto,
  });

  let projecaoFolha: ProjecaoFinanceiraFuncionarioInterna[] | null = null;
  if (options.incluirProjecaoFolha) {
    const idsComLancamento = new Set<string>();
    const alocacoesPorFuncionario = new Map<string, AlocacaoDiariaFinanceira[]>();
    const registrosPorFuncionario = new Map<string, RegistroDiarioFinanceiro[]>();
    for (const alocacao of input.alocacoes) {
      idsComLancamento.add(alocacao.funcionario_id);
      const alocacoesFuncionario = alocacoesPorFuncionario.get(alocacao.funcionario_id) ?? [];
      alocacoesFuncionario.push({
        obra_id: alocacao.obra_id,
        data: alocacao.data,
        hora_entrada: alocacao.hora_entrada ?? null,
        hora_saida: alocacao.hora_saida ?? null,
      });
      alocacoesPorFuncionario.set(alocacao.funcionario_id, alocacoesFuncionario);
    }
    for (const registro of registros) {
      idsComLancamento.add(registro.funcionario_id);
      const registrosFuncionario = registrosPorFuncionario.get(registro.funcionario_id) ?? [];
      const detalhe = registro.detalhe;
      registrosFuncionario.push({
        id: registro.id,
        obra_id: registro.obra_id,
        data: registro.data,
        horas_normais: registro.horas_normais,
        horas_extras: registro.horas_extras,
        ausencia: registro.ausencia,
        tipo_registro: registro.tipo_registro,
        falta_tipo: registro.falta_tipo,
        observacoes: registro.observacoes ?? null,
        detalhe: detalhe
          ? {
              minutos_normais: detalhe.minutos_normais,
              minutos_he_50: detalhe.minutos_he_50,
              minutos_he_100: detalhe.minutos_he_100,
              minutos_sem_adicional_he: detalhe.minutos_sem_adicional_he,
              minutos_noturnos_reais: detalhe.minutos_noturnos_reais,
              minutos_noturnos_remuneraveis: detalhe.minutos_noturnos_remuneraveis,
              jornada_excepcional: detalhe.jornada_excepcional,
            }
          : null,
      });
      registrosPorFuncionario.set(registro.funcionario_id, registrosFuncionario);
    }
    projecaoFolha = funcionarios
      .filter((funcionario) => funcionario.ativo !== false || idsComLancamento.has(funcionario.id))
      .map((funcionario) => {
        const custoMensal = custos.get(funcionario.id)!;
        const proporcionalCompetencia = consolidarCustoFuncionario(
          consolidacao.centros,
          funcionario.id,
        );
        return {
          funcionarioId: funcionario.id,
          funcionarioNome: funcionario.nome,
          categoria: funcionario.categoria_mo,
          tipo: tipoCategoria(funcionario.categoria_mo, input.categorias),
          ativo: funcionario.ativo !== false,
          dataAdmissao: funcionario.data_admissao,
          dataDesligamento: funcionario.data_desligamento,
          custoMensal,
          // Paridade intencional com a tabela atual: não inclui refeição nem adicional noturno.
          totalMensalIntegral: custoMensal.total + proporcionalCompetencia.custoHE,
          proporcionalCompetencia,
          totalProporcionalCompetencia: proporcionalCompetencia.total,
          alocacoes: alocacoesPorFuncionario.get(funcionario.id) ?? [],
          registros: registrosPorFuncionario.get(funcionario.id) ?? [],
        };
      });
  }

  return { consolidacao, segmentarMod, projecaoFolha };
}
