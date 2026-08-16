-- Smoke transacional. Execute com JWT de um usuário authenticated autorizado.
-- Substitua somente os valores em parametros. Nada persiste por causa do ROLLBACK.
BEGIN;

DO $$
DECLARE
  v_oid oid := to_regprocedure('public.obras_copiar_dia_anterior(uuid,date,date,boolean)');
  v_public_execute boolean;
BEGIN
  IF has_table_privilege('authenticated', 'public.funcionarios', 'SELECT') THEN
    RAISE EXCEPTION 'Falha de seguranca: authenticated possui SELECT geral em funcionarios.';
  END IF;
  SELECT coalesce(bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'), false)
    INTO v_public_execute
    FROM pg_proc p
    LEFT JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl ON true
   WHERE p.oid = v_oid;
  IF v_public_execute
     OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Falha de seguranca: anon/PUBLIC executa a RPC.';
  END IF;
END $$;

WITH parametros AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS obra_id,
         DATE '2099-01-01' AS origem, DATE '2099-01-02' AS destino
)
SELECT public.obras_copiar_dia_anterior(obra_id, origem, destino, false) AS previa
FROM parametros;

-- Após conferir a prévia, descomente para testar aplicação; o ROLLBACK permanece obrigatório.
-- WITH parametros AS (
--   SELECT '00000000-0000-0000-0000-000000000000'::uuid AS obra_id,
--          DATE '2099-01-01' AS origem, DATE '2099-01-02' AS destino
-- )
-- SELECT public.obras_copiar_dia_anterior(obra_id, origem, destino, true) FROM parametros;

ROLLBACK;
