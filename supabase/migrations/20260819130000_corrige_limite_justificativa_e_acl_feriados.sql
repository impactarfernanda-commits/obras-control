-- Corrige somente o limite de justificativa da jornada v2 e os privilégios da tabela de feriados.
-- A função instalada é reutilizada integralmente para evitar divergência do corpo publicado.
DO $migration$
DECLARE
  v_funcao regprocedure := 'public.obras_salvar_jornada_v2(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,integer,numeric,numeric,text,text,text,jsonb,text)'::regprocedure;
  v_definicao text;
  v_corrigida text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(v_funcao) INTO v_definicao;

  IF pg_catalog.strpos(v_definicao, '> 600') = 0
     OR pg_catalog.strpos(v_definicao, 'Justificativa obrigatoria para jornada superior a 10 horas.') = 0 THEN
    RAISE EXCEPTION 'A definicao instalada de obras_salvar_jornada_v2 nao corresponde a versao esperada.';
  END IF;

  v_corrigida := pg_catalog.replace(v_definicao, '> 600', '> 720');
  v_corrigida := pg_catalog.replace(
    v_corrigida,
    'Justificativa obrigatoria para jornada superior a 10 horas.',
    'Justificativa obrigatoria para jornada superior a 12 horas.'
  );

  EXECUTE v_corrigida;
END;
$migration$;

REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE public.feriados_obras_control FROM authenticated;
REVOKE ALL ON TABLE public.feriados_obras_control FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.feriados_obras_control TO authenticated;
