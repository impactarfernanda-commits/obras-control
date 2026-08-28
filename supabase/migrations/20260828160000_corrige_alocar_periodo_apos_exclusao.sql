-- Revisao manual: nao executar automaticamente antes da aprovacao.
-- Distingue a inclusao explicita de Alocar periodo da copia automatica.
-- A assinatura e a atomicidade da RPC permanecem inalteradas.
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
    -- Clientes anteriores continuam seguros: sem origem explicita significa copia.
    v_origem_calculo := coalesce(nullif(v_item->>'origemCalculo', ''), 'copia');

    IF v_origem_calculo NOT IN ('aplicacao', 'copia') THEN
      RAISE EXCEPTION 'Origem de calculo invalida.' USING ERRCODE = '23514';
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
    'preservados', v_preservados
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obras_copiar_jornadas_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_copiar_jornadas_v2(jsonb) TO authenticated;
