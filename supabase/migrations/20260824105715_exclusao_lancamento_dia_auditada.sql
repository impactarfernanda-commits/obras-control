-- Exclusao auditada de um lancamento diario e supressao da copia automatica.
-- Nao altera calculos de jornada, regras financeiras ou a constraint de justificativa de HE.

CREATE TABLE public.alocacoes_dia_exclusoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id),
  obra_id uuid NOT NULL REFERENCES public.obras(id),
  data date NOT NULL,
  alocacao_id_original uuid NOT NULL,
  registro_id_original uuid,
  alocacao_snapshot jsonb NOT NULL,
  registro_snapshot jsonb,
  excluido_por uuid NOT NULL REFERENCES auth.users(id),
  excluido_em timestamptz NOT NULL DEFAULT now(),
  ativa_para_copia boolean NOT NULL DEFAULT true,
  neutralizada_por uuid REFERENCES auth.users(id),
  neutralizada_em timestamptz
);

CREATE INDEX alocacoes_dia_exclusoes_obra_data_idx
  ON public.alocacoes_dia_exclusoes (obra_id, data);
CREATE UNIQUE INDEX alocacoes_dia_exclusoes_supressao_ativa_uidx
  ON public.alocacoes_dia_exclusoes (funcionario_id, data)
  WHERE ativa_para_copia = true;

ALTER TABLE public.alocacoes_dia_exclusoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alocacoes_dia_exclusoes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.alocacoes_dia_exclusoes TO authenticated;

CREATE POLICY alocacoes_dia_exclusoes_select_auditoria
  ON public.alocacoes_dia_exclusoes
  FOR SELECT
  TO authenticated
  USING (
    excluido_por = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'coordenador'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'gerente'::public.app_role)
    OR public.has_role((SELECT auth.uid()), 'diretor'::public.app_role)
  );

COMMENT ON TABLE public.alocacoes_dia_exclusoes IS
  'Snapshot auditavel de lancamentos diarios excluidos; tambem impede somente a recriacao pela copia automatica.';

