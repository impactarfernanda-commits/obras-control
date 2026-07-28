-- Retorna somente dados profissionais minimos para a auditoria de alocacoes.
-- A funcao preserva a RLS existente de users_profiles e autoriza apenas os
-- papeis que podem visualizar a autoria no popover do calendario.
CREATE OR REPLACE FUNCTION public.get_allocation_audit_users(p_user_ids uuid[])
RETURNS TABLE (
  id uuid,
  full_name text,
  email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.email
  FROM public.users_profiles AS p
  WHERE p.id = ANY(COALESCE(p_user_ids, ARRAY[]::uuid[]))
    AND EXISTS (
      SELECT 1
      FROM public.user_roles AS r
      WHERE r.user_id = auth.uid()
        AND r.role IN ('coordenador', 'gerente', 'diretor')
    );
$$;

REVOKE ALL ON FUNCTION public.get_allocation_audit_users(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_allocation_audit_users(uuid[]) TO authenticated;
