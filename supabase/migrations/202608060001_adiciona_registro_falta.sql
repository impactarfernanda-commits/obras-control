-- O executor de migrations do Supabase aplica este arquivo em uma unica transacao.

ALTER TABLE public.registros_horas
  ADD COLUMN IF NOT EXISTS tipo_registro text NOT NULL DEFAULT 'horas',
  ADD COLUMN IF NOT EXISTS falta_tipo text;

COMMENT ON COLUMN public.registros_horas.tipo_registro IS
  'Tipo explicito do apontamento do Obras Control: horas trabalhadas ou falta integral.';
COMMENT ON COLUMN public.registros_horas.falta_tipo IS
  'Classificacao obrigatoria quando tipo_registro = falta.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.registros_horas'::regclass
      AND conname = 'registros_horas_tipo_registro_check'
  ) THEN
    ALTER TABLE public.registros_horas
      ADD CONSTRAINT registros_horas_tipo_registro_check
      CHECK (tipo_registro IN ('horas', 'falta')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.registros_horas'::regclass
      AND conname = 'registros_horas_falta_tipo_check'
  ) THEN
    ALTER TABLE public.registros_horas
      ADD CONSTRAINT registros_horas_falta_tipo_check
      CHECK (
        falta_tipo IS NULL
        OR falta_tipo IN (
          'nao_justificada', 'justificada', 'atestado',
          'suspensao', 'afastamento', 'outro'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.registros_horas'::regclass
      AND conname = 'registros_horas_tipo_conteudo_check'
  ) THEN
    ALTER TABLE public.registros_horas
      ADD CONSTRAINT registros_horas_tipo_conteudo_check
      CHECK (
        (
          tipo_registro = 'falta'
          AND falta_tipo IS NOT NULL
          AND horas_normais = 0
          AND horas_extras = 0
        )
        OR (
          tipo_registro = 'horas'
          AND falta_tipo IS NULL
          AND (horas_normais + horas_extras) > 0
        )
      ) NOT VALID;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.obras_validar_conflito_apontamento_diario(
  p_funcionario_id uuid,
  p_data date,
  p_tipo_registro text,
  p_ignorar_registro_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tem_falta boolean;
  v_tem_horas boolean;
BEGIN
  IF p_funcionario_id IS NULL OR p_data IS NULL THEN
    RAISE EXCEPTION 'Funcionario e data sao obrigatorios.' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_funcionario_id::text || '|' || p_data::text, 0)
  );

  SELECT
    coalesce(bool_or(tipo_registro = 'falta'), false),
    coalesce(bool_or(
      tipo_registro = 'horas' AND coalesce(horas_normais, 0) + coalesce(horas_extras, 0) > 0
    ), false)
  INTO v_tem_falta, v_tem_horas
  FROM public.registros_horas
  WHERE funcionario_id = p_funcionario_id
    AND data = p_data
    AND (p_ignorar_registro_id IS NULL OR id <> p_ignorar_registro_id);

  IF p_tipo_registro = 'falta' AND v_tem_horas THEN
    RAISE EXCEPTION 'REGISTRO_HORAS_JA_EXISTE'
      USING ERRCODE = '23514',
        DETAIL = 'Ha horas ativas para o mesmo funcionario e data.';
  END IF;

  IF p_tipo_registro = 'horas' AND v_tem_falta THEN
    RAISE EXCEPTION 'REGISTRO_FALTA_JA_EXISTE'
      USING ERRCODE = '23514',
        DETAIL = 'Ha falta ativa para o mesmo funcionario e data.';
  END IF;

  IF p_tipo_registro = 'falta' AND v_tem_falta THEN
    RAISE EXCEPTION 'REGISTRO_FALTA_JA_EXISTE'
      USING ERRCODE = '23514',
        DETAIL = 'Ha falta ativa para o mesmo funcionario e data.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.obras_normalizar_validar_registro_horas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_obras_normalizar_validar_registro_horas ON public.registros_horas;
CREATE TRIGGER trg_obras_normalizar_validar_registro_horas
  BEFORE INSERT OR UPDATE ON public.registros_horas
  FOR EACH ROW EXECUTE FUNCTION public.obras_normalizar_validar_registro_horas();

CREATE INDEX IF NOT EXISTS registros_horas_func_data_tipo_idx
  ON public.registros_horas (funcionario_id, data, tipo_registro);

CREATE OR REPLACE FUNCTION public.obras_salvar_registro_horas(
  p_id uuid,
  p_funcionario_id uuid,
  p_obra_id uuid,
  p_data date,
  p_tipo_registro text,
  p_falta_tipo text DEFAULT NULL,
  p_horas_normais numeric DEFAULT 0,
  p_horas_extras numeric DEFAULT 0,
  p_justificativa_extras text DEFAULT NULL,
  p_observacoes text DEFAULT NULL
)
RETURNS public.registros_horas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_registro public.registros_horas;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria.' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.registros_horas (
      funcionario_id, obra_id, data, tipo_registro, falta_tipo,
      horas_normais, horas_extras, justificativa_extras, observacoes,
      ausencia, created_by, updated_by
    ) VALUES (
      p_funcionario_id, p_obra_id, p_data, p_tipo_registro, p_falta_tipo,
      coalesce(p_horas_normais, 0), coalesce(p_horas_extras, 0),
      nullif(btrim(p_justificativa_extras), ''), nullif(btrim(p_observacoes), ''),
      p_tipo_registro = 'falta', auth.uid(), auth.uid()
    )
    RETURNING * INTO v_registro;
  ELSE
    UPDATE public.registros_horas
    SET funcionario_id = p_funcionario_id,
        obra_id = p_obra_id,
        data = p_data,
        tipo_registro = p_tipo_registro,
        falta_tipo = p_falta_tipo,
        horas_normais = coalesce(p_horas_normais, 0),
        horas_extras = coalesce(p_horas_extras, 0),
        justificativa_extras = nullif(btrim(p_justificativa_extras), ''),
        observacoes = nullif(btrim(p_observacoes), ''),
        updated_by = auth.uid()
    WHERE id = p_id
    RETURNING * INTO v_registro;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Registro nao encontrado ou sem permissao.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN v_registro;
END;
$$;

REVOKE ALL ON FUNCTION public.obras_validar_conflito_apontamento_diario(uuid, date, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.obras_salvar_registro_horas(uuid, uuid, uuid, date, text, text, numeric, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_validar_conflito_apontamento_diario(uuid, date, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obras_salvar_registro_horas(uuid, uuid, uuid, date, text, text, numeric, numeric, text, text) TO authenticated;
