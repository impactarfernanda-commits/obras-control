import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buscarTodasPaginas } from "@/lib/paginacao";
import { diasUteisNoIntervalo } from "@/lib/custos-core";
import { apurarCustosRegime, type DiaTrabalhado, type RegimeVigencia } from "@/lib/regimes";
import {
  classificarRegistroGerencial,
  composicoesNaoReconciliadas,
  conflitosCategoriaEntreTipos,
  custoRegistroNaVigencia,
  indicadores,
  normalizarFuncaoOrcamento,
  pendenciasAtivacaoBaseline,
  tipoEfetivoMapeamento,
  vigenciaNaData,
  type CustoVigencia,
  type ResolucaoComposicao,
  type TipoAusencia,
  type TipoMO,
} from "@/lib/planejamento-hh-core";

type Role = "assistente" | "supervisor" | "coordenador" | "gerente" | "diretor";
type ItemBase = {
  id: string;
  funcao_orcamento: string;
  categoria_mo_mapeada: string | null;
  tipo_mo: TipoMO;
  hh_previsto: number;
  custo_previsto: number;
  metadata_calculo?: Record<string, unknown>;
};
type Registro = {
  funcionario_id: string;
  data: string;
  horas_normais: number;
  horas_extras: number;
  tipo_registro: "horas" | "falta" | "ferias" | "folga_campo";
  falta_tipo: string | null;
};
type Funcionario = {
  id: string;
  data_admissao: string | null;
  data_desligamento: string | null;
  deleted_at: string | null;
  visivel_obras_control: boolean | null;
};
type CustoVigenciaRow = {
  funcionario_id: string;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  categoria_mo: string;
  custo_mensal_total: number;
  status_historico: "estimado_inicial" | "apurado_por_vigencia";
};
type RegimeVigenciaRow = {
  funcionario_id: string;
  regime: "local" | "alojado";
  vigencia_inicio: string;
  vigencia_fim: string | null;
};
type AlocacaoReferenciaRow = {
  funcionario_id: string;
  obra_id: string;
  data: string;
};

const consultaSchema = z
  .object({
    obraId: z.string().uuid(),
    dataInicial: z.string().date(),
    dataFinal: z.string().date(),
  })
  .refine((v) => v.dataFinal >= v.dataInicial, "Periodo invalido");
const itemImportadoSchema = z.object({
  funcaoOrcamento: z.string().min(1),
  tipoMo: z.enum(["MOI", "MOD"]),
  hhPrevisto: z.number().nonnegative(),
  custoPrevisto: z.number().nonnegative(),
  origem: z.enum(["MO", "EAP/CPUs"]),
  metadataCalculo: z.record(z.unknown()),
});
const resolucaoComposicaoSchema = z.object({
  codigoComposicao: z.string().trim().min(1),
  descricao: z.string().trim().min(1).nullable().optional(),
  resolucao: z.literal("fora_escopo_mo"),
  motivo: z.literal("servico_terceirizado"),
  hhMoConsiderado: z.literal(0),
  custoMoConsiderado: z.literal(0),
  quantidade: z.number().nonnegative().nullable().optional(),
  valorGlobalCacheado: z.number().nonnegative().nullable().optional(),
});

async function permissoes(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const result = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  if (result.error) throw new Error(result.error.message);
  const roles = (result.data ?? []).map((r) => r.role as Role);
  const operacional = roles.some((r) => r === "gerente" || r === "diretor");
  const financeiro = roles.some((r) => r === "gerente" || r === "diretor");
  return { operacional, financeiro };
}

