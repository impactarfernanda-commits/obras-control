BEGIN;

CREATE TEMP TABLE baseline_ferias_folga ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.alocacoes) AS alocacoes,
  (SELECT count(*) FROM public.registros_horas) AS registros_horas,
  (SELECT count(*) FROM public.registros_horas WHERE tipo_registro = 'falta') AS faltas;

CREATE TEMP TABLE baseline_registros_ferias_folga ON COMMIT DROP AS
SELECT id, md5(row_to_json(r)::text) AS conteudo FROM public.registros_horas r;
CREATE TEMP TABLE baseline_alocacoes_ferias_folga ON COMMIT DROP AS
SELECT id, md5(row_to_json(a)::text) AS conteudo FROM public.alocacoes a;

-- DDL temporario exato da migration incremental.
-- Ausencias planejadas permanecem vinculadas a funcionario, obra e dia em
-- registros_horas. A RPC de periodo valida tudo antes de inserir qualquer linha.

ALTER TABLE public.registros_horas
  DROP CONSTRAINT IF EXISTS registros_horas_tipo_registro_check,
  DROP CONSTRAINT IF EXISTS registros_horas_tipo_conteudo_check;

ALTER TABLE public.registros_horas
  ADD CONSTRAINT registros_horas_tipo_registro_check
    CHECK (tipo_registro IN ('horas', 'falta', 'ferias', 'folga_campo')) NOT VALID,
  ADD CONSTRAINT registros_horas_tipo_conteudo_check
    CHECK (
      (
        tipo_registro = 'falta'
        AND falta_tipo IS NOT NULL
        AND horas_normais = 0
        AND horas_extras = 0
      )
      OR (
        tipo_registro IN ('ferias', 'folga_campo')
        AND falta_tipo IS NULL
        AND horas_normais = 0
        AND horas_extras = 0
      )
      OR (
        tipo_registro = 'horas'
        AND falta_tipo IS NULL
        AND (horas_normais + horas_extras) > 0
      )
    ) NOT VALID;

