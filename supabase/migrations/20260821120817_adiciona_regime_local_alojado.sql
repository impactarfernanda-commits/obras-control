-- Regimes operacionais sao historicos independentes das vigencias financeiras.
CREATE TABLE public.funcionario_regime_vigencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE RESTRICT,
  regime text NOT NULL CHECK (regime IN ('local', 'alojado')),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  origem text NOT NULL CHECK (origem IN ('cadastro', 'edicao', 'lote')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE (funcionario_id, vigencia_inicio),
  EXCLUDE USING gist (
    funcionario_id WITH =,
    daterange(vigencia_inicio, COALESCE(vigencia_fim, 'infinity'::date), '[]') WITH &&
  )
);

CREATE INDEX funcionario_regime_vigencias_busca_idx
  ON public.funcionario_regime_vigencias (funcionario_id, vigencia_inicio DESC);

ALTER TABLE public.funcionario_regime_vigencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.funcionario_regime_vigencias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.funcionario_regime_vigencias TO authenticated;
GRANT ALL ON public.funcionario_regime_vigencias TO service_role;

CREATE POLICY "Internos consultam historico de regime"
  ON public.funcionario_regime_vigencias FOR SELECT TO authenticated
  USING (public.get_user_level((SELECT auth.uid())) >= 1);

-- Para cada funcionario com regime no periodo, retorna somente a ultima
-- alocacao anterior ao inicio e as mudancas de CC ocorridas dentro do periodo.
-- A apuracao carrega a ultima referencia para frente; ela nunca antecipa um CC.
CREATE OR REPLACE FUNCTION public.obras_control_alocacoes_referencia_regime(
  p_inicio date,
  p_fim date
) RETURNS TABLE (funcionario_id uuid, obra_id uuid, data date)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  WITH funcionarios_regime AS (
    SELECT DISTINCT rv.funcionario_id
    FROM public.funcionario_regime_vigencias rv
    WHERE rv.vigencia_inicio <= p_fim
      AND (rv.vigencia_fim IS NULL OR rv.vigencia_fim >= p_inicio)
  ),
  anterior AS (
    SELECT DISTINCT ON (a.funcionario_id)
      a.funcionario_id, a.obra_id, a.data
    FROM public.alocacoes a
    JOIN funcionarios_regime fr ON fr.funcionario_id = a.funcionario_id
    WHERE a.data < p_inicio
    ORDER BY a.funcionario_id, a.data DESC
  ),
  periodo AS (
    SELECT a.funcionario_id, a.obra_id, a.data
    FROM public.alocacoes a
    JOIN funcionarios_regime fr ON fr.funcionario_id = a.funcionario_id
    WHERE a.data BETWEEN p_inicio AND p_fim
  )
  SELECT * FROM anterior
  UNION ALL
  SELECT * FROM periodo
  ORDER BY funcionario_id, data;
$function$;

