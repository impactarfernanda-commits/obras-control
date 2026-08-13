-- Somente leitura: confirma a causa e os caminhos seguros disponíveis.
SELECT p.oid::regprocedure AS funcao, p.prosecdef, p.proconfig,
       pg_get_functiondef(p.oid) AS definicao
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'obras_copiar_dia_anterior';

SELECT to_regprocedure('public.obras_control_funcionarios_safe()') AS lista_segura,
       to_regprocedure('public.obras_control_funcionarios_por_ids(uuid[])') AS busca_segura_por_ids;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'funcionarios'
ORDER BY grantee, privilege_type;

SELECT has_table_privilege('authenticated', 'public.funcionarios', 'SELECT') AS authenticated_select_geral,
       has_function_privilege('authenticated', 'public.obras_control_funcionarios_safe()', 'EXECUTE') AS lista_segura_executavel,
       has_function_privilege('authenticated', 'public.obras_control_funcionarios_por_ids(uuid[])', 'EXECUTE') AS busca_ids_executavel;