CREATE OR REPLACE FUNCTION public.obras_excluir_lancamento_dia(p_alocacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_usuario uuid := auth.uid();
  v_alocacao public.alocacoes;
  v_registro public.registros_horas;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Sessao expirada.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_alocacao
  FROM public.alocacoes
  WHERE id = p_alocacao_id;

  IF v_alocacao.id IS NULL THEN
    RAISE EXCEPTION 'Lancamento nao encontrado ou ja excluido.' USING ERRCODE = 'P0002';
  END IF;

  -- Serializa exclusao, copia e recriacao do mesmo funcionario.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_alocacao.funcionario_id::text, 0)
  );

  SELECT * INTO v_alocacao
  FROM public.alocacoes
  WHERE id = p_alocacao_id
  FOR UPDATE;

  IF v_alocacao.id IS NULL THEN
    RAISE EXCEPTION 'Lancamento nao encontrado ou ja excluido.' USING ERRCODE = 'P0002';
  END IF;

  IF public.competencia_fechada(v_alocacao.data) THEN
    RAISE EXCEPTION 'Competencia fechada. Solicite reabertura ao gerente para alterar este periodo.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    v_alocacao.created_by = v_usuario
    OR public.get_user_level(v_usuario) >= 2
  ) THEN
    RAISE EXCEPTION 'Sem permissao para excluir este lancamento.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_registro
  FROM public.registros_horas
  WHERE funcionario_id = v_alocacao.funcionario_id
    AND obra_id = v_alocacao.obra_id
    AND data = v_alocacao.data
  FOR UPDATE;

  IF v_registro.id IS NOT NULL AND NOT (
    v_registro.created_by = v_usuario
    OR public.get_user_level(v_usuario) >= 2
  ) THEN
    RAISE EXCEPTION 'Sem permissao para excluir o registro de horas deste lancamento.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.alocacoes_dia_exclusoes (
    funcionario_id, obra_id, data, alocacao_id_original, registro_id_original,
    alocacao_snapshot, registro_snapshot, excluido_por
  ) VALUES (
    v_alocacao.funcionario_id, v_alocacao.obra_id, v_alocacao.data,
    v_alocacao.id, v_registro.id, to_jsonb(v_alocacao),
    CASE WHEN v_registro.id IS NULL THEN NULL ELSE to_jsonb(v_registro) END,
    v_usuario
  )
  ON CONFLICT (funcionario_id, data) WHERE ativa_para_copia = true DO UPDATE SET
    obra_id = EXCLUDED.obra_id,
    alocacao_id_original = EXCLUDED.alocacao_id_original,
    registro_id_original = EXCLUDED.registro_id_original,
    alocacao_snapshot = EXCLUDED.alocacao_snapshot,
    registro_snapshot = EXCLUDED.registro_snapshot,
    excluido_por = EXCLUDED.excluido_por,
    excluido_em = now(),
    ativa_para_copia = true,
    neutralizada_por = NULL,
    neutralizada_em = NULL;

  IF v_registro.id IS NOT NULL THEN
    DELETE FROM public.registros_horas WHERE id = v_registro.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Nao foi possivel excluir o registro de horas.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  DELETE FROM public.alocacoes WHERE id = v_alocacao.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nao foi possivel excluir a alocacao.' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'funcionario_id', v_alocacao.funcionario_id,
    'obra_id', v_alocacao.obra_id,
    'data', v_alocacao.data
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obras_excluir_lancamento_dia(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_excluir_lancamento_dia(uuid) TO authenticated;

-- Uma inclusao explicita representa nova intencao do usuario e neutraliza a supressao,
-- sem apagar o snapshot historico da exclusao.
-- A copia automatica nunca chega ao INSERT quando existe supressao (defesa nas duas RPCs abaixo).
CREATE OR REPLACE FUNCTION public.limpar_supressao_alocacao_recriada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.alocacoes_dia_exclusoes
  SET ativa_para_copia = false,
      neutralizada_por = auth.uid(),
      neutralizada_em = now()
  WHERE funcionario_id = NEW.funcionario_id
    AND data = NEW.data
    AND ativa_para_copia = true;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.limpar_supressao_alocacao_recriada() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_limpar_supressao_alocacao_recriada
  AFTER INSERT ON public.alocacoes
  FOR EACH ROW EXECUTE FUNCTION public.limpar_supressao_alocacao_recriada();

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
  v_copiados uuid[] := ARRAY[]::uuid[];
  v_itens jsonb;
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

  IF p_aplicar THEN
    WITH inseridas AS (
      INSERT INTO public.alocacoes (funcionario_id, obra_id, data, created_by)
      SELECT unnest(v_origem), p_obra_id, p_data_destino, v_usuario
      EXCEPT SELECT unnest(v_existentes), p_obra_id, p_data_destino, v_usuario
      EXCEPT SELECT unnest(v_inelegiveis), p_obra_id, p_data_destino, v_usuario
      EXCEPT SELECT unnest(v_suprimidos), p_obra_id, p_data_destino, v_usuario
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
      coalesce(
        (SELECT r.horas_normais FROM public.registros_horas r
          WHERE r.funcionario_id = c.funcionario_id AND r.obra_id = p_obra_id
            AND r.data = p_data_origem AND r.tipo_registro = 'horas'
            AND r.horas_normais > 0 LIMIT 1),
        CASE WHEN extract(isodow FROM p_data_destino) = 5 THEN 8 ELSE 9 END
      ),
      0, false, NULL, NULL, NULL, 'horas', NULL, v_usuario, v_usuario
    FROM unnest(v_copiados) AS c(funcionario_id);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'funcionario_id', f.id, 'nome', f.nome,
    'status', CASE
      WHEN f.id = ANY(v_copiados) THEN 'copiado'
      WHEN f.id = ANY(v_suprimidos) THEN 'excluido_destino'
      WHEN f.id = ANY(v_inelegiveis) THEN 'inelegivel'
      WHEN f.id = ANY(v_existentes) OR p_aplicar THEN 'ja_existente'
      ELSE 'adicionar' END,
    'motivo', CASE
      WHEN f.id = ANY(v_suprimidos) THEN 'Lancamento excluido manualmente na data destino'
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
    'total_adicionar', CASE WHEN p_aplicar THEN cardinality(v_copiados) ELSE (
      SELECT count(*) FROM unnest(v_origem) AS o(id)
      WHERE NOT o.id = ANY(v_existentes)
        AND NOT o.id = ANY(v_inelegiveis)
        AND NOT o.id = ANY(v_suprimidos)
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
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens)
  LOOP
    v_solicitados := v_solicitados + 1;
    v_alocacao_id := nullif(v_item->>'alocacaoId', '')::uuid;
    v_registro_id := nullif(v_item->>'registroId', '')::uuid;
    v_funcionario_id := (v_item->>'funcionarioId')::uuid;
    v_obra_id := (v_item->>'obraId')::uuid;
    v_data := (v_item->>'data')::date;

    IF v_alocacao_id IS NULL AND EXISTS (
      SELECT 1 FROM public.alocacoes_dia_exclusoes e
      WHERE e.funcionario_id = v_funcionario_id AND e.data = v_data
        AND e.ativa_para_copia = true
    ) THEN
      v_preservados := v_preservados + 1;
      CONTINUE;
    END IF;

    IF v_alocacao_id IS NULL AND EXISTS (
      SELECT 1 FROM public.alocacoes a
      WHERE a.funcionario_id = v_funcionario_id AND a.data = v_data
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
        v_item->'detalhe', 'copia'
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
    'preservados', v_preservados
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obras_copiar_jornadas_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_copiar_jornadas_v2(jsonb) TO authenticated;
