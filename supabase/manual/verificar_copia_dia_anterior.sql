-- Somente leitura: executar após aplicar a migration em ambiente autorizado.
SELECT p.oid::regprocedure AS funcao, p.prosecdef AS security_definer,
       p.proconfig AS configuracao, pg_get_function_result(p.oid) AS retorno
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'obras_copiar_dia_anterior';

SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'obras_copiar_dia_anterior'
ORDER BY grantee;

SELECT has_function_privilege('anon', 'public.obras_copiar_dia_anterior(uuid,date,date,boolean)', 'EXECUTE') AS anon_executa,
       has_function_privilege('authenticated', 'public.obras_copiar_dia_anterior(uuid,date,date,boolean)', 'EXECUTE') AS authenticated_executa;

SELECT obj_description('public.obras_copiar_dia_anterior(uuid,date,date,boolean)'::regprocedure, 'pg_proc') AS comentario;