function isoLocal(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const getPlanejamentoHH = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => consultaSchema.parse(v))
  .handler(async ({ data, context }) => {
    const acesso = await permissoes(context.userId);
    if (!acesso.operacional)
      throw new Error("Forbidden: planejamento indisponivel para este perfil");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const baselineRes = await supabaseAdmin
      .from("planejamento_hh_baselines" as never)
      .select("id,nome,versao,arquivo_origem,criado_em" as never)
      .eq("obra_id" as never, data.obraId as never)
      .eq("ativa" as never, true as never)
      .maybeSingle();
    if (baselineRes.error) throw new Error(baselineRes.error.message);
    const baseline = baselineRes.data as unknown as {
      id: string;
      nome: string;
      versao: number;
      arquivo_origem: string;
      criado_em: string;
    } | null;
    if (!baseline)
      return {
        acessoFinanceiro: acesso.financeiro,
        baseline: null,
        linhas: [],
        totais: null,
        alertas: ["Baseline inexistente para este centro de custo."],
      };
    const inicio = new Date(`${data.dataInicial}T00:00:00`),
      fim = new Date(`${data.dataFinal}T00:00:00`);
    const [
      itens,
      funcionarios,
      registros,
      vigenciasRows,
      regimeRows,
      alocacoesReferencia,
      categorias,
    ] = await Promise.all([
      buscarTodasPaginas<ItemBase>(
        (from, to) =>
          supabaseAdmin
            .from("planejamento_hh_baseline_itens" as never)
            .select(
              "id,funcao_orcamento,categoria_mo_mapeada,tipo_mo,hh_previsto,custo_previsto" as never,
            )
            .eq("baseline_id" as never, baseline.id as never)
            .order("id" as never)
            .range(from, to) as never,
      ),
      buscarTodasPaginas<Funcionario>((from, to) =>
        supabaseAdmin
          .from("funcionarios")
          .select("id,data_admissao,data_desligamento,deleted_at,visivel_obras_control")
          .order("id")
          .range(from, to),
      ),
      buscarTodasPaginas<Registro>(
        (from, to) =>
          supabaseAdmin
            .from("registros_horas")
            .select("funcionario_id,data,horas_normais,horas_extras,tipo_registro,falta_tipo")
            .eq("obra_id", data.obraId)
            .gte("data", data.dataInicial)
            .lte("data", data.dataFinal)
            .order("id")
            .range(from, to) as never,
      ),
      buscarTodasPaginas<CustoVigenciaRow>(
        (from, to) =>
          supabaseAdmin
            .from("funcionario_custos_vigencias" as never)
            .select(
              "funcionario_id,vigencia_inicio,vigencia_fim,categoria_mo,custo_mensal_total,status_historico" as never,
            )
            .lte("vigencia_inicio" as never, data.dataFinal as never)
            .or(`vigencia_fim.is.null,vigencia_fim.gte.${data.dataInicial}` as never)
            .order("funcionario_id" as never)
            .order("vigencia_inicio" as never)
            .range(from, to) as never,
      ),
      buscarTodasPaginas<RegimeVigenciaRow>(
        (from, to) =>
          supabaseAdmin
            .from("funcionario_regime_vigencias" as never)
            .select("funcionario_id,regime,vigencia_inicio,vigencia_fim" as never)
            .lte("vigencia_inicio" as never, data.dataFinal as never)
            .or(`vigencia_fim.is.null,vigencia_fim.gte.${data.dataInicial}` as never)
            .order("funcionario_id" as never)
            .order("vigencia_inicio" as never)
            .range(from, to) as never,
      ),
      (async () => {
        const result = await supabaseAdmin.rpc(
          "obras_control_alocacoes_referencia_regime" as never,
          { p_inicio: data.dataInicial, p_fim: data.dataFinal } as never,
        );
        if (result.error) throw new Error(result.error.message);
        return (result.data ?? []) as unknown as AlocacaoReferenciaRow[];
      })(),
      buscarTodasPaginas<{ nome: string; tipo: TipoMO }>(
        (from, to) =>
          supabaseAdmin
            .from("categorias")
            .select("nome,tipo")
            .order("nome")
            .range(from, to) as never,
      ),
    ]);
    const vigencias: CustoVigencia[] = vigenciasRows.map((v) => ({
      funcionarioId: v.funcionario_id,
      vigenciaInicio: v.vigencia_inicio,
      vigenciaFim: v.vigencia_fim,
      categoriaMo: v.categoria_mo,
      custoMensalTotal: Number(v.custo_mensal_total),
      statusHistorico: v.status_historico,
    }));
    const regimes: RegimeVigencia[] = regimeRows.map((v) => ({
      funcionarioId: v.funcionario_id,
      regime: v.regime,
      vigenciaInicio: v.vigencia_inicio,
      vigenciaFim: v.vigencia_fim,
    }));
    const tipoMap = new Map(categorias.map((c) => [c.nome, c.tipo]));
    const funcMap = new Map(
      funcionarios
        .filter((f) => !f.deleted_at && f.visivel_obras_control !== false)
        .map((f) => [f.id, f]),
    );
    const diasUteis = diasUteisNoIntervalo(inicio, fim);
    type Acum = {
      funcao: string;
      tipo: TipoMO;
      hhPrevisto: number;
      hhRealizado: number;
      horasAusencia: number;
      custoPrevisto: number;
      custoRealizado: number;
      custos: Record<string, number>;
      ausencias: Record<string, number>;
      semMapeamento: boolean;
      funcoesOrcamento: string[];
    };
    const linhas = new Map<string, Acum>();
    const diasTrabalhados: DiaTrabalhado[] = [];
    for (const item of itens) {
      const chave = item.categoria_mo_mapeada ?? `orcamento:${item.id}`;
      const tipoEfetivo = item.categoria_mo_mapeada
        ? (tipoMap.get(item.categoria_mo_mapeada) ?? item.tipo_mo)
        : item.tipo_mo;
      const l = linhas.get(chave) ?? {
        funcao: item.categoria_mo_mapeada ?? item.funcao_orcamento,
        tipo: tipoEfetivo,
        hhPrevisto: 0,
        hhRealizado: 0,
        horasAusencia: 0,
        custoPrevisto: 0,
        custoRealizado: 0,
        custos: {},
        ausencias: {},
        semMapeamento: !item.categoria_mo_mapeada,
        funcoesOrcamento: [],
      };
      l.hhPrevisto += Number(item.hh_previsto);
      l.custoPrevisto += Number(item.custo_previsto);
      if (!l.funcoesOrcamento.includes(item.funcao_orcamento))
        l.funcoesOrcamento.push(item.funcao_orcamento);
      linhas.set(chave, l);
    }
    for (const registro of registros) {
      const f = funcMap.get(registro.funcionario_id);
      if (!f) continue;
      const vigencia = vigenciaNaData(vigencias, f.id, registro.data);
      const categoria = vigencia?.categoriaMo ?? "Nao mapeado";
      const tipo = tipoMap.get(categoria) ?? "MOD";
      const l = linhas.get(categoria) ?? {
        funcao: categoria,
        tipo,
        hhPrevisto: 0,
        hhRealizado: 0,
        horasAusencia: 0,
        custoPrevisto: 0,
        custoRealizado: 0,
        custos: {},
        ausencias: {},
        semMapeamento: true,
        funcoesOrcamento: [],
      };
      const classif = classificarRegistroGerencial(registro);
      l.hhRealizado += classif.hhRealizado;
      l.horasAusencia += classif.horasAusencia;
      if (classif.tipoAusencia)
        l.ausencias[classif.tipoAusencia] =
          (l.ausencias[classif.tipoAusencia] ?? 0) + classif.horasAusencia;
      if (acesso.financeiro && vigencia) {
        const custo = custoRegistroNaVigencia({ vigencia, diasUteis, registro });
        const chaveCusto =
          registro.tipo_registro === "horas"
            ? "horas_trabalhadas"
            : (classif.tipoAusencia as TipoAusencia);
        l.custoRealizado += custo;
        l.custos[chaveCusto] = (l.custos[chaveCusto] ?? 0) + custo;
      }
      if (
        acesso.financeiro &&
        registro.tipo_registro === "horas" &&
        Number(registro.horas_normais || 0) + Number(registro.horas_extras || 0) > 0
      )
        diasTrabalhados.push({
          funcionarioId: registro.funcionario_id,
          obraId: data.obraId,
          data: registro.data,
        });
      linhas.set(categoria, l);
    }
    let existeRegimeNaoInformado = false;
    let existeAlojadoSemCc = false;
    if (acesso.financeiro) {
      const apuracaoRegime = apurarCustosRegime({
        vigencias: regimes,
        alocacoes: alocacoesReferencia.map((alocacao) => ({
          funcionarioId: alocacao.funcionario_id,
          obraId: alocacao.obra_id,
          data: alocacao.data,
        })),
        diasTrabalhados,
        inicio: data.dataInicial,
        fim: data.dataFinal,
        funcionarioElegivelNaData: (funcionarioId, dia) => {
          const funcionario = funcMap.get(funcionarioId);
          return Boolean(
            funcionario &&
            (!funcionario.data_admissao || funcionario.data_admissao <= dia) &&
            (!funcionario.data_desligamento || funcionario.data_desligamento >= dia),
          );
        },
      });
      existeRegimeNaoInformado = apuracaoRegime.existeRegimeNaoInformado;
      existeAlojadoSemCc = apuracaoRegime.existeAlojadoSemCc;
      for (const lancamento of apuracaoRegime.lancamentos) {
        if (lancamento.obraId !== data.obraId) continue;
        const vigencia = vigenciaNaData(vigencias, lancamento.funcionarioId, lancamento.data);
        const categoria = vigencia?.categoriaMo ?? "Nao mapeado";
        const linha = linhas.get(categoria) ?? {
          funcao: categoria,
          tipo: tipoMap.get(categoria) ?? "MOD",
          hhPrevisto: 0,
          hhRealizado: 0,
          horasAusencia: 0,
          custoPrevisto: 0,
          custoRealizado: 0,
          custos: {},
          ausencias: {},
          semMapeamento: true,
          funcoesOrcamento: [],
        };
        const chaveCusto = lancamento.regime === "local" ? "regime_local" : "regime_alojado";
        linha.custoRealizado += lancamento.valor;
        linha.custos[chaveCusto] = (linha.custos[chaveCusto] ?? 0) + lancamento.valor;
        linhas.set(categoria, linha);
      }
    }
    const dtoLinhas = [...linhas.values()].map((l) => ({
      funcao: l.funcao,
      tipo: l.tipo,
      hhPrevisto: l.hhPrevisto,
      hhRealizado: l.hhRealizado,
      horasAusencia: l.horasAusencia,
      ...indicadores(l.hhPrevisto, l.hhRealizado),
      semMapeamento: l.semMapeamento,
      funcoesOrcamento: l.funcoesOrcamento,
      ausencias: l.ausencias,
      ...(acesso.financeiro
        ? {
            custoPrevisto: l.custoPrevisto,
            custoRealizado: l.custoRealizado,
            saldoCusto: l.custoPrevisto - l.custoRealizado,
            percentualCusto: indicadores(l.custoPrevisto, l.custoRealizado).percentual,
            composicaoCusto: l.custos,
          }
        : {}),
    }));
    const soma = (
      campo: "hhPrevisto" | "hhRealizado" | "horasAusencia" | "custoPrevisto" | "custoRealizado",
    ) => [...linhas.values()].reduce((s, l) => s + l[campo], 0);
    const hp = soma("hhPrevisto"),
      hr = soma("hhRealizado"),
      cp = soma("custoPrevisto"),
      cr = soma("custoRealizado");
    return {
      acessoFinanceiro: acesso.financeiro,
      baseline,
      linhas: dtoLinhas,
      totais: {
        hhPrevisto: hp,
        hhRealizado: hr,
        horasAusencia: soma("horasAusencia"),
        saldoHH: hp - hr,
        percentualHH: indicadores(hp, hr).percentual,
        ...(acesso.financeiro
          ? {
              custoPrevisto: cp,
              custoRealizado: cr,
              saldoCusto: cp - cr,
              percentualCusto: indicadores(cp, cr).percentual,
            }
          : {}),
      },
      alertas: [
        ...dtoLinhas
          .filter((l) => l.semMapeamento)
          .map((l) => `Funcao sem mapeamento: ${l.funcao}`),
        ...(acesso.financeiro &&
        registros.some(
          (r) =>
            vigenciaNaData(vigencias, r.funcionario_id, r.data)?.statusHistorico ===
            "estimado_inicial",
        )
          ? ["Parte do custo historico utiliza a base financeira disponivel na implantacao."]
          : []),
        ...(acesso.financeiro &&
        registros.some((r) => !vigenciaNaData(vigencias, r.funcionario_id, r.data))
          ? ["Existem apontamentos sem vigencia financeira reconciliada."]
          : []),
        ...(existeRegimeNaoInformado
          ? ["Regime nao informado para funcionario com dia trabalhado no periodo."]
          : []),
        ...(existeAlojadoSemCc ? ["Alojado sem CC de referência."] : []),
      ],
      periodo: { inicio: isoLocal(inicio), fim: isoLocal(fim) },
    };
  });

