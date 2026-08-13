-- Somente leitura: executar depois da migration em ambiente autorizado.
SELECT p.oid::regprocedure AS funcao, p.prosecdef AS security_definer, p.proconfig,
       pg_get_function_result(p.oid) AS retorno,
       position('FROM public.funcionarios ' IN pg_get_functiondef(p.oid)) = 0 AS sem_select_direto_funcionarios,
       position('obras_control_funcionarios_por_ids' IN pg_get_functiondef(p.oid)) > 0 AS usa_busca_segura_ids,
       position('obras_control_funcionarios_safe' IN pg_get_functiondef(p.oid)) > 0 AS usa_lista_segura
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'obras_copiar_dia_anterior';

WITH funcao AS (
  SELECT p.proacl, p.proowner
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid = 'public.obras_copiar_dia_anterior(uuid,date,date,boolean)'::regprocedure
)
SELECT NOT EXISTS (
         SELECT 1
         FROM funcao f,
              aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) AS public_sem_execute,
       has_function_privilege('anon', 'public.obras_copiar_dia_anterior(uuid,date,date,boolean)', 'EXECUTE') AS anon_executa,
       has_function_privilege('authenticated', 'public.obras_copiar_dia_anterior(uuid,date,date,boolean)', 'EXECUTE') AS authenticated_executa,
       has_table_privilege('authenticated', 'public.funcionarios', 'SELECT') AS authenticated_select_geral_funcionarios
FROM funcao;
