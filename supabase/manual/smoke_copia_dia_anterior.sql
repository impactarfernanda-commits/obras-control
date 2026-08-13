-- Smoke transacional. Requer JWT autenticado e dados de teste escolhidos pelo operador.
-- Substitua exclusivamente os três valores dentro de parametros antes de executar.
BEGIN;

WITH parametros AS (
  SELECT '00000000-0000-0000-0000-000000000000'::uuid AS obra_id,
         DATE '2099-01-01' AS origem,
         DATE '2099-01-02' AS destino
)
SELECT public.obras_copiar_dia_anterior(obra_id, origem, destino, false)
FROM parametros;

-- Descomente somente após conferir a prévia acima. O ROLLBACK impede persistência.
-- WITH parametros AS (
--   SELECT '00000000-0000-0000-0000-000000000000'::uuid AS obra_id,
--          DATE '2099-01-01' AS origem, DATE '2099-01-02' AS destino
-- )
-- SELECT public.obras_copiar_dia_anterior(obra_id, origem, destino, true) FROM parametros;

ROLLBACK;