export const previewPlanejamentoHH = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        arquivoBase64: z.string().min(1),
        nomeArquivo: z.string().regex(/\.(xlsx|xlsm)$/i),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    if (!(await permissoes(context.userId)).financeiro) throw new Error("Forbidden");
    const { parseOrcamentoBuffer } = await import("@/lib/planejamento-hh-parser");
    return parseOrcamentoBuffer(Buffer.from(data.arquivoBase64, "base64"));
  });

export const salvarPlanejamentoHH = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        baselineId: z.string().uuid().nullable().optional(),
        obraId: z.string().uuid(),
        nome: z.string().min(1),
        versao: z.number().int().positive(),
        nomeArquivo: z.string().min(1),
        abas: z.array(z.string()),
        pendencias: z.array(z.string()),
        avisos: z.array(z.string()),
        resolucoesComposicoes: z.array(resolucaoComposicaoSchema),
        itens: z.array(itemImportadoSchema).min(1),
        mapeamentos: z.array(
          z.object({
            funcaoOrcamento: z.string(),
            categoriaMo: z.string().nullable(),
            tipoMo: z.enum(["MOI", "MOD"]),
          }),
        ),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    if (!(await permissoes(context.userId)).financeiro) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const categoriasRes = await supabaseAdmin.from("categorias").select("nome,tipo");
    if (categoriasRes.error) throw new Error(categoriasRes.error.message);
    const tiposCategorias = new Map(
      (categoriasRes.data ?? []).map((c) => [c.nome, c.tipo as TipoMO]),
    );
    const mapeamentosEfetivos = data.mapeamentos.map((m) => ({
      ...m,
      tipoOrigem: m.tipoMo,
      tipoMo: tipoEfetivoMapeamento(m.tipoMo, m.categoriaMo, tiposCategorias),
    }));
    const conflitos = conflitosCategoriaEntreTipos(mapeamentosEfetivos);
    const codigosPendentes = new Set(composicoesNaoReconciliadas(data.pendencias));
    if (data.resolucoesComposicoes.some((item) => !codigosPendentes.has(item.codigoComposicao)))
      throw new Error("Composição informada não corresponde a uma pendência desta importação.");
    const confirmados = mapeamentosEfetivos
      .filter((m) => m.categoriaMo)
      .map((m) => ({
        funcao_orcamento_normalizada: normalizarFuncaoOrcamento(m.funcaoOrcamento),
        funcao_orcamento_original: m.funcaoOrcamento,
        categoria_mo: m.categoriaMo!,
        tipo_mo: m.tipoMo,
        confirmado_por: context.userId,
        confirmado_em: new Date().toISOString(),
      }));
    if (confirmados.length) {
      const mappingRes = await supabaseAdmin
        .from("planejamento_hh_mapeamentos" as never)
        .upsert(
          confirmados as never,
          { onConflict: "funcao_orcamento_normalizada,categoria_mo,tipo_mo" } as never,
        );
      if (mappingRes.error) throw new Error(mappingRes.error.message);
    }
    let baselineId = data.baselineId ?? null;
    let resolucoesExistentes: ResolucaoComposicao[] = [];
    if (baselineId) {
      const existente = await supabaseAdmin
        .from("planejamento_hh_baselines" as never)
        .select("id,status,obra_id" as never)
        .eq("id" as never, baselineId as never)
        .maybeSingle();
      const atual = existente.data as unknown as {
        id: string;
        status: string;
        obra_id: string;
      } | null;
      if (existente.error) throw new Error(existente.error.message);
      if (!atual || atual.obra_id !== data.obraId || atual.status !== "rascunho")
        throw new Error("Somente um rascunho da mesma obra pode ser atualizado.");
      const controleRes = await supabaseAdmin
        .from("planejamento_hh_baseline_itens" as never)
        .select("metadata_calculo" as never)
        .eq("baseline_id" as never, baselineId as never)
        .order("criado_em" as never)
        .limit(1)
        .maybeSingle();
      if (controleRes.error) throw new Error(controleRes.error.message);
      const metadataExistente = controleRes.data as unknown as {
        metadata_calculo?: { planejamento_hh?: { resolucoes_composicoes?: ResolucaoComposicao[] } };
      } | null;
      resolucoesExistentes =
        metadataExistente?.metadata_calculo?.planejamento_hh?.resolucoes_composicoes ?? [];
      const updateRes = await supabaseAdmin
        .from("planejamento_hh_baselines" as never)
        .update({
          nome: data.nome,
          versao: data.versao,
          arquivo_origem: data.nomeArquivo,
        } as never)
        .eq("id" as never, baselineId as never);
      if (updateRes.error) throw new Error(updateRes.error.message);
    } else {
      const baselineRes = await supabaseAdmin
        .from("planejamento_hh_baselines" as never)
        .insert({
          obra_id: data.obraId,
          nome: data.nome,
          versao: data.versao,
          arquivo_origem: data.nomeArquivo,
          criado_por: context.userId,
          status: "rascunho",
          ativa: false,
        } as never)
        .select("id" as never)
        .single();
      if (baselineRes.error) throw new Error(baselineRes.error.message);
      baselineId = (baselineRes.data as unknown as { id: string }).id;
    }
    const resolucoesAnteriores = new Map(
      resolucoesExistentes.map((item) => [item.codigoComposicao, item]),
    );
    const resolucoesAuditadas: ResolucaoComposicao[] = data.resolucoesComposicoes.map((item) => {
      const anterior = resolucoesAnteriores.get(item.codigoComposicao);
      return anterior?.resolucao === item.resolucao
        ? anterior
        : {
            ...item,
            resolvidoPor: context.userId,
            resolvidoEm: new Date().toISOString(),
          };
    });
    const mapa = new Map(
      mapeamentosEfetivos.map((m) => [
        `${normalizarFuncaoOrcamento(m.funcaoOrcamento)}|${m.tipoOrigem}`,
        { categoriaMo: m.categoriaMo, tipoEfetivo: m.tipoMo },
      ]),
    );
    const rows = data.itens.map((i, index) => {
      const mapeamento = mapa.get(`${normalizarFuncaoOrcamento(i.funcaoOrcamento)}|${i.tipoMo}`);
      return {
        baseline_id: baselineId,
        funcao_orcamento: i.funcaoOrcamento,
        funcao_orcamento_normalizada: normalizarFuncaoOrcamento(i.funcaoOrcamento),
        categoria_mo_mapeada: mapeamento?.categoriaMo ?? null,
        tipo_mo: mapeamento?.tipoEfetivo ?? i.tipoMo,
        hh_previsto: i.hhPrevisto,
        custo_previsto: i.custoPrevisto,
        origem: i.origem,
        metadata_calculo: {
          ...i.metadataCalculo,
          tipo_mo_origem: i.tipoMo,
          ...(index === 0
            ? {
                planejamento_hh: {
                  abas: data.abas,
                  pendencias: data.pendencias,
                  avisos: data.avisos,
                  conflitos,
                  resolucoes_composicoes: resolucoesAuditadas,
                },
              }
            : {}),
        },
      };
    });
    const itemsRes = await supabaseAdmin
      .from("planejamento_hh_baseline_itens" as never)
      .upsert(
        rows as never,
        { onConflict: "baseline_id,funcao_orcamento_normalizada,tipo_mo" } as never,
      )
      .select("id" as never);
    if (itemsRes.error) {
      if (!data.baselineId)
        await supabaseAdmin
          .from("planejamento_hh_baselines" as never)
          .delete()
          .eq("id" as never, baselineId as never);
      throw new Error(itemsRes.error.message);
    }
    const idsMantidos = (itemsRes.data as unknown as Array<{ id: string }>).map((item) => item.id);
    if (idsMantidos.length) {
      const limparRes = await supabaseAdmin
        .from("planejamento_hh_baseline_itens" as never)
        .delete()
        .eq("baseline_id" as never, baselineId as never)
        .not("id" as never, "in" as never, `(${idsMantidos.join(",")})` as never);
      if (limparRes.error) throw new Error(limparRes.error.message);
    }
    return { baselineId, status: "rascunho" as const };
  });

