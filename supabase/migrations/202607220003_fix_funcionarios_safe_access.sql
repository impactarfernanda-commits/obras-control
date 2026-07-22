-- Fonte de leitura dedicada ao Obras Control.
-- A view funcionarios_safe usa security_invoker e pode retornar zero linhas
-- quando as roles do banco compartilhado nao satisfazem a RLS da tabela base.
CREATE OR REPLACE FUNCTION public.obras_control_funcionarios_safe()
RETURNS TABLE (
  id uuid,
  nome text,
  categoria_mo text,
  ativo boolean,
  created_at timestamptz,
  data_admissao date,
  data_desligamento date,
  deleted_at timestamptz,
  deleted_by uuid,
  salario numeric,
  encargos numeric,
  visivel_obras_control boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $function$
  SELECT
    f.id,
    f.nome,
    f.categoria_mo,
    f.ativo,
    f.created_at,
    f.data_admissao,
    f.data_desligamento,
    f.deleted_at,
    f.deleted_by,
    CASE WHEN public.can_view_salario(auth.uid()) THEN f.salario ELSE NULL END,
    CASE WHEN public.can_view_salario(auth.uid()) THEN f.encargos ELSE NULL END,
    f.visivel_obras_control
  FROM public.funcionarios AS f
  WHERE auth.uid() IS NOT NULL
    AND f.visivel_obras_control IS DISTINCT FROM false
  ORDER BY f.nome;
$function$;

REVOKE ALL ON FUNCTION public.obras_control_funcionarios_safe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_control_funcionarios_safe() TO authenticated, service_role;

COMMENT ON FUNCTION public.obras_control_funcionarios_safe() IS
  'Lista segura de funcionarios visiveis para o Obras Control; salario e encargos seguem can_view_salario.';
