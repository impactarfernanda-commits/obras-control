-- Somente leitura: pré-requisitos da cópia atômica de equipe.
SELECT current_database() AS banco, current_setting('server_version') AS postgres_version;

SELECT to_regclass('public.alocacoes') AS alocacoes,
       to_regclass('public.registros_horas') AS registros_horas,
       to_regclass('public.funcionarios') AS funcionarios,
       to_regclass('public.obras') AS obras;

SELECT conrelid::regclass AS tabela, conname, pg_get_constraintdef(oid) AS definicao
FROM pg_constraint
WHERE conrelid IN ('public.alocacoes'::regclass, 'public.registros_horas'::regclass)
ORDER BY conrelid::regclass::text, conname;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('alocacoes', 'registros_horas')
ORDER BY tablename, policyname;

SELECT to_regprocedure('public.get_user_level(uuid)') AS autorizacao_canonica,
       to_regprocedure('public.obras_salvar_registro_horas(uuid,uuid,uuid,date,text,text,numeric,numeric,text,text)') AS rpc_registro_atual;
