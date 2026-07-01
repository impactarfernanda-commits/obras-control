CREATE OR REPLACE FUNCTION public.sync_funcionarios_salario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.funcionarios
     SET salario = NEW.salario,
         encargos = NEW.encargos
   WHERE categoria_mo = NEW.categoria
     AND ativo = true;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS categoria_salarios_after_update ON public.categoria_salarios;
CREATE TRIGGER categoria_salarios_after_update
  AFTER UPDATE ON public.categoria_salarios
  FOR EACH ROW
  WHEN (OLD.salario IS DISTINCT FROM NEW.salario OR OLD.encargos IS DISTINCT FROM NEW.encargos)
  EXECUTE FUNCTION public.sync_funcionarios_salario();