BEGIN;

CREATE TEMP TABLE candidatos_salario_antes ON COMMIT DROP AS
SELECT f.id, f.nome, f.categoria_mo, f.salario AS salario_anterior,
       f.encargos AS encargos_anterior, count(cs.categoria) AS correspondencias,
       min(cs.salario) AS salario_esperado, min(cs.encargos) AS encargos_esperados
FROM public.funcionarios f
LEFT JOIN public.categoria_salarios cs ON cs.categoria = f.categoria_mo
WHERE f.salario = 1::numeric AND f.visivel_obras_control IS TRUE
GROUP BY f.id, f.nome, f.categoria_mo, f.salario, f.encargos;

CREATE TEMP TABLE fora_escopo_antes ON COMMIT DROP AS
SELECT id, categoria_mo, visivel_obras_control, salario, encargos
FROM public.funcionarios
WHERE visivel_obras_control IS NOT TRUE OR salario <> 1::numeric;

CREATE TEMP TABLE legado_futuro_antes ON COMMIT DROP AS
SELECT 'alocacoes'::text AS tabela, id, funcionario_id, obra_id, data
FROM public.alocacoes WHERE data > current_date
UNION ALL
SELECT 'registros_horas'::text, id, funcionario_id, obra_id, data
FROM public.registros_horas WHERE data > current_date;

-- DDL temporario fiel a migration ainda nao aplicada. Todos os objetos abaixo
-- existem apenas nesta transacao e sao restaurados/removidos pelo ROLLBACK final.
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

-- Nenhum objeto novo era pressuposto no baseline. A partir daqui todas as
-- assinaturas precisam existir porque foram criadas nesta mesma transacao.
DO $objetos_test$
BEGIN
  IF to_regprocedure('public.guard_funcionarios_salario()') IS NULL
     OR to_regprocedure('public.obras_corrigir_salarios_placeholder()') IS NULL
     OR to_regprocedure('public.guard_data_lancamento_nao_futura()') IS NULL
     OR to_regprocedure('public.obras_validar_destino_copia(date)') IS NULL
     OR to_regprocedure('public.obras_copiar_dia_anterior(uuid,date,date,boolean)') IS NULL THEN
    RAISE EXCEPTION 'TESTE_FALHOU: assinatura criada pela migration nao encontrada';
  END IF;
END;
$objetos_test$;

-- Exercita o trigger salarial novo sem persistir os dados de prova: cada bloco
-- bem-sucedido termina com uma excecao-sentinela que desfaz sua subtransacao.
DO $salario_automatico_test$
DECLARE
  v_id uuid;
  v_salario numeric;
  v_encargos numeric;
BEGIN
  SELECT f.id, cs.salario, cs.encargos
    INTO v_id, v_salario, v_encargos
  FROM public.funcionarios f
  JOIN public.categoria_salarios cs ON cs.categoria = f.categoria_mo
  WHERE f.visivel_obras_control IS TRUE AND cs.salario > 0
  ORDER BY f.id LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'TESTE_INCONCLUSIVO: sem funcionario Obras/categoria salarial';
  END IF;

  BEGIN
    UPDATE public.funcionarios SET visivel_obras_control = false WHERE id = v_id;
    UPDATE public.funcionarios
       SET salario = 1, encargos = 0, visivel_obras_control = true
     WHERE id = v_id;
    IF NOT EXISTS (
      SELECT 1 FROM public.funcionarios
       WHERE id = v_id
         AND salario IS NOT DISTINCT FROM v_salario
         AND encargos IS NOT DISTINCT FROM v_encargos
    ) THEN
      RAISE EXCEPTION 'TESTE_FALHOU: salario automatico nao aplicou valores canonicos';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'Z0001', MESSAGE = 'rollback da prova salarial';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
  END;
END;
$salario_automatico_test$;

DO $escopo_compartilhado_test$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.funcionarios
   WHERE visivel_obras_control IS NOT TRUE ORDER BY id LIMIT 1;
  IF v_id IS NOT NULL THEN
    BEGIN
      UPDATE public.funcionarios SET salario = salario + 0.01 WHERE id = v_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'TESTE_FALHOU: registro Passagens-only nao encontrado no UPDATE';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'Z0002', MESSAGE = 'rollback da prova Passagens';
    EXCEPTION WHEN SQLSTATE 'Z0002' THEN NULL;
    END;
  END IF;
END;
$escopo_compartilhado_test$;

DO $override_financeiro_test$
DECLARE
  v_usuario uuid;
  v_id uuid;
