-- Resolve salario pela categoria para usuarios sem acesso financeiro e bloqueia
-- novas alocacoes/registros de horas futuros sem tocar dados legados.
-- A restricao positiva anterior era global em uma tabela compartilhada. Mantem
-- salario positivo apenas para o escopo explicito do Obras Control; fora dele,
-- zero continua representando salario nao informado sem consultar tabela salarial.
ALTER TABLE public.funcionarios
  DROP CONSTRAINT IF EXISTS funcionarios_salario_positive;
ALTER TABLE public.funcionarios
  DROP CONSTRAINT IF EXISTS funcionarios_obras_control_salario_positive;
ALTER TABLE public.funcionarios
  ADD CONSTRAINT funcionarios_obras_control_salario_positive
  CHECK (visivel_obras_control IS NOT TRUE OR salario > 0);

CREATE OR REPLACE FUNCTION public.guard_funcionarios_salario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_salario numeric;
  v_encargos numeric;
  v_pode_ver_financeiro boolean := public.can_view_salario(auth.uid());
  v_categoria_alterada boolean := TG_OP = 'INSERT' OR NEW.categoria_mo IS DISTINCT FROM OLD.categoria_mo;
  v_entrou_obras_control boolean := NEW.visivel_obras_control IS TRUE
    AND (TG_OP = 'INSERT' OR OLD.visivel_obras_control IS DISTINCT FROM TRUE);
  v_manutencao_admin boolean := TG_OP = 'UPDATE'
    AND auth.uid() IS NULL
    AND session_user = current_user
    AND current_setting('obras_control.manutencao_salario', true) = 'corrigir_placeholder_v1';
  v_total_correspondencias bigint;
BEGIN
  -- A tabela e compartilhada com o RO Passagens. A regra salarial pertence
  -- exclusivamente a registros marcados explicitamente para o Obras Control.
  IF NEW.visivel_obras_control IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Excecao estreita para a funcao administrativa sem parametros definida
  -- abaixo. Mesmo uma sessao administrativa com o marcador nao pode escolher
  -- valor, funcionario, categoria ou ampliar o universo salario=1.
  IF v_manutencao_admin THEN
    SELECT count(*), min(cs.salario), min(cs.encargos)
      INTO v_total_correspondencias, v_salario, v_encargos
    FROM public.categoria_salarios AS cs
    WHERE cs.categoria = OLD.categoria_mo;

    IF OLD.visivel_obras_control IS TRUE
       AND NEW.visivel_obras_control IS TRUE
       AND OLD.salario = 1::numeric
       AND NEW.categoria_mo IS NOT DISTINCT FROM OLD.categoria_mo
       AND v_total_correspondencias = 1
       AND v_salario > 0
       AND NEW.salario IS NOT DISTINCT FROM v_salario
       AND NEW.encargos IS NOT DISTINCT FROM v_encargos THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Operacao administrativa de salario fora do escopo permitido'
      USING ERRCODE = '42501';
  END IF;

  IF v_categoria_alterada OR v_entrou_obras_control THEN
    SELECT cs.salario, cs.encargos
      INTO v_salario, v_encargos
    FROM public.categoria_salarios AS cs
    WHERE cs.categoria = NEW.categoria_mo;

    IF NOT FOUND OR v_salario IS NULL OR v_salario <= 0 THEN
      RAISE EXCEPTION 'FUNCAO_SEM_SALARIO: Funcao sem salario cadastrado.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT v_pode_ver_financeiro THEN
    IF v_categoria_alterada OR v_entrou_obras_control THEN
      NEW.salario := v_salario;
      NEW.encargos := v_encargos;
    ELSIF NEW.salario IS DISTINCT FROM OLD.salario OR NEW.encargos IS DISTINCT FROM OLD.encargos THEN
      RAISE EXCEPTION 'Apenas gerentes/diretores podem alterar salario ou encargos'
        USING ERRCODE = '42501';
    END IF;
  ELSIF (TG_OP = 'INSERT' OR v_entrou_obras_control)
      AND (NEW.salario IS NULL OR NEW.salario <= 0) THEN
    NEW.salario := v_salario;
    NEW.encargos := v_encargos;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_funcionarios_salario_insert_update ON public.funcionarios;
DROP TRIGGER IF EXISTS guard_funcionarios_salario_update ON public.funcionarios;
CREATE TRIGGER guard_funcionarios_salario_insert_update
  BEFORE INSERT OR UPDATE OF categoria_mo, salario, encargos, visivel_obras_control
  ON public.funcionarios
  FOR EACH ROW EXECUTE FUNCTION public.guard_funcionarios_salario();

