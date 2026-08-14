BEGIN;

CREATE TEMP TABLE salarios_um_antes ON COMMIT DROP AS
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

-- DDL temporario fiel a migration ainda nao aplicada. O ROLLBACK final restaura
-- integralmente a funcao/trigger anteriores e remove a funcao administrativa.
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
  IF NEW.visivel_obras_control IS NOT TRUE THEN
    RETURN NEW;
  END IF;

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

CREATE TEMP TABLE salarios_um_corrigidos ON COMMIT DROP AS
SELECT * FROM public.obras_corrigir_salarios_placeholder();

SELECT id, nome, categoria_mo, salario_anterior, salario_novo,
       encargos_anterior, encargos_novo
FROM salarios_um_corrigidos
ORDER BY nome, id;

SELECT a.id, a.nome, a.categoria_mo, a.salario_anterior, a.salario_esperado,
       CASE WHEN a.correspondencias = 0 OR a.salario_esperado IS NULL OR a.salario_esperado <= 0
         THEN 'SEM_CORRESPONDENCIA' ELSE 'AMBIGUO' END AS situacao
FROM salarios_um_antes a LEFT JOIN salarios_um_corrigidos c USING (id)
WHERE c.id IS NULL
ORDER BY situacao, a.nome, a.id;

SELECT count(*) AS candidatos, count(c.id) AS corrigidos,
       count(*) FILTER (WHERE c.id IS NULL) AS nao_alterados
FROM salarios_um_antes a LEFT JOIN salarios_um_corrigidos c USING (id);

SELECT count(*) AS alteracoes_fora_do_escopo
FROM fora_escopo_antes a JOIN public.funcionarios f USING (id)
WHERE f.categoria_mo IS DISTINCT FROM a.categoria_mo
   OR f.visivel_obras_control IS DISTINCT FROM a.visivel_obras_control
   OR f.salario IS DISTINCT FROM a.salario
   OR f.encargos IS DISTINCT FROM a.encargos;

SELECT count(*) AS correcoes_invalidas
FROM salarios_um_corrigidos c
JOIN salarios_um_antes a USING (id)
JOIN public.funcionarios f USING (id)
WHERE a.salario_anterior <> 1::numeric
   OR f.visivel_obras_control IS NOT TRUE
   OR f.categoria_mo IS DISTINCT FROM a.categoria_mo
   OR f.salario IS DISTINCT FROM a.salario_esperado
   OR f.encargos IS DISTINCT FROM a.encargos_esperados
   OR a.correspondencias <> 1
   OR a.salario_esperado <= 0;

SELECT count(*) AS nao_corrigidos_que_foram_alterados
FROM salarios_um_antes a
LEFT JOIN salarios_um_corrigidos c USING (id)
JOIN public.funcionarios f USING (id)
WHERE c.id IS NULL
  AND (f.categoria_mo IS DISTINCT FROM a.categoria_mo
    OR f.visivel_obras_control IS NOT TRUE
    OR f.salario IS DISTINCT FROM a.salario_anterior
    OR f.encargos IS DISTINCT FROM a.encargos_anterior);

-- ACL da funcao criada nesta mesma transacao. PUBLIC e verificado pelo grantee
-- pseudo-role 0, nunca pelo helper de privilegio aplicado ao pseudo-role PUBLIC.
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
  WHERE n.nspname = 'public' AND p.proname = 'obras_corrigir_salarios_placeholder';

  IF v_public_execute
     OR has_function_privilege('anon', 'public.obras_corrigir_salarios_placeholder()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.obras_corrigir_salarios_placeholder()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.obras_corrigir_salarios_placeholder()', 'EXECUTE')
     OR NOT has_function_privilege('postgres', 'public.obras_corrigir_salarios_placeholder()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL invalida para obras_corrigir_salarios_placeholder';
  END IF;
END;
$acl_test$;

ROLLBACK;
