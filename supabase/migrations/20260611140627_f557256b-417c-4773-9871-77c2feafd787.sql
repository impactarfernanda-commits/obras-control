
CREATE OR REPLACE FUNCTION public.can_view_salario(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('gerente', 'diretor')
  )
$$;

CREATE OR REPLACE VIEW public.funcionarios_safe AS
SELECT
  id,
  nome,
  categoria_mo,
  ativo,
  created_at,
  CASE WHEN public.can_view_salario(auth.uid()) THEN salario ELSE NULL END AS salario,
  CASE WHEN public.can_view_salario(auth.uid()) THEN encargos ELSE NULL END AS encargos
FROM public.funcionarios;

GRANT SELECT ON public.funcionarios_safe TO authenticated;

DROP POLICY IF EXISTS "Ler funcionarios (autenticados)" ON public.funcionarios;
CREATE POLICY "Ler funcionarios (gerente/diretor)"
  ON public.funcionarios FOR SELECT
  TO authenticated
  USING (public.can_view_salario(auth.uid()));

INSERT INTO public.user_roles (user_id, role)
VALUES ('2efdc2fa-ab5b-423d-93fa-c1c28def6b06', 'diretor')
ON CONFLICT (user_id, role) DO NOTHING;
