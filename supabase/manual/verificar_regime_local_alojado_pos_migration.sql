-- VALIDACAO POS-MIGRATION -- SOMENTE LEITURA
-- Nao chama definir_regime_funcionarios e nao cria, altera ou remove dados.

-- 1. Migration registrada.
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version = '20260821120817';

-- 2. Existencia, RLS e privilegios da tabela.
SELECT
  to_regclass('public.funcionario_regime_vigencias') IS NOT NULL AS tabela_existe,
  c.relrowsecurity AS rls_habilitado,
  c.relforcerowsecurity AS rls_forcado
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'funcionario_regime_vigencias';

SELECT
  has_table_privilege('anon', 'public.funcionario_regime_vigencias', 'SELECT') AS anon_select,
  has_table_privilege('authenticated', 'public.funcionario_regime_vigencias', 'SELECT')
    AS authenticated_select,
  has_table_privilege('authenticated', 'public.funcionario_regime_vigencias', 'INSERT')
    AS authenticated_insert_direto,
  has_table_privilege('authenticated', 'public.funcionario_regime_vigencias', 'UPDATE')
    AS authenticated_update_direto,
  has_table_privilege('authenticated', 'public.funcionario_regime_vigencias', 'DELETE')
    AS authenticated_delete_direto,
  has_table_privilege('service_role', 'public.funcionario_regime_vigencias', 'SELECT,INSERT,UPDATE,DELETE')
    AS service_role_all;

SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'funcionario_regime_vigencias'
ORDER BY policyname;

-- 3. Constraints de dominio, unicidade e nao sobreposicao.
SELECT conname, contype, pg_get_constraintdef(oid, true) AS definition
FROM pg_constraint
WHERE conrelid = 'public.funcionario_regime_vigencias'::regclass
ORDER BY conname;

-- 4. Assinatura, ACL e corpo da RPC de escrita (sem executa-la).
SELECT
  p.oid::regprocedure::text AS assinatura,
  p.prosecdef AS security_definer,
  p.provolatile,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) AS public_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  pg_get_function_result(p.oid) AS retorno,
  pg_get_functiondef(p.oid) LIKE '%FOR UPDATE%' AS bloqueia_funcionarios,
  pg_get_functiondef(p.oid) LIKE '%FOREACH v_funcionario_id IN ARRAY%' AS processa_lote,
  pg_get_functiondef(p.oid) LIKE '%fc.fechada AND fc.data_fim >= p_vigencia_inicio%'
    AS protege_competencia_fechada,
  pg_get_functiondef(p.oid) LIKE '%vigencia_fim = p_vigencia_inicio - 1%'
    AS encerra_vigencia_anterior
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'definir_regime_funcionarios';

-- 5. RPC server-side que fornece ultimo CC anterior e mudancas do periodo.
SELECT
  p.oid::regprocedure::text AS assinatura,
  NOT p.prosecdef AS security_invoker,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) AS public_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  pg_get_functiondef(p.oid) LIKE '%DISTINCT ON (a.funcionario_id)%' AS traz_ultimo_anterior,
  pg_get_functiondef(p.oid) LIKE '%a.data < p_inicio%' AS limita_anterior,
  pg_get_functiondef(p.oid) LIKE '%a.data BETWEEN p_inicio AND p_fim%' AS traz_mudancas_periodo
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'obras_control_alocacoes_referencia_regime';

-- 6. Contrato da fonte segura usada por Funcionarios.
SELECT
  p.oid::regprocedure::text AS assinatura,
  pg_get_function_result(p.oid) AS retorno,
  pg_get_function_result(p.oid) ILIKE '%regime text%' AS retorna_regime,
  pg_get_function_result(p.oid) ILIKE '%regime_vigencia_inicio date%'
    AS retorna_inicio_vigencia,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'obras_control_funcionarios_safe';

-- 7. Perfil agregado dos dados, sem nomes ou IDs pessoais.
SELECT regime, count(*) AS vigencias
FROM public.funcionario_regime_vigencias
GROUP BY regime
ORDER BY regime;

SELECT
  count(*) AS funcionarios_visiveis,
  count(*) FILTER (WHERE rv.funcionario_id IS NULL) AS nao_informado,
  count(*) FILTER (WHERE rv.regime = 'local') AS local,
  count(*) FILTER (WHERE rv.regime = 'alojado') AS alojado
FROM public.funcionarios f
LEFT JOIN LATERAL (
  SELECT r.funcionario_id, r.regime
  FROM public.funcionario_regime_vigencias r
  WHERE r.funcionario_id = f.id
    AND current_date BETWEEN r.vigencia_inicio AND COALESCE(r.vigencia_fim, 'infinity'::date)
  ORDER BY r.vigencia_inicio DESC
  LIMIT 1
) rv ON true
WHERE f.deleted_at IS NULL
  AND f.visivel_obras_control IS NOT FALSE;

-- 8. Sanidade dos historicos existentes.
SELECT
  count(*) FILTER (WHERE vigencia_fim IS NULL) AS vigencias_abertas,
  count(DISTINCT funcionario_id) FILTER (WHERE vigencia_fim IS NULL) AS funcionarios_com_aberta,
  count(*) FILTER (WHERE vigencia_fim < vigencia_inicio) AS periodos_invertidos
FROM public.funcionario_regime_vigencias;

SELECT count(*) AS sobreposicoes
FROM public.funcionario_regime_vigencias a
JOIN public.funcionario_regime_vigencias b
  ON b.funcionario_id = a.funcionario_id
 AND b.id > a.id
 AND daterange(a.vigencia_inicio, COALESCE(a.vigencia_fim, 'infinity'::date), '[]')
     && daterange(b.vigencia_inicio, COALESCE(b.vigencia_fim, 'infinity'::date), '[]');
