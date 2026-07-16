-- Separa exclusao de cadastro e desligamento, preservando todo o historico.
ALTER TABLE public.funcionarios
  ADD COLUMN IF NOT EXISTS data_admissao date NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_by uuid NULL;

-- A regra antiga preenchia CURRENT_DATE e confundia inativacao com exclusao.
DROP TRIGGER IF EXISTS trg_set_data_desligamento ON public.funcionarios;
DROP FUNCTION IF EXISTS public.set_data_desligamento();

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

  IF NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_by := coalesce(NEW.deleted_by, auth.uid());
  ELSE
    NEW.deleted_by := NULL;
  END IF;

  IF OLD.ativo AND NOT NEW.ativo AND NEW.deleted_at IS NULL AND NEW.data_desligamento IS NULL THEN
    RAISE EXCEPTION 'DATA_DESLIGAMENTO_OBRIGATORIA';
  END IF;
  IF NOT NEW.ativo AND NEW.deleted_at IS NULL AND NEW.data_desligamento IS NULL THEN
    RAISE EXCEPTION 'DATA_DESLIGAMENTO_OBRIGATORIA';
  END IF;
  IF NEW.ativo AND NEW.data_desligamento IS NOT NULL THEN
    RAISE EXCEPTION 'Funcionario ativo nao pode possuir data de desligamento';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_exclusao_logica_funcionario ON public.funcionarios;
DROP TRIGGER IF EXISTS trg_guard_estado_funcionario ON public.funcionarios;
CREATE TRIGGER trg_guard_estado_funcionario
BEFORE UPDATE OF ativo, data_desligamento, deleted_at, deleted_by ON public.funcionarios
FOR EACH ROW EXECUTE FUNCTION public.guard_estado_funcionario();

CREATE OR REPLACE FUNCTION public.guard_funcionario_duplicado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE existente_excluido boolean;
BEGIN
  SELECT f.deleted_at IS NOT NULL INTO existente_excluido
  FROM public.funcionarios f
  WHERE f.id <> NEW.id
    AND public.normalizar_nome_funcionario(f.nome) = public.normalizar_nome_funcionario(NEW.nome)
  ORDER BY (f.deleted_at IS NULL) DESC
  LIMIT 1;
  IF FOUND THEN
    IF existente_excluido THEN
      RAISE EXCEPTION 'FUNCIONARIO_DUPLICADO_EXCLUIDO' USING ERRCODE = '23505';
    ELSE
      RAISE EXCEPTION 'FUNCIONARIO_DUPLICADO_CADASTRADO' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_lancamento_inativo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f_data date; f_excluido timestamptz;
BEGIN
  SELECT data_desligamento, deleted_at INTO f_data, f_excluido
  FROM public.funcionarios WHERE id = NEW.funcionario_id;
  IF f_excluido IS NOT NULL THEN
    RAISE EXCEPTION 'Funcionario excluido. Nao e possivel criar nova alocacao.';
  END IF;
  IF f_data IS NOT NULL AND NEW.data > f_data THEN
    RAISE EXCEPTION 'Funcionário desligado em %. Não é possível criar nova alocação após esta data.',
      to_char(f_data, 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END;
$$;

DROP VIEW IF EXISTS public.funcionarios_safe;
CREATE VIEW public.funcionarios_safe WITH (security_invoker = on) AS
SELECT f.id, f.nome, f.categoria_mo, f.ativo, f.created_at, f.data_admissao,
  f.data_desligamento, f.deleted_at, f.deleted_by,
  (SELECT s.salario FROM public.get_funcionario_salario_masked(f.id) s) AS salario,
  (SELECT s.encargos FROM public.get_funcionario_salario_masked(f.id) s) AS encargos
FROM public.funcionarios f;

REVOKE SELECT ON public.funcionarios FROM authenticated, anon;
GRANT SELECT (id, nome, categoria_mo, ativo, created_at, data_admissao, data_desligamento, deleted_at, deleted_by)
  ON public.funcionarios TO authenticated;
GRANT SELECT ON public.funcionarios_safe TO authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_estado_funcionario() FROM PUBLIC, anon, authenticated;
