-- Suspensao temporaria da regra de apontamento diario de Supervisor
-- ate definicao da direcao.
CREATE OR REPLACE FUNCTION public.guard_supervisor_sem_apontamento_diario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;