REVOKE ALL ON FUNCTION public.obras_control_alocacoes_referencia_regime(date,date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obras_control_alocacoes_referencia_regime(date,date)
  TO service_role;

COMMENT ON FUNCTION public.obras_control_alocacoes_referencia_regime(date,date) IS
  'Retorna a ultima alocacao anterior e as alocacoes do periodo para atribuir dias corridos de Alojado ao ultimo CC conhecido.';

CREATE OR REPLACE FUNCTION public.definir_regime_funcionarios(
  p_funcionario_ids uuid[],
  p_regime text,
  p_vigencia_inicio date,
  p_origem text DEFAULT 'edicao'
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_funcionario_id uuid;
  v_proxima_vigencia date;
  v_total integer;
BEGIN
  IF auth.uid() IS NULL OR public.get_user_level(auth.uid()) < 1 THEN
    RAISE EXCEPTION 'Sem permissao para definir regime.' USING ERRCODE = '42501';
  END IF;
  IF p_funcionario_ids IS NULL OR cardinality(p_funcionario_ids) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um funcionario.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_funcionario_ids) > 500 THEN
    RAISE EXCEPTION 'O lote permite no maximo 500 funcionarios.' USING ERRCODE = '22023';
  END IF;
  IF p_regime NOT IN ('local', 'alojado') THEN
    RAISE EXCEPTION 'Regime invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_vigencia_inicio IS NULL OR p_vigencia_inicio > current_date THEN
    RAISE EXCEPTION 'A vigencia deve ser informada e nao pode ser futura.' USING ERRCODE = '22023';
  END IF;
  IF p_origem NOT IN ('cadastro', 'edicao', 'lote') THEN
    RAISE EXCEPTION 'Origem de regime invalida.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_funcionario_ids) <> (
    SELECT count(DISTINCT id) FROM unnest(p_funcionario_ids) AS ids(id)
  ) THEN
    RAISE EXCEPTION 'A lista de funcionarios contem duplicidades.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.funcionarios f
  WHERE f.id = ANY(p_funcionario_ids)
    AND f.deleted_at IS NULL
    AND f.visivel_obras_control IS NOT FALSE;
  IF v_total <> cardinality(p_funcionario_ids) THEN
    RAISE EXCEPTION 'Funcionario inexistente, excluido ou fora do Obras Control.' USING ERRCODE = 'P0002';
  END IF;

  -- Bloqueia o conjunto inteiro antes da primeira escrita e serializa lotes concorrentes.
  PERFORM f.id
  FROM public.funcionarios f
  WHERE f.id = ANY(p_funcionario_ids)
  ORDER BY f.id
  FOR UPDATE;

  -- Uma nova vigencia nao pode reclassificar nenhum dia de competencia fechada.
  IF EXISTS (
    SELECT 1
    FROM public.fechamentos_competencia fc
    WHERE fc.fechada AND fc.data_fim >= p_vigencia_inicio
  ) THEN
    RAISE EXCEPTION 'Competencia fechada nao permite alterar o regime no periodo informado.'
      USING ERRCODE = '23514';
  END IF;

  FOREACH v_funcionario_id IN ARRAY p_funcionario_ids LOOP
    SELECT min(vigencia_inicio) INTO v_proxima_vigencia
    FROM public.funcionario_regime_vigencias
    WHERE funcionario_id = v_funcionario_id
      AND vigencia_inicio > p_vigencia_inicio;

    DELETE FROM public.funcionario_regime_vigencias
    WHERE funcionario_id = v_funcionario_id
      AND vigencia_inicio = p_vigencia_inicio;

    UPDATE public.funcionario_regime_vigencias
    SET vigencia_fim = p_vigencia_inicio - 1
    WHERE funcionario_id = v_funcionario_id
      AND vigencia_inicio < p_vigencia_inicio
      AND (vigencia_fim IS NULL OR vigencia_fim >= p_vigencia_inicio);

    INSERT INTO public.funcionario_regime_vigencias (
      funcionario_id, regime, vigencia_inicio, vigencia_fim, origem, created_by
    ) VALUES (
      v_funcionario_id, p_regime, p_vigencia_inicio,
      CASE WHEN v_proxima_vigencia IS NULL THEN NULL ELSE v_proxima_vigencia - 1 END,
      p_origem, auth.uid()
    );
  END LOOP;

  RETURN cardinality(p_funcionario_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.definir_regime_funcionarios(uuid[],text,date,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_regime_funcionarios(uuid[],text,date,text)
  TO authenticated, service_role;

-- Acrescenta o regime vigente a fonte segura ja usada pela tela Funcionarios.
DROP FUNCTION IF EXISTS public.obras_control_funcionarios_safe();
CREATE FUNCTION public.obras_control_funcionarios_safe()
RETURNS TABLE (
  id uuid,
  nome text,
  categoria_mo text,
  ativo boolean,
  created_at timestamptz,
  data_admissao date,
  data_desligamento date,
  deleted_at timestamptz,
  deleted_by uuid,
  salario numeric,
  encargos numeric,
  visivel_obras_control boolean,
  regime text,
  regime_vigencia_inicio date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $function$
  SELECT
    f.id, f.nome, f.categoria_mo, f.ativo, f.created_at,
    f.data_admissao, f.data_desligamento, f.deleted_at, f.deleted_by,
    CASE WHEN public.can_view_salario(auth.uid()) THEN f.salario ELSE NULL END,
    CASE WHEN public.can_view_salario(auth.uid()) THEN f.encargos ELSE NULL END,
    f.visivel_obras_control,
    rv.regime,
    rv.vigencia_inicio
  FROM public.funcionarios AS f
  LEFT JOIN LATERAL (
    SELECT r.regime, r.vigencia_inicio
    FROM public.funcionario_regime_vigencias r
    WHERE r.funcionario_id = f.id
      AND current_date BETWEEN r.vigencia_inicio AND COALESCE(r.vigencia_fim, 'infinity'::date)
    ORDER BY r.vigencia_inicio DESC
    LIMIT 1
  ) rv ON true
  WHERE auth.uid() IS NOT NULL
    AND f.visivel_obras_control IS DISTINCT FROM false
  ORDER BY f.nome;
$function$;

REVOKE ALL ON FUNCTION public.obras_control_funcionarios_safe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_control_funcionarios_safe() TO authenticated, service_role;
