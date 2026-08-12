\set ON_ERROR_STOP on
BEGIN;

-- Smoke transacional: exige ao menos um usuario existente por role e nao persiste mudancas.
DO $$
DECLARE
  v_role public.app_role;
  v_user uuid;
  v_manager uuid;
  v_funcionario uuid;
  v_admissao date;
  v_data_valida date;
  v_data_alocacao date;
  v_data_original date;
  v_historico bigint;
  v_bloqueou boolean;
BEGIN
  SELECT user_id INTO v_manager FROM public.user_roles
  WHERE role = 'gerente'::public.app_role LIMIT 1;
  IF v_manager IS NULL THEN
    SELECT user_id INTO v_manager FROM public.user_roles
    WHERE role = 'diretor'::public.app_role LIMIT 1;
  END IF;
  ASSERT v_manager IS NOT NULL, 'smoke requer gerente ou diretor existente';

  SELECT f.id, f.data_admissao, greatest(
           coalesce(f.data_admissao, current_date),
           coalesce((SELECT max(a.data) FROM public.alocacoes a WHERE a.funcionario_id = f.id), current_date)
         )
    INTO v_funcionario, v_admissao, v_data_valida
  FROM public.funcionarios f
  WHERE f.ativo IS TRUE AND f.deleted_at IS NULL AND f.data_desligamento IS NULL
  ORDER BY f.created_at
  LIMIT 1;
  ASSERT v_funcionario IS NOT NULL, 'smoke requer funcionario ativo elegivel';

  SELECT max(data), count(*) INTO v_data_alocacao, v_historico
  FROM public.alocacoes WHERE funcionario_id = v_funcionario;

  -- Assistente, supervisor, coordenador, gerente e diretor podem desligar.
  FOREACH v_role IN ARRAY ARRAY[
    'assistente'::public.app_role, 'supervisor'::public.app_role,
    'coordenador'::public.app_role, 'gerente'::public.app_role, 'diretor'::public.app_role
  ] LOOP
    SELECT user_id INTO v_user FROM public.user_roles WHERE role = v_role LIMIT 1;
    ASSERT v_user IS NOT NULL, format('smoke requer usuario com role %s', v_role);
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    UPDATE public.funcionarios
    SET ativo = false, data_desligamento = v_data_valida, deleted_at = NULL, deleted_by = NULL
    WHERE id = v_funcionario;
    ASSERT (SELECT NOT ativo AND data_desligamento = v_data_valida
            FROM public.funcionarios WHERE id = v_funcionario);
    PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
    UPDATE public.funcionarios SET ativo = true, data_desligamento = NULL WHERE id = v_funcionario;
  END LOOP;

  -- Perfis nao administrativos nao editam data, reativam ou excluem logicamente.
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  UPDATE public.funcionarios SET ativo = false, data_desligamento = v_data_valida WHERE id = v_funcionario;
  FOREACH v_role IN ARRAY ARRAY[
    'assistente'::public.app_role, 'supervisor'::public.app_role, 'coordenador'::public.app_role
  ] LOOP
    SELECT user_id INTO v_user FROM public.user_roles WHERE role = v_role LIMIT 1;
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    v_bloqueou := false;
    BEGIN
      UPDATE public.funcionarios SET data_desligamento = v_data_valida + 1 WHERE id = v_funcionario;
    EXCEPTION WHEN raise_exception THEN v_bloqueou := true;
    END;
    ASSERT v_bloqueou, format('%s nao deveria editar data posterior', v_role);

    v_bloqueou := false;
    BEGIN
      UPDATE public.funcionarios SET ativo = true, data_desligamento = NULL WHERE id = v_funcionario;
    EXCEPTION WHEN raise_exception THEN v_bloqueou := true;
    END;
    ASSERT v_bloqueou, format('%s nao deveria reativar', v_role);

    v_bloqueou := false;
    BEGIN
      UPDATE public.funcionarios SET deleted_at = clock_timestamp(), deleted_by = v_user
      WHERE id = v_funcionario;
    EXCEPTION WHEN raise_exception THEN v_bloqueou := true;
    END;
    ASSERT v_bloqueou, format('%s nao deveria excluir', v_role);
  END LOOP;

  -- Gerente e diretor podem corrigir data; exclusao permanece administrativa.
  FOREACH v_role IN ARRAY ARRAY['gerente'::public.app_role, 'diretor'::public.app_role] LOOP
    SELECT user_id INTO v_user FROM public.user_roles WHERE role = v_role LIMIT 1;
    PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
    v_data_original := (SELECT data_desligamento FROM public.funcionarios WHERE id = v_funcionario);
    UPDATE public.funcionarios SET data_desligamento = v_data_original + 1 WHERE id = v_funcionario;
    UPDATE public.funcionarios SET data_desligamento = v_data_original WHERE id = v_funcionario;
    UPDATE public.funcionarios SET deleted_at = clock_timestamp() WHERE id = v_funcionario;
    ASSERT (SELECT deleted_at IS NOT NULL AND deleted_by = v_user
            FROM public.funcionarios WHERE id = v_funcionario);
    UPDATE public.funcionarios SET deleted_at = NULL WHERE id = v_funcionario;
  END LOOP;

  -- Data anterior a admissao e a ultima alocacao continuam bloqueadas.
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  UPDATE public.funcionarios SET ativo = true, data_desligamento = NULL WHERE id = v_funcionario;
  IF v_admissao IS NOT NULL THEN
    v_bloqueou := false;
    BEGIN
      UPDATE public.funcionarios SET ativo = false, data_desligamento = v_admissao - 1
      WHERE id = v_funcionario;
    EXCEPTION WHEN raise_exception THEN v_bloqueou := true;
    END;
    ASSERT v_bloqueou, 'data anterior a admissao deveria ser bloqueada';
  END IF;
  IF v_data_alocacao IS NOT NULL THEN
    v_bloqueou := false;
    BEGIN
      UPDATE public.funcionarios SET ativo = false, data_desligamento = v_data_alocacao - 1
      WHERE id = v_funcionario;
    EXCEPTION WHEN raise_exception THEN v_bloqueou := true;
    END;
    ASSERT v_bloqueou, 'data anterior a ultima alocacao deveria ser bloqueada';
  END IF;

  ASSERT (SELECT count(*) = v_historico FROM public.alocacoes WHERE funcionario_id = v_funcionario),
         'historico de alocacoes foi alterado';
END;
$$;

ROLLBACK;
