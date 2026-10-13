-- Fonte diária histórica para o relatório operacional "Alocação por Centro de Custo".
-- Não cria tabela, view ou índice e não altera as regras de jornada existentes.
CREATE OR REPLACE FUNCTION public.relatorio_alocacao_centro_custo(
  p_competencia date,
  p_funcionario_id uuid DEFAULT NULL,
  p_obra_id uuid DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_somente_pendencias boolean DEFAULT false
)
RETURNS TABLE (
  competencia text,
  periodo_inicio date,
  periodo_fim date,
  funcionario_id uuid,
  funcionario_nome text,
  categoria text,
  data date,
  data_inicio date,
  data_saida date,
  hora_entrada time,
  hora_saida time,
  situacao text,
  tipo_registro text,
  falta_tipo text,
  obra_id uuid,
  obra_nome text,
  minutos_normais numeric,
  minutos_he_50 numeric,
  minutos_he_100 numeric,
  minutos_sem_adicional_he numeric,
  minutos_noturnos numeric,
  observacoes text,
  possui_inconsistencia boolean,
  tipo_inconsistencia text,
  origem_horas text,
  dia_esperado boolean,
  dias_esperados_funcionario integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usuario uuid := auth.uid();
  v_competencia text;
  v_inicio date;
  v_fim date;
  v_referencia date;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Sessao expirada.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_usuario
      AND ur.role::text IN ('assistente', 'supervisor', 'coordenador', 'gerente', 'diretor')
  ) THEN
    RAISE EXCEPTION 'Forbidden: relatorio indisponivel para este perfil' USING ERRCODE = '42501';
  END IF;
  IF p_competencia IS NULL OR extract(day FROM p_competencia)::integer <> 1 THEN
    RAISE EXCEPTION 'p_competencia deve ser o primeiro dia do mes' USING ERRCODE = '22007';
  END IF;

  SELECT c.competencia, c.data_inicio, c.data_fim
    INTO v_competencia, v_inicio, v_fim
  FROM public.competencia_25_24(p_competencia) c;
  -- Mesma visão "Para tratar" do relatório Sem alocação: um dia completo de tolerância.
  v_referencia := least(v_fim, current_date - 2);

  RETURN QUERY
  WITH funcionarios_periodo AS (
    SELECT DISTINCT x.funcionario_id
    FROM (
      SELECT a.funcionario_id, a.obra_id FROM public.alocacoes a
      WHERE a.data BETWEEN v_inicio AND v_fim
      UNION ALL
      SELECT rh.funcionario_id, rh.obra_id FROM public.registros_horas rh
      WHERE rh.data BETWEEN v_inicio AND v_fim
    ) x
    JOIN public.funcionarios f ON f.id = x.funcionario_id
    WHERE (p_funcionario_id IS NULL OR x.funcionario_id = p_funcionario_id)
      AND (p_categoria IS NULL OR f.categoria_mo = p_categoria)
      AND (p_obra_id IS NULL OR x.obra_id = p_obra_id)
  ), funcionarios_base AS (
    SELECT f.id, f.nome, f.categoria_mo,
      greatest(v_inicio, coalesce(f.data_admissao, v_inicio)) AS inicio_esperado,
      least(v_referencia, coalesce(f.data_desligamento, v_referencia)) AS fim_esperado
    FROM funcionarios_periodo fp
    JOIN public.funcionarios f ON f.id = fp.funcionario_id
  ), dias_esperados AS (
    SELECT fb.id AS funcionario_id, gs.d::date AS data
    FROM funcionarios_base fb
    CROSS JOIN LATERAL generate_series(fb.inicio_esperado, fb.fim_esperado, interval '1 day') gs(d)
    WHERE fb.inicio_esperado <= fb.fim_esperado
      AND extract(isodow FROM gs.d) BETWEEN 1 AND 5
      AND NOT EXISTS (
        SELECT 1 FROM public.feriados_obras_control fo
        WHERE fo.data = gs.d::date AND fo.ativo = true
      )
  ), dias_movimento AS (
    SELECT a.funcionario_id, a.data FROM public.alocacoes a
    JOIN funcionarios_periodo fp ON fp.funcionario_id = a.funcionario_id
    WHERE a.data BETWEEN v_inicio AND v_fim
    UNION
    SELECT rh.funcionario_id, rh.data FROM public.registros_horas rh
    JOIN funcionarios_periodo fp ON fp.funcionario_id = rh.funcionario_id
    WHERE rh.data BETWEEN v_inicio AND v_fim
  ), dias AS (
    SELECT de.funcionario_id, de.data FROM dias_esperados de
    UNION
    SELECT dm.funcionario_id, dm.data FROM dias_movimento dm
  ), esperados_contagem AS (
    SELECT de.funcionario_id, count(DISTINCT de.data)::integer AS quantidade
    FROM dias_esperados de GROUP BY de.funcionario_id
  ), registros_dia AS (
    SELECT rh.funcionario_id, rh.data,
      count(*)::integer AS quantidade,
      bool_or(rh.tipo_registro <> 'horas') AS possui_ausencia,
      string_agg(DISTINCT rh.tipo_registro, ', ' ORDER BY rh.tipo_registro) AS tipos,
      string_agg(DISTINCT rh.falta_tipo, ', ' ORDER BY rh.falta_tipo)
        FILTER (WHERE rh.falta_tipo IS NOT NULL) AS faltas,
      string_agg(DISTINCT nullif(btrim(rh.observacoes), ''), '; ')
        FILTER (WHERE nullif(btrim(rh.observacoes), '') IS NOT NULL) AS observacoes,
      count(*) FILTER (WHERE rh.tipo_registro = 'horas')::integer AS registros_horas,
      count(rd.registro_horas_id)::integer AS detalhes,
      bool_or(rd.registro_horas_id IS NOT NULL AND (
        a_detalhe.id IS NULL OR
        rh.funcionario_id IS DISTINCT FROM a_detalhe.funcionario_id OR
        rh.obra_id IS DISTINCT FROM a_detalhe.obra_id OR
        rh.data IS DISTINCT FROM a_detalhe.data OR
        rd.data_inicio IS DISTINCT FROM a_detalhe.data
      )) AS detalhe_divergente,
      bool_or(
        rh.tipo_registro = 'horas'
        AND coalesce(a_detalhe.id, a_dia.id) IS NULL
      ) AS horas_sem_alocacao,
      bool_or(
        rh.tipo_registro = 'horas'
        AND coalesce(a_detalhe.id, a_dia.id) IS NOT NULL
        AND rh.obra_id IS DISTINCT FROM coalesce(a_detalhe.obra_id, a_dia.obra_id)
      ) AS obra_divergente,
      bool_or(
        rh.tipo_registro <> 'horas'
        AND coalesce(a_detalhe.id, a_dia.id) IS NOT NULL
      ) AS ausencia_com_alocacao,
      min(rd.data_inicio) AS data_inicio,
      max(rd.data_saida) AS data_saida,
      min(rd.hora_entrada) AS hora_entrada,
      max(rd.hora_saida) AS hora_saida,
      sum(CASE WHEN rh.tipo_registro <> 'horas' THEN 0
        WHEN rd.registro_horas_id IS NOT NULL THEN rd.minutos_normais
        WHEN extract(isodow FROM rh.data) IN (6, 7) OR EXISTS (
          SELECT 1 FROM public.feriados_obras_control fo WHERE fo.data = rh.data AND fo.ativo = true
        ) THEN 0 ELSE rh.horas_normais * 60 END)::numeric AS minutos_normais,
      sum(CASE WHEN rh.tipo_registro <> 'horas' THEN 0
        WHEN rd.registro_horas_id IS NOT NULL THEN rd.minutos_he_50
        WHEN extract(isodow FROM rh.data) = 6 THEN (rh.horas_normais + rh.horas_extras) * 60
        WHEN extract(isodow FROM rh.data) = 7 OR EXISTS (
          SELECT 1 FROM public.feriados_obras_control fo WHERE fo.data = rh.data AND fo.ativo = true
        ) THEN 0 ELSE rh.horas_extras * 60 END)::numeric AS minutos_he_50,
      sum(CASE WHEN rh.tipo_registro <> 'horas' THEN 0
        WHEN rd.registro_horas_id IS NOT NULL THEN rd.minutos_he_100
        WHEN extract(isodow FROM rh.data) = 7 OR EXISTS (
          SELECT 1 FROM public.feriados_obras_control fo WHERE fo.data = rh.data AND fo.ativo = true
        ) THEN (rh.horas_normais + rh.horas_extras) * 60 ELSE 0 END)::numeric AS minutos_he_100,
      sum(CASE WHEN rh.tipo_registro = 'horas' THEN coalesce(rd.minutos_sem_adicional_he, 0) ELSE 0 END)::numeric
        AS minutos_sem_adicional_he,
      sum(CASE WHEN rh.tipo_registro = 'horas' THEN coalesce(rd.minutos_noturnos_reais, 0) ELSE 0 END)::numeric
        AS minutos_noturnos,
      CASE WHEN count(*) FILTER (WHERE rh.tipo_registro = 'horas') = 0 THEN 'sem_horas'
        WHEN count(rd.registro_horas_id) = count(*) FILTER (WHERE rh.tipo_registro = 'horas') THEN 'detalhe'
        ELSE 'legado' END AS origem_horas
    FROM public.registros_horas rh
    JOIN funcionarios_periodo fp ON fp.funcionario_id = rh.funcionario_id
    LEFT JOIN public.registros_horas_detalhes rd ON rd.registro_horas_id = rh.id
    LEFT JOIN public.alocacoes a_detalhe ON a_detalhe.id = rd.alocacao_id
    -- O fallback diario atende somente registros sem vinculo moderno. Um detalhe
    -- inconsistente permanece visivel e jamais e mascarado por outra alocacao.
    LEFT JOIN public.alocacoes a_dia
      ON rd.alocacao_id IS NULL
     AND a_dia.funcionario_id = rh.funcionario_id
     AND a_dia.data = rh.data
    WHERE rh.data BETWEEN v_inicio AND v_fim
    GROUP BY rh.funcionario_id, rh.data
  ), fonte AS (
    SELECT
      v_competencia AS competencia,
      v_inicio AS periodo_inicio,
      v_fim AS periodo_fim,
      fb.id AS funcionario_id,
      fb.nome AS funcionario_nome,
      fb.categoria_mo AS categoria,
      d.data,
      rd.data_inicio,
      rd.data_saida,
      rd.hora_entrada,
      rd.hora_saida,
      CASE
        WHEN coalesce(rd.possui_ausencia, false) THEN 'ausencia'
        WHEN a.id IS NOT NULL THEN 'alocado'
        WHEN coalesce(rd.registros_horas, 0) > 0 THEN 'inconsistencia'
        ELSE 'sem_alocacao'
      END AS situacao,
      CASE WHEN coalesce(rd.possui_ausencia, false) THEN rd.tipos
        WHEN coalesce(rd.registros_horas, 0) > 0 THEN 'horas' ELSE NULL END AS tipo_registro,
      rd.faltas AS falta_tipo,
      CASE WHEN coalesce(rd.possui_ausencia, false) THEN NULL ELSE a.obra_id END AS obra_id,
      CASE WHEN coalesce(rd.possui_ausencia, false) THEN NULL ELSE o.nome END AS obra_nome,
      coalesce(rd.minutos_normais, 0) AS minutos_normais,
      coalesce(rd.minutos_he_50, 0) AS minutos_he_50,
      coalesce(rd.minutos_he_100, 0) AS minutos_he_100,
      coalesce(rd.minutos_sem_adicional_he, 0) AS minutos_sem_adicional_he,
      coalesce(rd.minutos_noturnos, 0) AS minutos_noturnos,
      rd.observacoes,
      (
        (a.id IS NOT NULL AND rd.funcionario_id IS NULL) OR
        coalesce(rd.horas_sem_alocacao, false) OR
        coalesce(rd.obra_divergente, false) OR
        coalesce(rd.detalhe_divergente, false) OR
        coalesce(rd.ausencia_com_alocacao, false) OR
        coalesce(rd.quantidade, 0) > 1 OR
        (coalesce(rd.registros_horas, 0) > 0 AND rd.origem_horas = 'legado')
      ) AS possui_inconsistencia,
      concat_ws('; ',
        CASE WHEN a.id IS NOT NULL AND rd.funcionario_id IS NULL THEN 'ALOCACAO_SEM_REGISTRO_HORAS' END,
        CASE WHEN coalesce(rd.horas_sem_alocacao, false) THEN 'HORAS_SEM_ALOCACAO' END,
        CASE WHEN coalesce(rd.obra_divergente, false) THEN 'OBRA_DIVERGENTE' END,
        CASE WHEN coalesce(rd.detalhe_divergente, false) THEN 'VINCULO_DETALHE_DIVERGENTE' END,
        CASE WHEN coalesce(rd.ausencia_com_alocacao, false) THEN 'AUSENCIA_COM_ALOCACAO' END,
        CASE WHEN coalesce(rd.quantidade, 0) > 1 THEN 'MULTIPLOS_REGISTROS_NO_DIA' END,
        CASE WHEN coalesce(rd.registros_horas, 0) > 0 AND rd.origem_horas = 'legado' THEN 'HORAS_LEGADAS_SEM_DETALHE' END
      ) AS tipo_inconsistencia,
      coalesce(rd.origem_horas, 'sem_horas') AS origem_horas,
      (de.data IS NOT NULL) AS dia_esperado,
      coalesce(ec.quantidade, 0) AS dias_esperados_funcionario
    FROM dias d
    JOIN funcionarios_base fb ON fb.id = d.funcionario_id
    LEFT JOIN dias_esperados de ON de.funcionario_id = d.funcionario_id AND de.data = d.data
    LEFT JOIN esperados_contagem ec ON ec.funcionario_id = d.funcionario_id
    LEFT JOIN public.alocacoes a ON a.funcionario_id = d.funcionario_id AND a.data = d.data
    LEFT JOIN public.obras o ON o.id = a.obra_id
    LEFT JOIN registros_dia rd ON rd.funcionario_id = d.funcionario_id AND rd.data = d.data
    WHERE p_obra_id IS NULL OR a.obra_id = p_obra_id OR a.id IS NULL
  )
  SELECT f.competencia, f.periodo_inicio, f.periodo_fim, f.funcionario_id,
    f.funcionario_nome, f.categoria, f.data, f.data_inicio, f.data_saida,
    f.hora_entrada, f.hora_saida, f.situacao, f.tipo_registro, f.falta_tipo,
    f.obra_id, f.obra_nome, f.minutos_normais, f.minutos_he_50, f.minutos_he_100,
    f.minutos_sem_adicional_he, f.minutos_noturnos, f.observacoes,
    f.possui_inconsistencia, nullif(f.tipo_inconsistencia, ''), f.origem_horas,
    f.dia_esperado, f.dias_esperados_funcionario
  FROM fonte f
  WHERE NOT p_somente_pendencias
     OR f.possui_inconsistencia
     OR f.situacao IN ('ausencia', 'sem_alocacao', 'inconsistencia')
  ORDER BY f.funcionario_nome, f.data, f.obra_nome NULLS LAST;
END;
$function$;

REVOKE ALL ON FUNCTION public.relatorio_alocacao_centro_custo(date, uuid, uuid, text, boolean)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_alocacao_centro_custo(date, uuid, uuid, text, boolean)
TO authenticated;

COMMENT ON FUNCTION public.relatorio_alocacao_centro_custo(date, uuid, uuid, text, boolean) IS
  'Fonte diaria historica e sem valores financeiros do relatorio Alocacao por Centro de Custo.';
