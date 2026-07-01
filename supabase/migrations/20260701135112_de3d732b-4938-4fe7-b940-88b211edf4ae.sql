
-- 1. categoria_salarios: restrict SELECT to managers/directors
DROP POLICY IF EXISTS "Ler categoria_salarios (autenticados)" ON public.categoria_salarios;
CREATE POLICY "Ler categoria_salarios (gerente/diretor)"
  ON public.categoria_salarios
  FOR SELECT TO authenticated
  USING (public.can_view_salario(auth.uid()));

-- 2. user_roles: add explicit write policies restricted to diretor
CREATE POLICY "Diretor pode inserir roles"
  ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'diretor'::app_role));
CREATE POLICY "Diretor pode atualizar roles"
  ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'diretor'::app_role));
CREATE POLICY "Diretor pode remover roles"
  ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'diretor'::app_role));

-- 3. custos_indiretos_categorias: replace WITH CHECK (true) with authenticated check
DROP POLICY IF EXISTS "auth insert categorias" ON public.custos_indiretos_categorias;
CREATE POLICY "auth insert categorias"
  ON public.custos_indiretos_categorias
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- 4. funcionarios_safe view: switch from SECURITY DEFINER to SECURITY INVOKER
--    Add a helper SECURITY DEFINER function to mask salary/encargos so managers
--    still see salary but non-managers see NULL, without leaking the base columns.
CREATE OR REPLACE FUNCTION public.get_funcionario_salario_masked(_id uuid)
RETURNS TABLE(salario numeric, encargos numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    CASE WHEN public.can_view_salario(auth.uid()) THEN f.salario ELSE NULL END,
    CASE WHEN public.can_view_salario(auth.uid()) THEN f.encargos ELSE NULL END
  FROM public.funcionarios f
  WHERE f.id = _id
$$;
REVOKE ALL ON FUNCTION public.get_funcionario_salario_masked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_funcionario_salario_masked(uuid) TO authenticated, service_role;

-- Broaden funcionarios SELECT (rows visible to all authenticated), but hide
-- sensitive columns via column privileges. Managers read salary through the
-- masked helper called by the invoker view.
DROP POLICY IF EXISTS "Ler funcionarios (gerente/diretor)" ON public.funcionarios;
CREATE POLICY "Ler funcionarios (autenticados)"
  ON public.funcionarios
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

REVOKE SELECT ON public.funcionarios FROM authenticated, anon;
GRANT SELECT (id, nome, categoria_mo, ativo, created_at, data_desligamento)
  ON public.funcionarios TO authenticated;

-- Recreate view with security_invoker
DROP VIEW IF EXISTS public.funcionarios_safe;
CREATE VIEW public.funcionarios_safe
  WITH (security_invoker = on) AS
SELECT
  f.id,
  f.nome,
  f.categoria_mo,
  f.ativo,
  f.created_at,
  f.data_desligamento,
  (SELECT s.salario  FROM public.get_funcionario_salario_masked(f.id) s) AS salario,
  (SELECT s.encargos FROM public.get_funcionario_salario_masked(f.id) s) AS encargos
FROM public.funcionarios f;

GRANT SELECT ON public.funcionarios_safe TO authenticated;

-- 5. Lock down SECURITY DEFINER trigger functions (not meant to be called via API)
REVOKE EXECUTE ON FUNCTION public.handle_new_user()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_funcionarios_salario()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_funcionarios_salario()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_categoria_salario()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_data_desligamento()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_lancamento_inativo()    FROM PUBLIC, anon, authenticated;
