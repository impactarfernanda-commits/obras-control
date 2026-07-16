-- Permite corrigir a data de desligamento, protegendo admissao e historico.
CREATE OR REPLACE FUNCTION public.guard_estado_funcionario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ultima_alocacao date;
BEGIN
  IF (OLD.ativo, OLD.data_desligamento, OLD.deleted_at, OLD.deleted_by)
       IS DISTINCT FROM
     (NEW.ativo, NEW.data_desligamento, NEW.deleted_at, NEW.deleted_by)
     AND NOT (public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'diretor')) THEN
    RAISE EXCEPTION 'Apenas gerentes e diretores podem desligar ou excluir funcionarios';
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

DROP TRIGGER IF EXISTS trg_guard_estado_funcionario ON public.funcionarios;
CREATE TRIGGER trg_guard_estado_funcionario
BEFORE UPDATE OF ativo, data_admissao, data_desligamento, deleted_at, deleted_by
ON public.funcionarios
FOR EACH ROW EXECUTE FUNCTION public.guard_estado_funcionario();

REVOKE EXECUTE ON FUNCTION public.guard_estado_funcionario() FROM PUBLIC, anon, authenticated;
