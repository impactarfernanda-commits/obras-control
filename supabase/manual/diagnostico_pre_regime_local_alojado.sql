-- DRY-RUN SOMENTE LEITURA
-- Objetivo: confirmar a estrutura real antes de implementar Local/Alojado com
-- vigencia, historico, carga em lote, alertas e integracao de custos.
-- Este arquivo nao cria, altera nem remove objetos ou dados.

-- 1. Versoes locais relevantes que constam no historico do banco.
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version IN ('20260814174317', '20260818120000', '20260818121000', '20260819120000')
ORDER BY version;

-- 2. Colunas atuais das entidades que participarao da solucao.
SELECT table_schema, table_name, ordinal_position, column_name, data_type,
       udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'funcionarios',
    'funcionario_custos_vigencias',
    'alocacoes',
    'registros_horas',
    'fechamentos_competencia'
  )
ORDER BY table_name, ordinal_position;

-- 3. Views e funcoes que expoem funcionarios ao frontend/servidor.
SELECT n.nspname AS schema_name, c.relname AS object_name,
       CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' END AS object_type,
       pg_get_viewdef(c.oid, true) AS definition
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('v', 'm')
  AND pg_get_viewdef(c.oid, true) ILIKE '%funcionari%'
ORDER BY c.relname;

SELECT n.nspname AS schema_name,
       p.proname,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS result_type,
       p.prosecdef AS security_definer,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND (
    p.proname ILIKE '%funcionario%'
    OR pg_get_functiondef(p.oid) ILIKE '%funcionario_custos_vigencias%'
  )
ORDER BY p.proname, arguments;

-- 4. Constraints e indices atuais, necessários para desenhar vigencias sem sobreposicao.
SELECT conrelid::regclass AS table_name, conname, contype,
       pg_get_constraintdef(oid, true) AS definition
FROM pg_constraint
WHERE conrelid IN (
  'public.funcionarios'::regclass,
  'public.funcionario_custos_vigencias'::regclass,
  'public.alocacoes'::regclass,
  'public.registros_horas'::regclass
)
ORDER BY conrelid::regclass::text, conname;

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('funcionarios', 'funcionario_custos_vigencias', 'alocacoes', 'registros_horas')
ORDER BY tablename, indexname;

-- 5. RLS, politicas e privilegios das tabelas financeiras/funcionais.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('funcionarios', 'funcionario_custos_vigencias')
ORDER BY c.relname;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('funcionarios', 'funcionario_custos_vigencias')
ORDER BY tablename, policyname;

SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('funcionarios', 'funcionario_custos_vigencias')
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

-- 6. Perfil agregado dos dados, sem nomes, IDs ou outros dados pessoais.
SELECT
  count(*) AS total_funcionarios,
  count(*) FILTER (WHERE ativo AND deleted_at IS NULL) AS ativos,
  count(*) FILTER (WHERE data_admissao IS NULL) AS sem_data_admissao,
  min(data_admissao) AS primeira_admissao,
  max(data_admissao) AS ultima_admissao
FROM public.funcionarios
WHERE visivel_obras_control IS NOT FALSE;

SELECT
  count(*) AS total_vigencias_custo,
  count(DISTINCT funcionario_id) AS funcionarios_com_vigencia,
  count(*) FILTER (WHERE vigencia_fim IS NULL) AS vigencias_abertas,
  min(vigencia_inicio) AS primeira_vigencia,
  max(vigencia_inicio) AS ultima_vigencia
FROM public.funcionario_custos_vigencias;

SELECT
  count(*) AS funcionarios_visiveis_sem_vigencia_custo
FROM public.funcionarios f
WHERE f.visivel_obras_control IS NOT FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM public.funcionario_custos_vigencias v
    WHERE v.funcionario_id = f.id
  );

-- 7. Cobertura temporal dos fatos usados nas duas regras de custo.
SELECT 'alocacoes' AS origem, min(data) AS primeira_data, max(data) AS ultima_data,
       count(*) AS total_linhas, count(DISTINCT funcionario_id) AS funcionarios
FROM public.alocacoes
UNION ALL
SELECT 'registros_horas', min(data), max(data), count(*), count(DISTINCT funcionario_id)
FROM public.registros_horas;

-- 8. Competencias fechadas, apenas em contagem/limites.
SELECT count(*) FILTER (WHERE fechada) AS competencias_fechadas,
       min(data_inicio) FILTER (WHERE fechada) AS primeira_fechada,
       max(data_fim) FILTER (WHERE fechada) AS ultima_fechada
FROM public.fechamentos_competencia;
