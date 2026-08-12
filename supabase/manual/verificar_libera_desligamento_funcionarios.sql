-- Verificacao pos-migration sem alteracao de dados.
SELECT
  pg_get_functiondef('public.guard_estado_funcionario()'::regprocedure)
    LIKE '%OLD.ativo IS TRUE%' AS exige_origem_ativa,
  pg_get_functiondef('public.guard_estado_funcionario()'::regprocedure)
    LIKE '%NEW.ativo IS FALSE%' AS exige_destino_inativo,
  pg_get_functiondef('public.guard_estado_funcionario()'::regprocedure)
    LIKE '%AND NOT desligamento_inicial%' AS preserva_restricao_administrativa,
  pg_get_functiondef('public.guard_estado_funcionario()'::regprocedure)
    LIKE '%ULTIMA_ALOCACAO_FUNCIONARIO:%' AS preserva_ultima_alocacao;

SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'funcionarios' AND cmd IN ('SELECT', 'UPDATE', 'DELETE')
ORDER BY cmd, policyname;

SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definicao
FROM pg_trigger
WHERE tgrelid = 'public.funcionarios'::regclass
  AND tgname = 'trg_guard_estado_funcionario';

WITH funcao AS (
  SELECT p.proacl, p.proowner
  FROM pg_proc p
  WHERE p.oid = 'public.guard_estado_funcionario()'::regprocedure
)
SELECT NOT EXISTS (
         SELECT 1
         FROM funcao f
         CROSS JOIN LATERAL aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) AS public_sem_execute,
       has_function_privilege('anon', 'public.guard_estado_funcionario()', 'EXECUTE') AS anon_executa,
       has_function_privilege('authenticated', 'public.guard_estado_funcionario()', 'EXECUTE') AS autenticado_executa;
