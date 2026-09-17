-- Revisao obrigatoria antes de aplicar. Nao executada.
-- Bases: copiar_dia_anterior de 24/08; copiar_jornadas_v2 de 28/08.
CREATE OR REPLACE FUNCTION public.obras_copiar_dia_anterior(
  p_obra_id uuid,
  p_data_origem date,
  p_data_destino date,
  p_aplicar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_usuario uuid := auth.uid();
  v_origem uuid[] := ARRAY[]::uuid[];
  v_existentes uuid[] := ARRAY[]::uuid[];
  v_inelegiveis uuid[] := ARRAY[]::uuid[];
  v_suprimidos uuid[] := ARRAY[]::uuid[];
  v_nao_copiaveis uuid[] := ARRAY[]::uuid[];
  v_copiados uuid[] := ARRAY[]::uuid[];
  v_itens jsonb;
  v_funcionario_id uuid;
BEGIN
  IF v_usuario IS NULL OR public.get_user_level(v_usuario) < 1 THEN
    RAISE EXCEPTION 'Sem permissao para copiar alocacoes.' USING ERRCODE = '42501';
  END IF;
  IF p_data_origem >= p_data_destino THEN
    RAISE EXCEPTION 'A data de origem deve ser anterior a data de destino.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.obras WHERE id = p_obra_id) THEN
    RAISE EXCEPTION 'Centro de custo nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(array_agg(DISTINCT a.funcionario_id), ARRAY[]::uuid[])
    INTO v_origem
  FROM public.alocacoes a
  WHERE a.obra_id = p_obra_id AND a.data = p_data_origem;
  IF cardinality(v_origem) = 0 THEN
    RAISE EXCEPTION 'Nao ha alocacoes na origem informada.' USING ERRCODE = 'P0002';
  END IF;

  -- Mesmas chaves dos escritores oficiais: funcionario, depois funcionario|data.
  -- A ordenacao estabiliza a aquisicao em lotes.
  FOR v_funcionario_id IN SELECT unnest(v_origem) ORDER BY 1 LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_funcionario_id::text, 0));
  END LOOP;
  -- DELETE direto nao usa advisory lock. Locks de linha protegem a origem
  -- contra UPDATE/DELETE durante a revalidacao e a gravacao.
  PERFORM 1 FROM public.alocacoes a
  WHERE a.obra_id = p_obra_id AND a.data = p_data_origem
    AND a.funcionario_id = ANY(v_origem)
  ORDER BY a.funcionario_id, a.id FOR SHARE;
  PERFORM 1 FROM public.registros_horas r
  WHERE r.data = p_data_origem AND r.funcionario_id = ANY(v_origem)
  ORDER BY r.funcionario_id, r.id FOR SHARE;
  FOR v_funcionario_id IN SELECT unnest(v_origem) ORDER BY 1 LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_funcionario_id::text || '|' || p_data_origem::text, 0)
    );
  END LOOP;

  SELECT coalesce(array_agg(f.id), ARRAY[]::uuid[])
    INTO v_inelegiveis
  FROM public.obras_control_funcionarios_por_ids(v_origem) f
  LEFT JOIN public.obras_control_funcionarios_safe() s ON s.id = f.id
  WHERE s.id IS NULL OR f.deleted_at IS NOT NULL OR f.visivel_obras_control IS FALSE
    OR (s.data_admissao IS NOT NULL AND s.data_admissao > p_data_destino)
    OR (f.data_desligamento IS NOT NULL AND f.data_desligamento < p_data_destino);

  SELECT coalesce(array_agg(DISTINCT s.funcionario_id), ARRAY[]::uuid[])
    INTO v_existentes
  FROM (
    SELECT a.funcionario_id FROM public.alocacoes a
      WHERE a.data = p_data_destino AND a.funcionario_id = ANY(v_origem)
    UNION
    SELECT r.funcionario_id FROM public.registros_horas r
      WHERE r.data = p_data_destino AND r.funcionario_id = ANY(v_origem)
  ) s;

  -- A funcao devolve apenas o estado da previa da obra/data solicitada; snapshots
  -- continuam protegidos pela RLS da tabela de auditoria.
  SELECT coalesce(array_agg(DISTINCT e.funcionario_id), ARRAY[]::uuid[])
    INTO v_suprimidos
  FROM public.alocacoes_dia_exclusoes e
  WHERE e.data = p_data_destino
    AND e.funcionario_id = ANY(v_origem)
    AND e.ativa_para_copia = true;

  SELECT coalesce(array_agg(o.id), ARRAY[]::uuid[]) INTO v_nao_copiaveis
  FROM unnest(v_origem) AS o(id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.alocacoes a
    WHERE a.funcionario_id = o.id AND a.obra_id = p_obra_id
      AND a.data = p_data_origem
  ) OR (SELECT count(*) FROM public.registros_horas r
    WHERE r.funcionario_id = o.id AND r.obra_id = p_obra_id
      AND r.data = p_data_origem AND r.tipo_registro = 'horas'
      AND r.ausencia IS FALSE AND r.falta_tipo IS NULL AND r.motivo_ausencia IS NULL
      AND coalesce(r.horas_normais, 0) + coalesce(r.horas_extras, 0) > 0
  ) <> 1 OR EXISTS (
    SELECT 1 FROM public.registros_horas r
    WHERE r.funcionario_id = o.id AND r.data = p_data_origem
      AND (r.tipo_registro IS DISTINCT FROM 'horas'
        OR r.ausencia IS DISTINCT FROM false
        OR r.falta_tipo IS NOT NULL OR r.motivo_ausencia IS NOT NULL
        OR coalesce(r.horas_normais, 0) + coalesce(r.horas_extras, 0) <= 0)
  );

  IF p_aplicar THEN
    WITH inseridas AS (
      INSERT INTO public.alocacoes (funcionario_id, obra_id, data, created_by)
      SELECT unnest(v_origem), p_obra_id, p_data_destino, v_usuario
      EXCEPT SELECT unnest(v_existentes), p_obra_id, p_data_destino, v_usuario
      EXCEPT SELECT unnest(v_inelegiveis), p_obra_id, p_data_destino, v_usuario
      EXCEPT SELECT unnest(v_suprimidos), p_obra_id, p_data_destino, v_usuario
      EXCEPT SELECT unnest(v_nao_copiaveis), p_obra_id, p_data_destino, v_usuario
      ON CONFLICT DO NOTHING
      RETURNING funcionario_id
    )
    SELECT coalesce(array_agg(funcionario_id), ARRAY[]::uuid[]) INTO v_copiados FROM inseridas;

    INSERT INTO public.registros_horas (
      funcionario_id, obra_id, data, horas_normais, horas_extras, ausencia,
      justificativa_extras, motivo_ausencia, observacoes, tipo_registro, falta_tipo,
      created_by, updated_by
    )
    SELECT c.funcionario_id, p_obra_id, p_data_destino,
      r.horas_normais, r.horas_extras, false, r.justificativa_extras,
      NULL, r.observacoes, 'horas', NULL, v_usuario, v_usuario
    FROM unnest(v_copiados) AS c(funcionario_id)
    JOIN public.registros_horas r
      ON r.funcionario_id = c.funcionario_id AND r.obra_id = p_obra_id
      AND r.data = p_data_origem AND r.tipo_registro = 'horas'
      AND r.ausencia IS FALSE AND r.falta_tipo IS NULL AND r.motivo_ausencia IS NULL
      AND coalesce(r.horas_normais, 0) + coalesce(r.horas_extras, 0) > 0;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'funcionario_id', f.id, 'nome', f.nome,
    'status', CASE
      WHEN f.id = ANY(v_copiados) THEN 'copiado'
      WHEN f.id = ANY(v_suprimidos) THEN 'excluido_destino'
      WHEN f.id = ANY(v_nao_copiaveis) THEN 'nao_copiavel'
      WHEN f.id = ANY(v_inelegiveis) THEN 'inelegivel'
      WHEN f.id = ANY(v_existentes) OR p_aplicar THEN 'ja_existente'
      ELSE 'adicionar' END,
    'motivo', CASE
      WHEN f.id = ANY(v_suprimidos) THEN 'Lancamento excluido manualmente na data destino'
      WHEN f.id = ANY(v_nao_copiaveis) THEN 'Origem sem jornada copiavel ou com ausencia'
      WHEN f.id = ANY(v_inelegiveis) THEN 'Funcionario inelegivel na data destino'
      WHEN f.id = ANY(v_existentes) OR (p_aplicar AND NOT f.id = ANY(v_copiados))
        THEN 'Ja possui lancamento na data destino'
      ELSE NULL END
  ) ORDER BY f.nome), '[]'::jsonb) INTO v_itens
  FROM public.obras_control_funcionarios_por_ids(v_origem) f;

  RETURN jsonb_build_object(
    'origem_data', p_data_origem, 'destino_data', p_data_destino,
    'total_origem', cardinality(v_origem), 'total_copiados', cardinality(v_copiados),
    'total_ja_existentes', cardinality(v_existentes),
    'total_inelegiveis', cardinality(v_inelegiveis),
    'total_suprimidos', cardinality(v_suprimidos),
    'total_nao_copiaveis', cardinality(v_nao_copiaveis),
    'total_adicionar', CASE WHEN p_aplicar THEN cardinality(v_copiados) ELSE (
      SELECT count(*) FROM unnest(v_origem) AS o(id)
      WHERE NOT o.id = ANY(v_existentes)
        AND NOT o.id = ANY(v_inelegiveis)
        AND NOT o.id = ANY(v_suprimidos)
        AND NOT o.id = ANY(v_nao_copiaveis)
    ) END,
    'itens', v_itens
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obras_copiar_dia_anterior(uuid, date, date, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_copiar_dia_anterior(uuid, date, date, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.obras_copiar_jornadas_v2(p_itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_item jsonb;
  v_solicitados integer := 0;
  v_processados integer := 0;
  v_preservados integer := 0;
  v_alocacao_id uuid;
  v_registro_id uuid;
  v_funcionario_id uuid;
  v_obra_id uuid;
  v_data date;
  v_origem_calculo text;
  v_origem_data date;
  v_nao_copiaveis integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessao expirada.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_itens) <> 'array' THEN RAISE EXCEPTION 'Itens de copia invalidos.' USING ERRCODE = '22023'; END IF;
  FOR v_funcionario_id IN
    SELECT DISTINCT (item->>'funcionarioId')::uuid
    FROM jsonb_array_elements(p_itens) AS itens(item)
    ORDER BY 1
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_funcionario_id::text, 0));
  END LOOP;
  -- Primeiro bloqueia linhas existentes; depois adquire as chaves do trigger.
  -- Isso cobre DELETE direto e evita ciclo com UPDATE que entra no trigger.
  FOR v_item IN
    SELECT item FROM jsonb_array_elements(p_itens) AS itens(item)
    WHERE coalesce(nullif(item->>'origemCalculo', ''), 'copia') = 'copia'
      AND nullif(item->>'origemData', '') IS NOT NULL
    ORDER BY (item->>'funcionarioId')::uuid, (item->>'origemData')::date
  LOOP
    PERFORM 1 FROM public.alocacoes a
    WHERE a.funcionario_id = (v_item->>'funcionarioId')::uuid
      AND a.obra_id = (v_item->>'obraId')::uuid
      AND a.data = (v_item->>'origemData')::date
    ORDER BY a.id FOR SHARE;
    PERFORM 1 FROM public.registros_horas r
    WHERE r.funcionario_id = (v_item->>'funcionarioId')::uuid
      AND r.data = (v_item->>'origemData')::date
    ORDER BY r.id FOR SHARE;
  END LOOP;
  -- O trigger de registros_horas usa a chave funcionario|data. Obter todos os
  -- locks da origem em ordem estavel antes de qualquer leitura de origem.
  FOR v_item IN
    SELECT item FROM jsonb_array_elements(p_itens) AS itens(item)
    WHERE coalesce(nullif(item->>'origemCalculo', ''), 'copia') = 'copia'
      AND nullif(item->>'origemData', '') IS NOT NULL
    ORDER BY (item->>'funcionarioId')::uuid, (item->>'origemData')::date
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        (v_item->>'funcionarioId')::uuid::text || '|' || (v_item->>'origemData')::date::text, 0
      )
    );
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens)
  LOOP
    v_solicitados := v_solicitados + 1;
    v_alocacao_id := nullif(v_item->>'alocacaoId', '')::uuid;
    v_registro_id := nullif(v_item->>'registroId', '')::uuid;
    v_funcionario_id := (v_item->>'funcionarioId')::uuid;
    v_obra_id := (v_item->>'obraId')::uuid;
    v_data := (v_item->>'data')::date;
    -- Clientes anteriores continuam seguros: sem origem explicita significa copia.
    v_origem_calculo := coalesce(nullif(v_item->>'origemCalculo', ''), 'copia');

    IF v_origem_calculo NOT IN ('aplicacao', 'copia') THEN
      RAISE EXCEPTION 'Origem de calculo invalida.' USING ERRCODE = '23514';
    END IF;

    IF v_origem_calculo = 'copia' THEN
      v_origem_data := nullif(v_item->>'origemData', '')::date;
      IF v_origem_data IS NULL OR v_origem_data >= v_data
        OR NOT EXISTS (
          SELECT 1 FROM public.alocacoes a
          WHERE a.funcionario_id = v_funcionario_id AND a.obra_id = v_obra_id
            AND a.data = v_origem_data
        )
        OR (SELECT count(*) FROM public.registros_horas r
          WHERE r.funcionario_id = v_funcionario_id AND r.obra_id = v_obra_id
            AND r.data = v_origem_data AND r.tipo_registro = 'horas'
            AND r.ausencia IS FALSE AND r.falta_tipo IS NULL
            AND r.motivo_ausencia IS NULL
            AND coalesce(r.horas_normais, 0) + coalesce(r.horas_extras, 0) > 0
        ) <> 1
        OR EXISTS (
          SELECT 1 FROM public.registros_horas r
          WHERE r.funcionario_id = v_funcionario_id AND r.data = v_origem_data
            AND (r.tipo_registro IS DISTINCT FROM 'horas'
              OR r.ausencia IS DISTINCT FROM false
              OR r.falta_tipo IS NOT NULL OR r.motivo_ausencia IS NOT NULL
              OR coalesce(r.horas_normais, 0) + coalesce(r.horas_extras, 0) <= 0)
        ) THEN
        v_nao_copiaveis := v_nao_copiaveis + 1;
        CONTINUE;
      END IF;
    END IF;

    -- Somente a copia automatica respeita a supressao. Uma inclusao manual segue
    -- ate o INSERT; o trigger trg_limpar_supressao_alocacao_recriada neutraliza
    -- a supressao sem remover o snapshot historico.
    IF v_origem_calculo = 'copia' AND v_alocacao_id IS NULL AND EXISTS (
      SELECT 1 FROM public.alocacoes_dia_exclusoes e
      WHERE e.funcionario_id = v_funcionario_id AND e.data = v_data
        AND e.ativa_para_copia = true
    ) THEN
      v_preservados := v_preservados + 1;
      CONTINUE;
    END IF;

    -- Ocupacao real continua sendo determinada exclusivamente por alocacoes.
    IF v_alocacao_id IS NULL AND EXISTS (
      SELECT 1 FROM public.alocacoes a
      WHERE a.funcionario_id = v_funcionario_id AND a.data = v_data
    ) THEN
      v_preservados := v_preservados + 1;
      CONTINUE;
    END IF;

    -- A copia tambem preserva destino ocupado somente por registros_horas.
    IF v_origem_calculo = 'copia' AND v_alocacao_id IS NULL AND EXISTS (
      SELECT 1 FROM public.registros_horas r
      WHERE r.funcionario_id = v_funcionario_id AND r.data = v_data
    ) THEN
      v_preservados := v_preservados + 1;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.obras_salvar_jornada_v2(
        v_alocacao_id, v_registro_id, v_funcionario_id, v_obra_id, v_data,
        (v_item->>'horaEntrada')::time, (v_item->>'horaSaida')::time,
        (v_item->>'intervaloMinutos')::integer, (v_item->>'horasNormais')::numeric,
        (v_item->>'horasExtras')::numeric, v_item->>'justificativa',
        v_item->>'observacoes', v_item->>'especialidadeAjudante',
        v_item->'detalhe', v_origem_calculo
      );
      v_processados := v_processados + 1;
    EXCEPTION WHEN unique_violation THEN
      IF v_alocacao_id IS NULL AND EXISTS (
        SELECT 1 FROM public.alocacoes a
        WHERE a.funcionario_id = v_funcionario_id AND a.data = v_data
      ) THEN
        v_preservados := v_preservados + 1;
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object(
    'solicitados', v_solicitados,
    'processados', v_processados,
    'preservados', v_preservados,
    'nao_copiaveis', v_nao_copiaveis
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obras_copiar_jornadas_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_copiar_jornadas_v2(jsonb) TO authenticated;