BEGIN
  SELECT user_id INTO v_usuario FROM public.user_roles
   WHERE role IN ('gerente', 'diretor') ORDER BY user_id LIMIT 1;
  SELECT id INTO v_id FROM public.funcionarios
   WHERE visivel_obras_control IS TRUE ORDER BY id LIMIT 1;
  IF v_usuario IS NOT NULL AND v_id IS NOT NULL THEN
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_usuario::text, true);
      UPDATE public.funcionarios SET salario = salario + 0.01 WHERE id = v_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'TESTE_FALHOU: override financeiro nao atingiu funcionario';
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'Z0003', MESSAGE = 'rollback da prova financeira';
    EXCEPTION WHEN SQLSTATE 'Z0003' THEN NULL;
    END;
    PERFORM set_config('request.jwt.claim.sub', '', true);
  END IF;
END;
$override_financeiro_test$;

CREATE TEMP TABLE salarios_corrigidos ON COMMIT DROP AS
SELECT * FROM public.obras_corrigir_salarios_placeholder();

SELECT id, nome, categoria_mo, salario_anterior, salario_novo,
       encargos_anterior, encargos_novo
FROM salarios_corrigidos
ORDER BY nome, id;

SELECT a.id, a.nome, a.categoria_mo, a.salario_anterior, a.salario_esperado,
       CASE
         WHEN a.correspondencias = 0 OR a.salario_esperado IS NULL OR a.salario_esperado <= 0
           THEN 'SEM_CORRESPONDENCIA'
         ELSE 'AMBIGUO'
       END AS situacao
FROM candidatos_salario_antes a
LEFT JOIN salarios_corrigidos c USING (id)
WHERE c.id IS NULL
ORDER BY situacao, a.nome, a.id;

SELECT count(*) AS alteracoes_fora_do_escopo
FROM fora_escopo_antes a
JOIN public.funcionarios f USING (id)
WHERE f.categoria_mo IS DISTINCT FROM a.categoria_mo
   OR f.visivel_obras_control IS DISTINCT FROM a.visivel_obras_control
   OR f.salario IS DISTINCT FROM a.salario
   OR f.encargos IS DISTINCT FROM a.encargos;

SELECT count(*) AS corrigidos_que_nao_eram_obras_salario_um
FROM salarios_corrigidos c
LEFT JOIN candidatos_salario_antes a USING (id)
WHERE a.id IS NULL;

