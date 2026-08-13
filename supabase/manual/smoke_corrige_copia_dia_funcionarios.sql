-- Smoke transacional. Execute com JWT de um usuário authenticated autorizado.
-- Substitua somente os valores em parametros. Nada persiste por causa do ROLLBACK.
BEGIN;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.funcionarios', 'SELECT') THEN
    RAISE EXCEPTION 'Falha de seguranca: authenticated possui SELECT geral em funcionarios.';
  END IF;
  IF has_function_privilege('anon', 'public.obras_copiar_dia_anterior(uuid,date,date,boolean)', 'EXECUTE')
     OR has_function_privilege('PUBLIC', 'public.obras_copiar_dia_anterior(uuid,date,date,boolean)', 'EXECUTE') THEN
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