CREATE OR REPLACE FUNCTION public.obras_validar_conflito_apontamento_diario(
  p_funcionario_id uuid,
  p_data date,
  p_tipo_registro text,
  p_ignorar_registro_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tipo_existente text;
  v_tem_horas boolean;
BEGIN
  IF p_funcionario_id IS NULL OR p_data IS NULL THEN
    RAISE EXCEPTION 'Funcionario e data sao obrigatorios.' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_funcionario_id::text || '|' || p_data::text, 0)
  );

  SELECT
    min(tipo_registro) FILTER (WHERE tipo_registro <> 'horas'),
    coalesce(bool_or(
      tipo_registro = 'horas' AND coalesce(horas_normais, 0) + coalesce(horas_extras, 0) > 0
    ), false)
  INTO v_tipo_existente, v_tem_horas
  FROM public.registros_horas
  WHERE funcionario_id = p_funcionario_id
    AND data = p_data
    AND (p_ignorar_registro_id IS NULL OR id <> p_ignorar_registro_id);

  IF p_tipo_registro IN ('falta', 'ferias', 'folga_campo') AND v_tem_horas THEN
    RAISE EXCEPTION 'REGISTRO_HORAS_JA_EXISTE'
      USING ERRCODE = '23514',
        DETAIL = 'Ha horas ativas para o mesmo funcionario e data.';
  END IF;

  IF p_tipo_registro = 'horas' AND v_tipo_existente = 'ferias' THEN
    RAISE EXCEPTION 'REGISTRO_FERIAS_JA_EXISTE' USING ERRCODE = '23514';
  END IF;
  IF p_tipo_registro = 'horas' AND v_tipo_existente = 'folga_campo' THEN
    RAISE EXCEPTION 'REGISTRO_FOLGA_CAMPO_JA_EXISTE' USING ERRCODE = '23514';
  END IF;
  IF p_tipo_registro = 'horas' AND v_tipo_existente = 'falta' THEN
    RAISE EXCEPTION 'REGISTRO_FALTA_JA_EXISTE' USING ERRCODE = '23514';
  END IF;

  IF p_tipo_registro IN ('falta', 'ferias', 'folga_campo')
     AND v_tipo_existente IS NOT NULL THEN
    RAISE EXCEPTION 'REGISTRO_AUSENCIA_JA_EXISTE'
      USING ERRCODE = '23514',
        DETAIL = 'Ha ausencia ativa para o mesmo funcionario e data.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.obras_normalizar_validar_registro_horas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.tipo_registro := coalesce(NEW.tipo_registro, 'horas');

  IF NEW.tipo_registro = 'falta' THEN
    IF NEW.falta_tipo IS NULL OR NEW.falta_tipo NOT IN (
      'nao_justificada', 'justificada', 'atestado',
      'suspensao', 'afastamento', 'outro'
    ) THEN
      RAISE EXCEPTION 'REGISTRO_FALTA_CLASSIFICACAO'
        USING ERRCODE = '23514', DETAIL = 'Classificacao de falta invalida ou ausente.';
    END IF;
    NEW.horas_normais := 0;
    NEW.horas_extras := 0;
    NEW.justificativa_extras := NULL;
    NEW.ausencia := true;
    NEW.motivo_ausencia := NULL;
  ELSIF NEW.tipo_registro IN ('ferias', 'folga_campo') THEN
    NEW.falta_tipo := NULL;
    NEW.horas_normais := 0;
    NEW.horas_extras := 0;
    NEW.justificativa_extras := NULL;
    NEW.ausencia := true;
    NEW.motivo_ausencia := NEW.tipo_registro;
  ELSIF NEW.tipo_registro = 'horas' THEN
    NEW.falta_tipo := NULL;
    NEW.ausencia := false;
    NEW.motivo_ausencia := NULL;
    IF coalesce(NEW.horas_normais, 0) + coalesce(NEW.horas_extras, 0) <= 0 THEN
      RAISE EXCEPTION 'REGISTRO_HORAS_ZERO'
        USING ERRCODE = '23514', DETAIL = 'Horas trabalhadas devem ter total maior que zero.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Tipo de registro invalido.' USING ERRCODE = '23514';
  END IF;

  PERFORM public.obras_validar_conflito_apontamento_diario(
    NEW.funcionario_id,
    NEW.data,
    NEW.tipo_registro,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_data_lancamento_nao_futura()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'alocacoes' THEN
    IF NEW.data > current_date THEN
      RAISE EXCEPTION 'DATA_FUTURA_ALOCACAO: Nao e permitido lancar alocacoes em datas futuras.'
        USING ERRCODE = '22007';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'registros_horas' THEN
    IF NEW.data > current_date
       AND NEW.tipo_registro NOT IN ('ferias', 'folga_campo') THEN
      RAISE EXCEPTION 'DATA_FUTURA_HORAS: Nao e permitido lancar horas em datas futuras.'
        USING ERRCODE = '22007';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'guard_data_lancamento_nao_futura nao suporta a tabela %.', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.obras_salvar_ausencia_planejada_periodo(
  p_funcionario_id uuid,
  p_obra_id uuid,
  p_tipo_registro text,
  p_data_inicio date,
  p_data_fim date,
  p_observacoes text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_total integer;
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo_registro NOT IN ('ferias', 'folga_campo') THEN
    RAISE EXCEPTION 'Tipo de ausencia planejada invalido.' USING ERRCODE = '23514';
  END IF;
  IF p_data_inicio IS NULL OR p_data_fim IS NULL OR p_data_fim < p_data_inicio THEN
    RAISE EXCEPTION 'PERIODO_AUSENCIA_INVALIDO' USING ERRCODE = '22007';
  END IF;
  IF p_data_fim - p_data_inicio > 366 THEN
    RAISE EXCEPTION 'Periodo de ausencia excede 367 dias.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.obras_validar_conflito_apontamento_diario(
    p_funcionario_id, d::date, p_tipo_registro, NULL
  )
  FROM generate_series(p_data_inicio, p_data_fim, interval '1 day') AS d;

  INSERT INTO public.registros_horas (
    funcionario_id, obra_id, data, tipo_registro, falta_tipo,
    horas_normais, horas_extras, justificativa_extras, ausencia,
    motivo_ausencia, observacoes, created_by, updated_by
  )
  SELECT p_funcionario_id, p_obra_id, d::date, p_tipo_registro, NULL,
         0, 0, NULL, true, p_tipo_registro, nullif(btrim(p_observacoes), ''),
         v_usuario, v_usuario
  FROM generate_series(p_data_inicio, p_data_fim, interval '1 day') AS d;

  GET DIAGNOSTICS v_total = ROW_COUNT;

  RETURN v_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.obras_salvar_ausencia_planejada_periodo(
  uuid, uuid, text, date, date, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_salvar_ausencia_planejada_periodo(
  uuid, uuid, text, date, date, text
) TO authenticated;

COMMENT ON FUNCTION public.obras_salvar_ausencia_planejada_periodo(
  uuid, uuid, text, date, date, text
) IS 'Registra ferias ou folga de campo por periodo corrido, atomicamente e vinculada a obra.';

DO $test$
DECLARE
  v_usuario uuid;
  v_funcionario uuid;
  v_obra uuid;
  v_inicio date := current_date + 7;
  v_total integer;
BEGIN
  SELECT user_id INTO v_usuario FROM public.user_roles ORDER BY user_id LIMIT 1;
  SELECT f.id, o.id INTO v_funcionario, v_obra
  FROM public.funcionarios f
  CROSS JOIN public.obras o
  WHERE f.ativo IS TRUE AND f.visivel_obras_control IS TRUE
    AND o.visivel_obras_control IS TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.registros_horas r
      WHERE r.funcionario_id = f.id AND r.obra_id = o.id
        AND r.data BETWEEN current_date AND v_inicio + 20
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.alocacoes a
      WHERE a.funcionario_id = f.id AND a.obra_id = o.id
        AND a.data BETWEEN current_date AND v_inicio + 20
    )
  ORDER BY f.id, o.id LIMIT 1;

  IF v_usuario IS NULL OR v_funcionario IS NULL OR v_obra IS NULL THEN
    RAISE EXCEPTION 'TESTE_INCONCLUSIVO: usuario, funcionario ou obra de prova ausente';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_usuario::text, true);

  SELECT public.obras_salvar_ausencia_planejada_periodo(
    v_funcionario, v_obra, 'ferias', v_inicio, v_inicio + 8, 'dry-run'
  ) INTO v_total;
  IF v_total <> 9 THEN
    RAISE EXCEPTION 'TESTE_FALHOU: ferias nao incluiu todos os dias corridos';
  END IF;
  IF (SELECT count(*) FROM generate_series(v_inicio, v_inicio + 8, interval '1 day') d
      WHERE extract(isodow FROM d) IN (6, 7)) < 2 THEN
    RAISE EXCEPTION 'TESTE_FALHOU: periodo de ferias nao cobriu fim de semana';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.alocacoes
    WHERE funcionario_id = v_funcionario AND obra_id = v_obra
      AND data BETWEEN v_inicio AND v_inicio + 12
  ) THEN
    RAISE EXCEPTION 'TESTE_FALHOU: ausencia planejada criou alocacao futura';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.registros_horas
    WHERE funcionario_id = v_funcionario AND data BETWEEN v_inicio AND v_inicio + 8
      AND (tipo_registro <> 'ferias' OR horas_normais <> 0 OR horas_extras <> 0
        OR ausencia IS NOT TRUE OR motivo_ausencia <> 'ferias')
  ) THEN
    RAISE EXCEPTION 'TESTE_FALHOU: conteudo de ferias invalido';
  END IF;

  SELECT public.obras_salvar_ausencia_planejada_periodo(
    v_funcionario, v_obra, 'folga_campo', v_inicio + 10, v_inicio + 12, NULL
  ) INTO v_total;
  IF v_total <> 3 THEN
    RAISE EXCEPTION 'TESTE_FALHOU: folga nao incluiu todos os dias corridos';
  END IF;

  BEGIN
    PERFORM public.obras_salvar_ausencia_planejada_periodo(
      v_funcionario, v_obra, 'ferias', v_inicio - 1, v_inicio + 3, NULL
    );
    RAISE EXCEPTION 'TESTE_FALHOU: sobreposicao de ausencia aceita';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  IF EXISTS (
    SELECT 1 FROM public.registros_horas
    WHERE funcionario_id = v_funcionario AND obra_id = v_obra AND data = v_inicio - 1
  ) THEN
    RAISE EXCEPTION 'TESTE_FALHOU: operacao com conflito nao foi atomica';
  END IF;

  INSERT INTO public.registros_horas (
    funcionario_id, obra_id, data, tipo_registro, horas_normais, horas_extras,
    ausencia, created_by, updated_by
  ) VALUES (v_funcionario, v_obra, current_date, 'horas', 1, 0, false, v_usuario, v_usuario);
  DELETE FROM public.registros_horas
   WHERE funcionario_id = v_funcionario AND obra_id = v_obra AND data = current_date;

  INSERT INTO public.registros_horas (
    funcionario_id, obra_id, data, tipo_registro, falta_tipo, horas_normais, horas_extras,
    ausencia, motivo_ausencia, created_by, updated_by
  ) VALUES (
    v_funcionario, v_obra, current_date, 'falta', 'justificada', 0, 0,
    true, 'falta', v_usuario, v_usuario
  );
  DELETE FROM public.registros_horas
   WHERE funcionario_id = v_funcionario AND obra_id = v_obra AND data = current_date;

  BEGIN
    PERFORM public.obras_salvar_ausencia_planejada_periodo(
      v_funcionario, v_obra, 'ferias', v_inicio, v_inicio - 1, NULL
    );
    RAISE EXCEPTION 'TESTE_FALHOU: periodo invertido aceito';
  EXCEPTION WHEN SQLSTATE '22007' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.registros_horas (
      funcionario_id, obra_id, data, tipo_registro, horas_normais, horas_extras,
      ausencia, created_by, updated_by
    ) VALUES (
      v_funcionario, v_obra, current_date + 1, 'horas', 1, 0, false, v_usuario, v_usuario
    );
    RAISE EXCEPTION 'TESTE_FALHOU: horas futuras aceitas';
  EXCEPTION WHEN SQLSTATE '22007' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.alocacoes (funcionario_id, obra_id, data, created_by)
    VALUES (v_funcionario, v_obra, current_date + 1, v_usuario);
    RAISE EXCEPTION 'TESTE_FALHOU: alocacao futura sem ausencia aceita';
  EXCEPTION WHEN SQLSTATE '22007' THEN NULL;
  END;
