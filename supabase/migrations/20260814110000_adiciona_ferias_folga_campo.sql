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