-- ACL: somente postgres pode executar a manutencao. PUBLIC e verificado por
-- aclexplode/grantee=0, sem tratar PUBLIC como uma role real.
SELECT
  coalesce(bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'), false)
    AS public_possui_execute,
  has_function_privilege('anon', 'public.obras_corrigir_salarios_placeholder()', 'EXECUTE')
    AS anon_possui_execute,
  has_function_privilege('authenticated', 'public.obras_corrigir_salarios_placeholder()', 'EXECUTE')
    AS authenticated_possui_execute,
  has_function_privilege('service_role', 'public.obras_corrigir_salarios_placeholder()', 'EXECUTE')
    AS service_role_possui_execute,
  has_function_privilege('postgres', 'public.obras_corrigir_salarios_placeholder()', 'EXECUTE')
    AS postgres_possui_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl ON true
WHERE n.nspname = 'public' AND p.proname = 'obras_corrigir_salarios_placeholder'
GROUP BY p.oid;

DO $acl_test$
DECLARE
  v_public_execute boolean;
BEGIN
  SELECT coalesce(bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'), false)
    INTO v_public_execute
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl ON true
  WHERE n.nspname = 'public'
    AND p.proname = 'obras_corrigir_salarios_placeholder';

  IF v_public_execute
     OR has_function_privilege('anon', 'public.obras_corrigir_salarios_placeholder()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.obras_corrigir_salarios_placeholder()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.obras_corrigir_salarios_placeholder()', 'EXECUTE')
     OR NOT has_function_privilege('postgres', 'public.obras_corrigir_salarios_placeholder()', 'EXECUTE') THEN
    RAISE EXCEPTION 'TESTE_FALHOU: ACL invalida na manutencao salarial';
  END IF;
END;
$acl_test$;

-- Um papel comum continua sem conseguir alterar salario arbitrariamente.
DO $test$
DECLARE
  v_id uuid;
  v_linhas bigint := 0;
BEGIN
  SELECT f.id INTO v_id
  FROM public.funcionarios f
  WHERE f.visivel_obras_control IS TRUE
  ORDER BY f.id LIMIT 1;

  IF v_id IS NOT NULL THEN
    BEGIN
      EXECUTE 'SET LOCAL ROLE authenticated';
      UPDATE public.funcionarios SET salario = salario + 123.45 WHERE id = v_id;
      GET DIAGNOSTICS v_linhas = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      v_linhas := 0;
    END;
    EXECUTE 'RESET ROLE';
    IF v_linhas > 0 THEN
      RAISE EXCEPTION 'TESTE_FALHOU: authenticated alterou salario arbitrariamente';
    END IF;
  END IF;
END;
$test$;


-- Falha o dry-run se a manutencao corrigir algo fora das regras aprovadas ou
-- deixar de preservar categoria/visibilidade e os candidatos sem match exato.
DO $salario_test$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM salarios_corrigidos c
    JOIN candidatos_salario_antes a USING (id)
    JOIN public.funcionarios f USING (id)
    WHERE a.salario_anterior <> 1::numeric
       OR f.visivel_obras_control IS NOT TRUE
       OR f.categoria_mo IS DISTINCT FROM a.categoria_mo
       OR f.salario IS DISTINCT FROM a.salario_esperado
       OR f.encargos IS DISTINCT FROM a.encargos_esperados
       OR a.correspondencias <> 1
       OR a.salario_esperado <= 0
  ) OR EXISTS (
    SELECT 1
    FROM candidatos_salario_antes a
    LEFT JOIN salarios_corrigidos c USING (id)
    JOIN public.funcionarios f USING (id)
    WHERE c.id IS NULL
      AND (f.categoria_mo IS DISTINCT FROM a.categoria_mo
        OR f.visivel_obras_control IS NOT TRUE
        OR f.salario IS DISTINCT FROM a.salario_anterior
        OR f.encargos IS DISTINCT FROM a.encargos_anterior)
  ) OR EXISTS (
    SELECT 1
    FROM fora_escopo_antes a
    JOIN public.funcionarios f USING (id)
    WHERE f.categoria_mo IS DISTINCT FROM a.categoria_mo
       OR f.visivel_obras_control IS DISTINCT FROM a.visivel_obras_control
       OR f.salario IS DISTINCT FROM a.salario
       OR f.encargos IS DISTINCT FROM a.encargos
  ) THEN
    RAISE EXCEPTION 'TESTE_FALHOU: correcao salarial alterou registro fora do escopo';
  END IF;
END;
$salario_test$;

-- Testes efetivos do trigger de data usando copias de linhas validas existentes.
-- Cada tentativa futura fica em subtransacao e deve falhar com SQLSTATE 22007.
DO $datas_permitidas$
DECLARE
  v_tabela text;
  v_alvo date;
  v_id uuid;
  v_data_original date;
  v_linhas bigint;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY['alocacoes', 'registros_horas'] LOOP
    FOREACH v_alvo IN ARRAY ARRAY[current_date - 1, current_date] LOOP
      EXECUTE format(
        'SELECT x.id, x.data
           FROM public.%I x
          WHERE x.data <= current_date
            AND NOT EXISTS (
              SELECT 1 FROM public.%I d
               WHERE d.funcionario_id = x.funcionario_id
                 AND d.obra_id = x.obra_id
                 AND d.data = $1
                 AND d.id <> x.id
            )
          ORDER BY x.data DESC, x.id LIMIT 1',
        v_tabela, v_tabela
      ) INTO v_id, v_data_original USING v_alvo;

      IF v_id IS NULL THEN
        RAISE EXCEPTION 'TESTE_INCONCLUSIVO: sem linha segura em % para testar %',
          v_tabela, v_alvo;
      END IF;

      EXECUTE format('UPDATE public.%I SET data = $1 WHERE id = $2', v_tabela)
        USING v_alvo, v_id;
      GET DIAGNOSTICS v_linhas = ROW_COUNT;
      IF v_linhas <> 1 THEN
        RAISE EXCEPTION 'TESTE_FALHOU: % nao aceitou data permitida %',
          v_tabela, v_alvo;
      END IF;

      EXECUTE format('UPDATE public.%I SET data = $1 WHERE id = $2', v_tabela)
        USING v_data_original, v_id;
      v_id := NULL;
    END LOOP;
  END LOOP;
END;
$datas_permitidas$;

DO $data_test$
DECLARE
  v_linhas bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.alocacoes WHERE data <= current_date) THEN
    RAISE EXCEPTION 'TESTE_INCONCLUSIVO: nao ha alocacao base para testar INSERT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.registros_horas WHERE data <= current_date) THEN
    RAISE EXCEPTION 'TESTE_INCONCLUSIVO: nao ha registro de horas base para testar INSERT';
  END IF;

  UPDATE public.alocacoes SET data = data
  WHERE id = (SELECT id FROM public.alocacoes WHERE data <= current_date ORDER BY data DESC, id LIMIT 1);
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  IF v_linhas <> 1 THEN RAISE EXCEPTION 'TESTE_FALHOU: UPDATE permitido de alocacao'; END IF;

  UPDATE public.registros_horas SET data = data
  WHERE id = (SELECT id FROM public.registros_horas WHERE data <= current_date ORDER BY data DESC, id LIMIT 1);
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  IF v_linhas <> 1 THEN RAISE EXCEPTION 'TESTE_FALHOU: UPDATE permitido de horas'; END IF;

  BEGIN
    UPDATE public.alocacoes SET data = current_date + 1
    WHERE id = (SELECT id FROM public.alocacoes WHERE data <= current_date ORDER BY data DESC, id LIMIT 1);
    RAISE EXCEPTION 'TESTE_FALHOU: UPDATE futuro de alocacao foi aceito';
  EXCEPTION WHEN SQLSTATE '22007' THEN NULL;
  END;

  BEGIN
    UPDATE public.registros_horas SET data = current_date + 1
    WHERE id = (SELECT id FROM public.registros_horas WHERE data <= current_date ORDER BY data DESC, id LIMIT 1);
    RAISE EXCEPTION 'TESTE_FALHOU: UPDATE futuro de horas foi aceito';
  EXCEPTION WHEN SQLSTATE '22007' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.alocacoes
    SELECT (jsonb_populate_record(
      NULL::public.alocacoes,
      to_jsonb(a) || jsonb_build_object('id', gen_random_uuid(), 'data', current_date + 1)
    )).*
    FROM public.alocacoes a WHERE a.data <= current_date ORDER BY a.data DESC, a.id LIMIT 1;
    RAISE EXCEPTION 'TESTE_FALHOU: INSERT futuro de alocacao foi aceito';
  EXCEPTION WHEN SQLSTATE '22007' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.registros_horas
    SELECT (jsonb_populate_record(
      NULL::public.registros_horas,
      to_jsonb(r) || jsonb_build_object('id', gen_random_uuid(), 'data', current_date + 1)
    )).*
    FROM public.registros_horas r WHERE r.data <= current_date ORDER BY r.data DESC, r.id LIMIT 1;
    RAISE EXCEPTION 'TESTE_FALHOU: INSERT futuro de horas foi aceito';
  EXCEPTION WHEN SQLSTATE '22007' THEN NULL;
  END;
