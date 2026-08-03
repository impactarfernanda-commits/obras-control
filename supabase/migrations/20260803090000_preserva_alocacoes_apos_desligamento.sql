-- A importacao legado usa a primeira celula D como a data exata do desligamento.
-- Alocacoes historicas iguais ou posteriores sao preservadas e auditadas pelo importador.
CREATE OR REPLACE FUNCTION public.guard_estado_funcionario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF NEW.data_desligamento IS NOT NULL
     AND NEW.deleted_at IS NULL
     AND NEW.data_admissao IS NOT NULL
     AND NEW.data_desligamento < NEW.data_admissao THEN
    RAISE EXCEPTION 'DATA_DESLIGAMENTO_ANTERIOR_ADMISSAO';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_estado_funcionario() IS
  'Valida estado e datas do funcionario sem apagar ou bloquear alocacoes historicas posteriores ao desligamento.';