export const getRascunhoPlanejamentoHH = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ obraId: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    if (!(await permissoes(context.userId)).financeiro) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const baselineRes = await supabaseAdmin
      .from("planejamento_hh_baselines" as never)
      .select("id,nome,versao,arquivo_origem,status,criado_em" as never)
      .eq("obra_id" as never, data.obraId as never)
      .eq("status" as never, "rascunho" as never)
      .order("criado_em" as never, { ascending: false })
      .limit(1)
      .maybeSingle();
    if (baselineRes.error) throw new Error(baselineRes.error.message);
    const baseline = baselineRes.data as unknown as {
      id: string;
      nome: string;
      versao: number;
      arquivo_origem: string;
    } | null;
    if (!baseline) return null;
    const itensRes = await supabaseAdmin
      .from("planejamento_hh_baseline_itens" as never)
      .select(
        "funcao_orcamento,categoria_mo_mapeada,tipo_mo,hh_previsto,custo_previsto,origem,metadata_calculo" as never,
      )
      .eq("baseline_id" as never, baseline.id as never)
      .order("criado_em" as never);
    if (itensRes.error) throw new Error(itensRes.error.message);
    const itens = (itensRes.data ?? []) as unknown as Array<{
      funcao_orcamento: string;
      categoria_mo_mapeada: string | null;
      tipo_mo: TipoMO;
      hh_previsto: number;
      custo_previsto: number;
      origem: "MO" | "EAP/CPUs";
      metadata_calculo: Record<string, unknown>;
    }>;
    const controle = itens.find((item) => item.metadata_calculo?.planejamento_hh)?.metadata_calculo
      ?.planejamento_hh as
      | {
          abas?: string[];
          pendencias?: string[];
          avisos?: string[];
          resolucoes_composicoes?: ResolucaoComposicao[];
        }
      | undefined;
    return {
      baselineId: baseline.id,
      nome: baseline.nome,
      versao: baseline.versao,
      nomeArquivo: baseline.arquivo_origem,
      previa: {
        abas: controle?.abas ?? [],
        erros: controle?.pendencias ?? [],
        avisos: controle?.avisos ?? [],
        resolucoesComposicoes: controle?.resolucoes_composicoes ?? [],
        itens: itens.map((i) => {
          const {
            planejamento_hh: _controle,
            tipo_mo_origem: tipoOrigem,
            ...metadataPersistida
          } = i.metadata_calculo;
          const metadataCalculo = Object.fromEntries(
            Object.entries(metadataPersistida).filter(
              ([, valor]) =>
                valor == null ||
                typeof valor === "string" ||
                typeof valor === "number" ||
                typeof valor === "boolean",
            ),
          ) as Record<string, string | number | boolean | null>;
          return {
            funcaoOrcamento: i.funcao_orcamento,
            tipoMo: (tipoOrigem as TipoMO | undefined) ?? i.tipo_mo,
            tipoEfetivo: i.tipo_mo,
            categoriaMo: i.categoria_mo_mapeada,
            hhPrevisto: Number(i.hh_previsto),
            custoPrevisto: Number(i.custo_previsto),
            origem: i.origem,
            metadataCalculo,
          };
        }),
      },
    };
  });

