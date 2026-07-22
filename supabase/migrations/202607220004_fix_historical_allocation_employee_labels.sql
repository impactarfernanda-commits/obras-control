-- Resolve apenas os funcionarios referenciados pelo cliente para preservar
-- rotulos historicos, sem expor salario ou encargos.
CREATE OR REPLACE FUNCTION public.obras_control_funcionarios_por_ids(p_ids uuid[])
RETURNS TABLE (
  id uuid,
  nome text,
  categoria_mo text,
  ativo boolean,
  data_desligamento date,
  deleted_at timestamptz,
  visivel_obras_control boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $function$
  SELECT f.id, f.nome, f.categoria_mo, f.ativo, f.data_desligamento,
    f.deleted_at, f.visivel_obras_control
  FROM public.funcionarios AS f
  WHERE auth.uid() IS NOT NULL
    AND f.id = ANY(coalesce(p_ids, ARRAY[]::uuid[]));
$function$;

REVOKE ALL ON FUNCTION public.obras_control_funcionarios_por_ids(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_control_funcionarios_por_ids(uuid[])
  TO authenticated, service_role;

COMMENT ON FUNCTION public.obras_control_funcionarios_por_ids(uuid[]) IS
  'Resolve rotulos de funcionarios referenciados no historico do Obras Control, sem dados salariais.';
