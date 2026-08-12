BEGIN;

-- BEGIN MIGRATION BODY
-- Permite a transicao estrita de desligamento a qualquer perfil interno.
-- Edicao posterior, reativacao e exclusao continuam exclusivas de gerente/diretor.
CREATE OR REPLACE FUNCTION public.guard_estado_funcionario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ultima_alocacao date;
  usuario_interno boolean;
  gerente_ou_diretor boolean;
  desligamento_inicial boolean;
BEGIN
  usuario_interno :=
    public.has_role(auth.uid(), 'assistente')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'coordenador')
    OR public.has_role(auth.uid(), 'gerente')
    OR public.has_role(auth.uid(), 'diretor');
  gerente_ou_diretor :=
    public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'diretor');

  desligamento_inicial :=
    usuario_interno
    AND OLD.ativo IS TRUE
    AND NEW.ativo IS FALSE
    AND OLD.data_desligamento IS NULL
    AND NEW.data_desligamento IS NOT NULL
    AND OLD.deleted_at IS NULL
    AND NEW.deleted_at IS NULL
    AND OLD.deleted_by IS NULL
    AND NEW.deleted_by IS NULL;

  IF (OLD.ativo, OLD.data_desligamento, OLD.deleted_at, OLD.deleted_by)
       IS DISTINCT FROM
     (NEW.ativo, NEW.data_desligamento, NEW.deleted_at, NEW.deleted_by)
     AND NOT gerente_ou_diretor
     AND NOT desligamento_inicial THEN
    RAISE EXCEPTION 'ALTERACAO_ESTADO_FUNCIONARIO_RESTRITA_GERENTE_DIRETOR';
  END IF;

  IF OLD.deleted_at IS NOT NULL
     AND OLD.data_desligamento IS DISTINCT FROM NEW.data_desligamento THEN
    RAISE EXCEPTION 'Nao e permitido editar desligamento de funcionario excluido';
  END IF;

  IF NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_by := coalesce(NEW.deleted_by, auth.uid());
  ELSE
    NEW.deleted_by := NULL;
  END IF;

  IF NOT NEW.ativo AND NEW.deleted_at IS NULL AND NEW.data_desligamento IS NULL THEN
    RAISE EXCEPTION 'DATA_DESLIGAMENTO_OBRIGATORIA';
  END IF;
  IF NEW.ativo AND NEW.data_desligamento IS NOT NULL THEN
    RAISE EXCEPTION 'Funcionario ativo nao pode possuir data de desligamento';
  END IF;

  IF (NEW.data_desligamento IS DISTINCT FROM OLD.data_desligamento
      OR NEW.data_admissao IS DISTINCT FROM OLD.data_admissao)
     AND NEW.data_desligamento IS NOT NULL
     AND NEW.deleted_at IS NULL THEN
    IF NEW.data_admissao IS NOT NULL AND NEW.data_desligamento < NEW.data_admissao THEN
      RAISE EXCEPTION 'DATA_DESLIGAMENTO_ANTERIOR_ADMISSAO';
    END IF;

    SELECT max(a.data) INTO ultima_alocacao
    FROM public.alocacoes a
    WHERE a.funcionario_id = NEW.id;

    IF ultima_alocacao IS NOT NULL AND NEW.data_desligamento < ultima_alocacao THEN
      RAISE EXCEPTION 'ULTIMA_ALOCACAO_FUNCIONARIO:%', to_char(ultima_alocacao, 'DD/MM/YYYY');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_estado_funcionario() IS
  'Permite desligamento inicial com data a perfis internos; demais mudancas de estado seguem restritas a gerente/diretor.';

REVOKE EXECUTE ON FUNCTION public.guard_estado_funcionario() FROM PUBLIC, anon, authenticated;
-- END MIGRATION BODY

DO $$
DECLARE
  definition text := pg_get_functiondef('public.guard_estado_funcionario()'::regprocedure);
BEGIN
  ASSERT definition LIKE '%OLD.ativo IS TRUE%';
  ASSERT definition LIKE '%NEW.ativo IS FALSE%';
  ASSERT definition LIKE '%NEW.data_desligamento IS NOT NULL%';
  ASSERT definition LIKE '%DATA_DESLIGAMENTO_OBRIGATORIA%';
  ASSERT definition LIKE '%DATA_DESLIGAMENTO_ANTERIOR_ADMISSAO%';
  ASSERT definition LIKE '%ULTIMA_ALOCACAO_FUNCIONARIO:%';
  ASSERT definition LIKE '%AND NOT gerente_ou_diretor%';
  ASSERT definition LIKE '%AND NOT desligamento_inicial%';
  ASSERT definition LIKE '%IF NEW.ativo AND NEW.data_desligamento IS NOT NULL%';
  ASSERT definition LIKE '%OLD.deleted_at%NEW.deleted_at%';
  ASSERT definition LIKE '%OLD.deleted_by%NEW.deleted_by%';
END;
$$;

ROLLBACK;