REVOKE ALL ON FUNCTION public.guard_funcionarios_salario() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.obras_corrigir_salarios_placeholder()
RETURNS TABLE (
  id uuid,
  nome text,
  categoria_mo text,
  salario_anterior numeric,
  salario_novo numeric,
  encargos_anterior numeric,
  encargos_novo numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  -- O valor e local a transacao e nao e aceito isoladamente pelo guard.
  PERFORM pg_catalog.set_config(
    'obras_control.manutencao_salario',
    'corrigir_placeholder_v1',
    true
  );

  RETURN QUERY
  WITH candidatos AS (
    SELECT
      f.id,
      f.salario AS salario_antes,
      f.encargos AS encargos_antes,
      count(cs.categoria) AS correspondencias,
      min(cs.salario) AS salario_esperado,
      min(cs.encargos) AS encargos_esperados
    FROM public.funcionarios AS f
    LEFT JOIN public.categoria_salarios AS cs ON cs.categoria = f.categoria_mo
    WHERE f.salario = 1::numeric
      AND f.visivel_obras_control IS TRUE
    GROUP BY f.id, f.salario, f.encargos
  ), atualizados AS (
    UPDATE public.funcionarios AS f
       SET salario = c.salario_esperado,
           encargos = c.encargos_esperados
      FROM candidatos AS c
     WHERE f.id = c.id
       AND f.salario = 1::numeric
       AND f.visivel_obras_control IS TRUE
       AND c.correspondencias = 1
       AND c.salario_esperado > 0
    RETURNING
      f.id,
      f.nome,
      f.categoria_mo,
      c.salario_antes,
      f.salario,
      c.encargos_antes,
      f.encargos
  )
  SELECT a.id, a.nome, a.categoria_mo, a.salario_antes, a.salario,
         a.encargos_antes, a.encargos
  FROM atualizados AS a
  ORDER BY a.nome, a.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.obras_corrigir_salarios_placeholder()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.obras_corrigir_salarios_placeholder() TO postgres;

COMMENT ON FUNCTION public.obras_corrigir_salarios_placeholder() IS
  'Manutencao administrativa fechada: corrige somente salario=1 de funcionarios Obras Control pela correspondencia salarial exata.';

CREATE OR REPLACE FUNCTION public.guard_data_lancamento_nao_futura()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.data > current_date THEN
    IF TG_TABLE_NAME = 'registros_horas' THEN
      RAISE EXCEPTION 'DATA_FUTURA_HORAS: Nao e permitido lancar horas em datas futuras.'
        USING ERRCODE = '22007';
    END IF;
    RAISE EXCEPTION 'DATA_FUTURA_ALOCACAO: Nao e permitido lancar alocacoes em datas futuras.'
      USING ERRCODE = '22007';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_data_nao_futura ON public.alocacoes;
CREATE TRIGGER guard_data_nao_futura
  BEFORE INSERT OR UPDATE OF data ON public.alocacoes
  FOR EACH ROW EXECUTE FUNCTION public.guard_data_lancamento_nao_futura();

DROP TRIGGER IF EXISTS guard_data_nao_futura ON public.registros_horas;
CREATE TRIGGER guard_data_nao_futura
  BEFORE INSERT OR UPDATE OF data ON public.registros_horas
  FOR EACH ROW EXECUTE FUNCTION public.guard_data_lancamento_nao_futura();

REVOKE ALL ON FUNCTION public.guard_data_lancamento_nao_futura()
  FROM PUBLIC, anon, authenticated;

-- A RPC de copia valida antes da previa e antes de qualquer escrita. O trigger
-- acima permanece como defesa final para esta e todas as demais rotas.
CREATE OR REPLACE FUNCTION public.obras_validar_destino_copia(p_data_destino date)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_data_destino > current_date THEN
    RAISE EXCEPTION 'DATA_FUTURA_ALOCACAO: Nao e permitido lancar alocacoes em datas futuras.'
      USING ERRCODE = '22007';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.obras_validar_destino_copia(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_validar_destino_copia(date) TO authenticated;

COMMENT ON FUNCTION public.guard_funcionarios_salario() IS
  'Somente para visivel_obras_control=true, resolve salario/encargos pela categoria para perfis nao financeiros e preserva override de gerente/diretor.';
COMMENT ON FUNCTION public.guard_data_lancamento_nao_futura() IS
  'Impede INSERT/UPDATE futuro em alocacoes e registros_horas sem validar ou alterar legado.';

-- Mantem a assinatura e as regras aprovadas da copia; acrescenta apenas a
-- rejeicao do destino futuro antes da previa ou aplicacao.
CREATE OR REPLACE FUNCTION public.obras_copiar_dia_anterior(
  p_obra_id uuid, p_data_origem date, p_data_destino date, p_aplicar boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE
  v_usuario uuid := auth.uid();
  v_origem uuid[] := ARRAY[]::uuid[];
  v_existentes uuid[] := ARRAY[]::uuid[];
  v_inelegiveis uuid[] := ARRAY[]::uuid[];
  v_copiados uuid[] := ARRAY[]::uuid[];
  v_itens jsonb;
BEGIN
  PERFORM public.obras_validar_destino_copia(p_data_destino);
  IF v_usuario IS NULL OR public.get_user_level(v_usuario) < 1 THEN
    RAISE EXCEPTION 'Sem permissao para copiar alocacoes.' USING ERRCODE = '42501';
  END IF;
  IF p_data_origem >= p_data_destino THEN
    RAISE EXCEPTION 'A data de origem deve ser anterior a data de destino.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.obras WHERE id = p_obra_id) THEN
    RAISE EXCEPTION 'Centro de custo nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  SELECT coalesce(array_agg(DISTINCT a.funcionario_id), ARRAY[]::uuid[]) INTO v_origem
  FROM public.alocacoes a WHERE a.obra_id = p_obra_id AND a.data = p_data_origem;
  IF cardinality(v_origem) = 0 THEN
    RAISE EXCEPTION 'Nao ha alocacoes na origem informada.' USING ERRCODE = 'P0002';
  END IF;
  SELECT coalesce(array_agg(f.id), ARRAY[]::uuid[]) INTO v_inelegiveis
  FROM public.obras_control_funcionarios_por_ids(v_origem) f
  LEFT JOIN public.obras_control_funcionarios_safe() s ON s.id = f.id
  WHERE s.id IS NULL OR f.deleted_at IS NOT NULL OR f.visivel_obras_control IS FALSE
    OR (s.data_admissao IS NOT NULL AND s.data_admissao > p_data_destino)
    OR (f.data_desligamento IS NOT NULL AND f.data_desligamento < p_data_destino);
  SELECT coalesce(array_agg(DISTINCT x.funcionario_id), ARRAY[]::uuid[]) INTO v_existentes
  FROM (
    SELECT a.funcionario_id FROM public.alocacoes a
      WHERE a.data = p_data_destino AND a.funcionario_id = ANY(v_origem)
    UNION
    SELECT r.funcionario_id FROM public.registros_horas r
      WHERE r.data = p_data_destino AND r.funcionario_id = ANY(v_origem)
  ) x;
  IF p_aplicar THEN
    WITH inseridas AS (
      INSERT INTO public.alocacoes (funcionario_id, obra_id, data, created_by)
      SELECT unnest(v_origem), p_obra_id, p_data_destino, v_usuario
      EXCEPT SELECT unnest(v_existentes), p_obra_id, p_data_destino, v_usuario
      EXCEPT SELECT unnest(v_inelegiveis), p_obra_id, p_data_destino, v_usuario
      ON CONFLICT DO NOTHING RETURNING funcionario_id
    )
    SELECT coalesce(array_agg(funcionario_id), ARRAY[]::uuid[]) INTO v_copiados FROM inseridas;
    INSERT INTO public.registros_horas (
      funcionario_id, obra_id, data, horas_normais, horas_extras, ausencia,
      justificativa_extras, motivo_ausencia, observacoes, tipo_registro, falta_tipo,
      created_by, updated_by
    )
    SELECT c.funcionario_id, p_obra_id, p_data_destino,
      coalesce((SELECT r.horas_normais FROM public.registros_horas r
        WHERE r.funcionario_id = c.funcionario_id AND r.obra_id = p_obra_id
          AND r.data = p_data_origem AND r.tipo_registro = 'horas'
          AND r.horas_normais > 0 LIMIT 1),
        CASE WHEN extract(isodow FROM p_data_destino) = 5 THEN 8 ELSE 9 END),
      0, false, NULL, NULL, NULL, 'horas', NULL, v_usuario, v_usuario
    FROM unnest(v_copiados) AS c(funcionario_id);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'funcionario_id', f.id, 'nome', f.nome,
    'status', CASE WHEN f.id = ANY(v_copiados) THEN 'copiado'
      WHEN f.id = ANY(v_inelegiveis) THEN 'inelegivel'
      WHEN f.id = ANY(v_existentes) OR p_aplicar THEN 'ja_existente' ELSE 'adicionar' END,
    'motivo', CASE WHEN f.id = ANY(v_inelegiveis) THEN 'Funcionario inelegivel na data destino'
      WHEN f.id = ANY(v_existentes) OR (p_aplicar AND NOT f.id = ANY(v_copiados))
        THEN 'Ja possui lancamento na data destino' ELSE NULL END
  ) ORDER BY f.nome), '[]'::jsonb) INTO v_itens
  FROM public.obras_control_funcionarios_por_ids(v_origem) f;
  RETURN jsonb_build_object(
    'origem_data', p_data_origem, 'destino_data', p_data_destino,
    'total_origem', cardinality(v_origem), 'total_copiados', cardinality(v_copiados),
    'total_ja_existentes', cardinality(v_existentes),
    'total_inelegiveis', cardinality(v_inelegiveis),
    'total_adicionar', CASE WHEN p_aplicar THEN cardinality(v_copiados) ELSE (
      SELECT count(*) FROM unnest(v_origem) AS o(id)
      WHERE NOT o.id = ANY(v_existentes) AND NOT o.id = ANY(v_inelegiveis)
    ) END, 'itens', v_itens);
END;
$function$;

REVOKE ALL ON FUNCTION public.obras_copiar_dia_anterior(uuid, date, date, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_copiar_dia_anterior(uuid, date, date, boolean)
  TO authenticated;