END;
$data_test$;

-- A RPC aprovada deve rejeitar destino futuro antes de consultar a obra.
DO $test$
BEGIN
  -- Hoje passa pela validacao de data e segue a regra normal de autorizacao.
  BEGIN
    PERFORM public.obras_copiar_dia_anterior(
      '00000000-0000-0000-0000-000000000000'::uuid,
      current_date - 1,
      current_date,
      false
    );
    RAISE EXCEPTION 'TESTE_FALHOU: chamada sem usuario deveria ser recusada';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;

  -- Amanha e rejeitado pela data antes mesmo da autorizacao/consulta da obra.
  BEGIN
    PERFORM public.obras_copiar_dia_anterior(
      '00000000-0000-0000-0000-000000000000'::uuid,
      current_date,
      current_date + 1,
      false
    );
    RAISE EXCEPTION 'TESTE_FALHOU: copia aceitou data futura';
  EXCEPTION WHEN SQLSTATE '22007' THEN
    NULL;
  END;
END;
$test$;

SELECT count(*) AS datas_futuras_legadas_antes FROM legado_futuro_antes;

DO $legado_test$
BEGIN
  IF EXISTS (
    (SELECT tabela, id, funcionario_id, obra_id, data FROM legado_futuro_antes
       WHERE tabela = 'alocacoes'
     EXCEPT
     SELECT 'alocacoes', id, funcionario_id, obra_id, data
       FROM public.alocacoes WHERE data > current_date)
    UNION ALL
    (SELECT 'alocacoes', id, funcionario_id, obra_id, data
       FROM public.alocacoes WHERE data > current_date
     EXCEPT
     SELECT tabela, id, funcionario_id, obra_id, data FROM legado_futuro_antes
       WHERE tabela = 'alocacoes')
  ) OR EXISTS (
    (SELECT tabela, id, funcionario_id, obra_id, data FROM legado_futuro_antes
       WHERE tabela = 'registros_horas'
     EXCEPT
     SELECT 'registros_horas', id, funcionario_id, obra_id, data
       FROM public.registros_horas WHERE data > current_date)
    UNION ALL
    (SELECT 'registros_horas', id, funcionario_id, obra_id, data
       FROM public.registros_horas WHERE data > current_date
     EXCEPT
     SELECT tabela, id, funcionario_id, obra_id, data FROM legado_futuro_antes
       WHERE tabela = 'registros_horas')
  ) THEN
    RAISE EXCEPTION 'TESTE_FALHOU: registros futuros legados foram alterados';
  END IF;
END;
$legado_test$;

ROLLBACK;