export const ativarPlanejamentoHH = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ baselineId: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    if (!(await permissoes(context.userId)).financeiro) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const baselineRes = await supabaseAdmin
      .from("planejamento_hh_baselines" as never)
      .select("id,status,ativa" as never)
      .eq("id" as never, data.baselineId as never)
      .maybeSingle();
    if (baselineRes.error) throw new Error(baselineRes.error.message);
    const baseline = baselineRes.data as unknown as {
      id: string;
      status: string;
      ativa: boolean;
    } | null;
    if (!baseline || baseline.status !== "rascunho" || baseline.ativa)
      throw new Error("Somente uma baseline em rascunho pode ser ativada.");
    const itensRes = await supabaseAdmin
      .from("planejamento_hh_baseline_itens" as never)
      .select("funcao_orcamento,categoria_mo_mapeada,tipo_mo,metadata_calculo" as never)
      .eq("baseline_id" as never, data.baselineId as never);
    if (itensRes.error) throw new Error(itensRes.error.message);
    const itens = (itensRes.data ?? []) as unknown as Array<{
      funcao_orcamento: string;
      categoria_mo_mapeada: string | null;
      tipo_mo: TipoMO;
      metadata_calculo: Record<string, unknown>;
    }>;
    if (!itens.length) throw new Error("Baseline sem itens não pode ser ativada.");
    const controle = itens.find((item) => item.metadata_calculo?.planejamento_hh)?.metadata_calculo
      ?.planejamento_hh as
      | {
          pendencias?: string[];
          conflitos?: string[];
          resolucoes_composicoes?: ResolucaoComposicao[];
        }
      | undefined;
    const pendencias = pendenciasAtivacaoBaseline(
      [...(controle?.pendencias ?? []), ...(controle?.conflitos ?? [])],
      itens.map((i) => ({
        funcaoOrcamento: i.funcao_orcamento,
        categoriaMo: i.categoria_mo_mapeada,
        tipoMo: i.tipo_mo,
      })),
      controle?.resolucoes_composicoes ?? [],
    );
    if (pendencias.length) throw new Error(pendencias.join(" "));
    const categoriasRes = await supabaseAdmin.from("categorias").select("nome,tipo");
    if (categoriasRes.error) throw new Error(categoriasRes.error.message);
    const tiposCategorias = new Map(
      (categoriasRes.data ?? []).map((categoria) => [categoria.nome, categoria.tipo as TipoMO]),
    );
    const classificacoesDesatualizadas = itens.filter(
      (item) =>
        item.categoria_mo_mapeada &&
        tiposCategorias.get(item.categoria_mo_mapeada) !== item.tipo_mo,
    );
    if (classificacoesDesatualizadas.length)
      throw new Error(
        "A classificação oficial de uma categoria mudou. Salve o rascunho novamente.",
      );
    const conflitos = conflitosCategoriaEntreTipos(
      itens.map((i) => ({
        funcaoOrcamento: i.funcao_orcamento,
        categoriaMo: i.categoria_mo_mapeada,
        tipoMo: i.tipo_mo,
      })),
    );
    if (conflitos.length)
      throw new Error(`Conflito de classificação efetiva: ${conflitos.join(", ")}.`);
    const { error } = await context.supabase.rpc(
      "ativar_planejamento_hh_baseline" as never,
      { p_baseline_id: data.baselineId } as never,
    );
    if (error) throw new Error(error.message);
    return { baselineId: data.baselineId, status: "ativa" as const };
  });
