SELECT count(*) AS funcionarios_obras_control_salario_um
FROM public.funcionarios
WHERE salario = 1::numeric AND visivel_obras_control IS TRUE;
SELECT 'alocacoes' AS tabela, count(*) AS futuras FROM public.alocacoes WHERE data > current_date
UNION ALL
SELECT 'registros_horas', count(*) FROM public.registros_horas WHERE data > current_date;
SELECT tgrelid::regclass AS tabela, tgname, tgenabled
FROM pg_trigger
WHERE tgname IN ('guard_funcionarios_salario_insert_update', 'guard_data_nao_futura')
  AND NOT tgisinternal
ORDER BY (tgrelid::regclass)::text, tgname;

SELECT p.oid::regprocedure AS funcao, p.prosecdef AS security_definer,
       r.rolname AS owner,
       coalesce(bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'), false)
         AS public_possui_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_possui_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_possui_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_possui_execute,
       has_function_privilege('postgres', p.oid, 'EXECUTE') AS postgres_possui_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
LEFT JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl ON true
WHERE n.nspname = 'public' AND p.proname = 'obras_corrigir_salarios_placeholder'
GROUP BY p.oid, r.rolname;
