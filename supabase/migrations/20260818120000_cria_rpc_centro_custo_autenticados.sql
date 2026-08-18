-- FASE 1/2: aplicar antes da publicacao do frontend que usa a RPC.
-- Esta migration nao altera a tabela, a politica nem o privilegio de INSERT
-- atuais, mantendo o frontend antigo operacional durante a transicao.

CREATE OR REPLACE FUNCTION public.obras_criar_centro_custo(
  p_codigo text,
  p_descricao text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_codigo_exibicao text := pg_catalog.regexp_replace(
    pg_catalog.upper(pg_catalog.btrim(COALESCE(p_codigo, ''))),
    ' {2,}',
    ' ',
    'g'
  );
  v_codigo_normalizado text := pg_catalog.regexp_replace(
    v_codigo_exibicao,
    '[^A-Z0-9]',
    '',
    'g'
  );
  v_descricao text := pg_catalog.regexp_replace(
    pg_catalog.btrim(COALESCE(p_descricao, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  v_obra_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.get_user_level(auth.uid()) < 1 THEN
    RAISE EXCEPTION 'Usuario autenticado do Obras Control obrigatorio'
      USING ERRCODE = '42501';
  END IF;

  IF v_codigo_exibicao = ''
    OR pg_catalog.length(v_codigo_exibicao) > 30
    OR v_codigo_normalizado = ''
    OR pg_catalog.position(' - ' IN v_codigo_exibicao) > 0
    OR COALESCE(p_codigo, '') ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Codigo do centro de custo obrigatorio ou invalido'
      USING ERRCODE = '22023';
  END IF;

  IF v_descricao = '' OR pg_catalog.length(v_descricao) > 120 THEN
    RAISE EXCEPTION 'Descricao do centro de custo obrigatoria ou invalida'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_codigo_normalizado, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.obras AS obra
    WHERE pg_catalog.regexp_replace(
      pg_catalog.upper(
        pg_catalog.btrim(
          COALESCE(
            pg_catalog.substring(
              pg_catalog.btrim(obra.nome),
              '^(.+?)[[:space:]]+[-–—][[:space:]]+.+$'
            ),
            ''
          )
        )
      ),
      '[^A-Z0-9]',
      '',
      'g'
    ) = v_codigo_normalizado
  ) THEN
    RAISE EXCEPTION 'Centro de custo ja cadastrado'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.obras (
    nome,
    status,
    data_inicio,
    visivel_obras_control
  )
  VALUES (
    v_codigo_exibicao || ' - ' || v_descricao,
    'Em andamento',
    NULL,
    true
  )
  RETURNING id INTO v_obra_id;

  RETURN v_obra_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.obras_criar_centro_custo(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_criar_centro_custo(text, text) TO authenticated;

COMMENT ON FUNCTION public.obras_criar_centro_custo(text, text) IS
  'FASE 1/2: cria centro de custo e retorna somente o UUID; aplicar antes do frontend RPC.';