END;
$test$;

DO $acl_test$
DECLARE
  v_oid oid := to_regprocedure(
    'public.obras_salvar_ausencia_planejada_periodo(uuid,uuid,text,date,date,text)'
  );
  v_public_execute boolean;
BEGIN
  SELECT coalesce(bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'), false)
    INTO v_public_execute
  FROM pg_proc p
  LEFT JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl ON true
  WHERE p.oid = v_oid;

  IF v_oid IS NULL
     OR v_public_execute
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege(
       'authenticated',
       v_oid,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'TESTE_FALHOU: assinatura ou ACL da RPC invalida';
  END IF;
END;
$acl_test$;

DO $baseline_test$
BEGIN
  IF EXISTS (
    SELECT 1 FROM baseline_registros_ferias_folga b
    LEFT JOIN public.registros_horas r ON r.id = b.id
    WHERE r.id IS NULL OR md5(row_to_json(r)::text) <> b.conteudo
  ) OR EXISTS (
    SELECT 1 FROM baseline_alocacoes_ferias_folga b
    LEFT JOIN public.alocacoes a ON a.id = b.id
    WHERE a.id IS NULL OR md5(row_to_json(a)::text) <> b.conteudo
  ) THEN
    RAISE EXCEPTION 'TESTE_FALHOU: dado baseline foi alterado';
  END IF;
END;
$baseline_test$;

SELECT * FROM baseline_ferias_folga;

ROLLBACK;
