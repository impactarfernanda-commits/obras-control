-- Somente leitura. Execute antes da migration para registrar o estado atual.
SELECT current_database() AS database_name, now() AS diagnosticado_em;

SELECT n.nspname AS schema_name, p.proname, p.prosecdef AS security_definer,
       pg_get_functiondef(p.oid) AS definicao
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'guard_estado_funcionario';

SELECT tgname, pg_get_triggerdef(oid) AS definicao
FROM pg_trigger
WHERE tgrelid = 'public.funcionarios'::regclass AND NOT tgisinternal;

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'funcionarios'
ORDER BY policyname;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'funcionarios'
ORDER BY grantee, privilege_type;

SELECT count(*) FILTER (WHERE ativo AND data_desligamento IS NOT NULL) AS ativos_com_desligamento,
       count(*) FILTER (WHERE NOT ativo AND deleted_at IS NULL AND data_desligamento IS NULL)
         AS inativos_sem_data,
       count(*) FILTER (WHERE deleted_at IS NULL AND deleted_by IS NOT NULL)
         AS nao_excluidos_com_deleted_by
FROM public.funcionarios;
