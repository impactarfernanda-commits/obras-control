
ALTER TABLE public.funcionarios ADD COLUMN IF NOT EXISTS data_desligamento DATE;

DROP VIEW IF EXISTS public.funcionarios_safe;
CREATE VIEW public.funcionarios_safe AS
SELECT
  id, nome, categoria_mo, ativo, created_at, data_desligamento,
  CASE WHEN can_view_salario(auth.uid()) THEN salario ELSE NULL::numeric END AS salario,
  CASE WHEN can_view_salario(auth.uid()) THEN encargos ELSE NULL::numeric END AS encargos
FROM public.funcionarios;
GRANT SELECT ON public.funcionarios_safe TO authenticated;

CREATE OR REPLACE FUNCTION public.set_data_desligamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ativo = true AND NEW.ativo = false AND NEW.data_desligamento IS NULL THEN
      NEW.data_desligamento := CURRENT_DATE;
    ELSIF OLD.ativo = false AND NEW.ativo = true THEN
      NEW.data_desligamento := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_set_data_desligamento ON public.funcionarios;
CREATE TRIGGER trg_set_data_desligamento
BEFORE UPDATE ON public.funcionarios
FOR EACH ROW EXECUTE FUNCTION public.set_data_desligamento();

UPDATE public.funcionarios SET data_desligamento = CURRENT_DATE
WHERE ativo = false AND data_desligamento IS NULL;

CREATE OR REPLACE FUNCTION public.guard_lancamento_inativo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f_ativo boolean; f_data DATE;
BEGIN
  SELECT ativo, data_desligamento INTO f_ativo, f_data
    FROM public.funcionarios WHERE id = NEW.funcionario_id;
  IF f_ativo = false AND f_data IS NOT NULL AND NEW.data > f_data THEN
    RAISE EXCEPTION 'Funcionário desligado em %; não é possível lançar dias posteriores',
      to_char(f_data, 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_aloc_inativo ON public.alocacoes;
CREATE TRIGGER trg_guard_aloc_inativo
BEFORE INSERT OR UPDATE ON public.alocacoes
FOR EACH ROW EXECUTE FUNCTION public.guard_lancamento_inativo();
DROP TRIGGER IF EXISTS trg_guard_reg_inativo ON public.registros_horas;
CREATE TRIGGER trg_guard_reg_inativo
BEFORE INSERT OR UPDATE ON public.registros_horas
FOR EACH ROW EXECUTE FUNCTION public.guard_lancamento_inativo();
