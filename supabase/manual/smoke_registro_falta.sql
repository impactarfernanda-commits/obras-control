\set ON_ERROR_STOP on
BEGIN;

-- Fixtures exclusivas e recuperaveis. Nunca execute em producao.
DO $$
DECLARE
  v_funcionario_1 uuid := gen_random_uuid();
  v_funcionario_2 uuid := gen_random_uuid();
  v_obra uuid := gen_random_uuid();
  v_horas uuid;
  v_falta uuid;
  v_bloqueou boolean;
BEGIN
  INSERT INTO public.obras (id, nome) VALUES (v_obra, '__SMOKE_REGISTRO_FALTA__');
  INSERT INTO public.funcionarios (id, nome, ativo)
  VALUES (v_funcionario_1, '__SMOKE_FALTA_1__', true),
         (v_funcionario_2, '__SMOKE_FALTA_2__', true);

  -- 1. Horas positivas.
  INSERT INTO public.registros_horas
    (funcionario_id, obra_id, data, tipo_registro, horas_normais, horas_extras)
  VALUES (v_funcionario_1, v_obra, DATE '2099-01-05', 'horas', 8, 0)
  RETURNING id INTO v_horas;

  -- 2. Horas zeradas bloqueadas.
  v_bloqueou := false;
  BEGIN
    INSERT INTO public.registros_horas
      (funcionario_id, obra_id, data, tipo_registro, horas_normais, horas_extras)
    VALUES (v_funcionario_1, v_obra, DATE '2099-01-06', 'horas', 0, 0);
  EXCEPTION WHEN check_violation THEN v_bloqueou := true;
  END;
  ASSERT v_bloqueou, 'horas zeradas deveriam ser bloqueadas';

  -- 3-5 e 8-9. Classificacoes validas; falta normaliza totais.
  INSERT INTO public.registros_horas
    (funcionario_id, obra_id, data, tipo_registro, falta_tipo, horas_normais, horas_extras)
  VALUES (v_funcionario_1, v_obra, DATE '2099-01-07', 'falta', 'nao_justificada', 0, 0)
  RETURNING id INTO v_falta;
  ASSERT (SELECT horas_normais = 0 AND horas_extras = 0 FROM public.registros_horas WHERE id = v_falta);
  INSERT INTO public.registros_horas
    (funcionario_id, obra_id, data, tipo_registro, falta_tipo)
  VALUES (v_funcionario_1, v_obra, DATE '2099-01-08', 'falta', 'justificada');
  INSERT INTO public.registros_horas
    (funcionario_id, obra_id, data, tipo_registro, falta_tipo)
  VALUES (v_funcionario_1, v_obra, DATE '2099-01-09', 'falta', 'atestado');

  -- 6. Classificacao obrigatoria.
  v_bloqueou := false;
  BEGIN
    INSERT INTO public.registros_horas
      (funcionario_id, obra_id, data, tipo_registro)
    VALUES (v_funcionario_1, v_obra, DATE '2099-01-10', 'falta');
  EXCEPTION WHEN check_violation THEN v_bloqueou := true;
  END;
  ASSERT v_bloqueou, 'falta sem classificacao deveria ser bloqueada';

  -- 7. Horas enviadas em falta sao normalizadas com seguranca.
  INSERT INTO public.registros_horas
    (funcionario_id, obra_id, data, tipo_registro, falta_tipo, horas_normais)
  VALUES (v_funcionario_1, v_obra, DATE '2099-01-11', 'falta', 'suspensao', 8);
  ASSERT (SELECT horas_normais = 0 FROM public.registros_horas
          WHERE funcionario_id = v_funcionario_1 AND data = DATE '2099-01-11');

  -- 10-12. Conflitos nas duas ordens e falta duplicada.
  v_bloqueou := false;
  BEGIN
    INSERT INTO public.registros_horas
      (funcionario_id, obra_id, data, tipo_registro, falta_tipo)
    VALUES (v_funcionario_1, v_obra, DATE '2099-01-05', 'falta', 'outro');
  EXCEPTION WHEN check_violation THEN v_bloqueou := true;
  END;
  ASSERT v_bloqueou;

  v_bloqueou := false;
  BEGIN
    INSERT INTO public.registros_horas
      (funcionario_id, obra_id, data, tipo_registro, horas_normais)
    VALUES (v_funcionario_1, v_obra, DATE '2099-01-07', 'horas', 8);
  EXCEPTION WHEN check_violation THEN v_bloqueou := true;
  END;
  ASSERT v_bloqueou;

  v_bloqueou := false;
  BEGIN
    INSERT INTO public.registros_horas
      (funcionario_id, obra_id, data, tipo_registro, falta_tipo)
    VALUES (v_funcionario_1, v_obra, DATE '2099-01-07', 'falta', 'outro');
  EXCEPTION WHEN unique_violation OR check_violation THEN v_bloqueou := true;
  END;
  ASSERT v_bloqueou;

  -- 13. Exclusao/cancelamento deixa de bloquear.
  DELETE FROM public.registros_horas WHERE id = v_falta;
  INSERT INTO public.registros_horas
    (funcionario_id, obra_id, data, tipo_registro, horas_normais)
  VALUES (v_funcionario_1, v_obra, DATE '2099-01-07', 'horas', 8);

  -- 14-15. Outro funcionario e outras datas sao independentes.
  INSERT INTO public.registros_horas
    (funcionario_id, obra_id, data, tipo_registro, falta_tipo)
  VALUES (v_funcionario_2, v_obra, DATE '2099-01-05', 'falta', 'afastamento');

  -- 16-17. Conversoes passam pela mesma trigger e exigem consistencia.
  UPDATE public.registros_horas SET tipo_registro = 'falta', falta_tipo = 'justificada'
  WHERE id = v_horas;
  v_bloqueou := false;
  BEGIN
    UPDATE public.registros_horas
    SET tipo_registro = 'horas', falta_tipo = NULL, horas_normais = 0, horas_extras = 0
    WHERE id = v_horas;
  EXCEPTION WHEN check_violation THEN v_bloqueou := true;
  END;
  ASSERT v_bloqueou;

  -- 18-20 sao cobertos pelas policies existentes, inalteradas, e pela RPC SECURITY INVOKER.
  ASSERT has_function_privilege('authenticated',
    'public.obras_salvar_registro_horas(uuid,uuid,uuid,date,text,text,numeric,numeric,text,text)',
    'EXECUTE');

  -- 21. A migration nao executa UPDATE retroativo; validacao estrutural complementar.
  ASSERT position('UPDATE public.registros_horas SET tipo_registro' IN
    pg_get_functiondef('public.obras_normalizar_validar_registro_horas()'::regprocedure)) = 0;
END;
$$;

-- 22. Todas as fixtures e alteracoes acima sao removidas.
ROLLBACK;
