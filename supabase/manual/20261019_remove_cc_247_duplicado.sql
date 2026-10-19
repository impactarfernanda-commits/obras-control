-- LIMPEZA REAL PONTUAL. Executar somente depois de validar o DRY RUN correspondente.
-- Nao altera alocacoes_dia_exclusoes_obra_id_fkey e nao usa CASCADE.
BEGIN;

DO $cleanup$
DECLARE
  v_correto constant uuid := '8d3675d5-9f7c-4815-a6bc-9caad70fbb49';
  v_duplicado constant uuid := 'b11934ac-20ee-4db0-8385-d50a984e9505';
  v_exclusao constant uuid := 'f5b2b3ce-75ea-431a-9805-267a77aa939d';
  v_nome_correto constant text := '247 - ÁGUAS DO BRASIL SAQUAREMA';
  v_nome_duplicado constant text := '247- ÁGUAS DO BRASIL - MONTAGEM DE TANQUE DE 3MILHÕES DE LITROS';
  v_contagem bigint;
  v_fk record;
BEGIN
  IF (SELECT count(*) FROM public.obras WHERE id = v_correto AND nome = v_nome_correto) <> 1 THEN
    RAISE EXCEPTION 'ABORTADO: o CC correto nao corresponde exatamente ao ID/nome esperado.';
  END IF;
  IF (SELECT count(*) FROM public.obras WHERE id = v_duplicado AND nome = v_nome_duplicado) <> 1 THEN
    RAISE EXCEPTION 'ABORTADO: o CC duplicado nao corresponde exatamente ao ID/nome esperado.';
  END IF;

  PERFORM 1 FROM public.obras WHERE id IN (v_correto, v_duplicado) FOR UPDATE;

  IF (SELECT count(*) FROM public.alocacoes_dia_exclusoes WHERE obra_id = v_duplicado) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.alocacoes_dia_exclusoes
      WHERE id = v_exclusao AND obra_id = v_duplicado AND data = DATE '2026-10-13'
        AND ativa_para_copia = false AND neutralizada_em IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'ABORTADO: a referencia historica nao e a unica linha neutralizada esperada.';
  END IF;

  FOR v_fk IN
    SELECT n.nspname AS esquema, c.relname AS tabela, a.attname AS coluna
    FROM pg_catalog.pg_constraint fk
    JOIN pg_catalog.pg_class c ON c.oid = fk.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN LATERAL unnest(fk.conkey) AS chave(attnum) ON true
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = chave.attnum
    WHERE fk.contype = 'f' AND fk.confrelid = 'public.obras'::regclass
      AND NOT (n.nspname = 'public' AND c.relname = 'alocacoes_dia_exclusoes')
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1', v_fk.esquema, v_fk.tabela, v_fk.coluna)
      INTO v_contagem USING v_duplicado;
    IF v_contagem <> 0 THEN
      RAISE EXCEPTION 'ABORTADO: nova referencia encontrada em %.%(%): % linha(s).',
        v_fk.esquema, v_fk.tabela, v_fk.coluna, v_contagem;
    END IF;
  END LOOP;

  DELETE FROM public.alocacoes_dia_exclusoes WHERE id = v_exclusao AND obra_id = v_duplicado;
  GET DIAGNOSTICS v_contagem = ROW_COUNT;
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'ABORTADO: exclusao historica divergente.'; END IF;

  DELETE FROM public.obras WHERE id = v_duplicado AND nome = v_nome_duplicado;
  GET DIAGNOSTICS v_contagem = ROW_COUNT;
  IF v_contagem <> 1 THEN RAISE EXCEPTION 'ABORTADO: obra duplicada divergente.'; END IF;

  IF (SELECT count(*) FROM public.obras WHERE id = v_correto AND nome = v_nome_correto) <> 1 THEN
    RAISE EXCEPTION 'ABORTADO: o CC correto deixou de permanecer intacto.';
  END IF;
END
$cleanup$;

COMMIT;
