-- Permite que coordenadores corrijam horas sem ampliar permissoes de exclusao.
-- As regras do criador, gerente e diretor permanecem inalteradas.
DROP POLICY IF EXISTS "Creator or manager can update alocacoes" ON public.alocacoes;
DROP POLICY IF EXISTS "Creator coordinator or manager can update alocacoes" ON public.alocacoes;

CREATE POLICY "Creator coordinator or manager can update alocacoes"
  ON public.alocacoes
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'coordenador'::public.app_role)
    OR public.get_user_level(auth.uid()) >= 2
  )
  WITH CHECK (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'coordenador'::public.app_role)
    OR public.get_user_level(auth.uid()) >= 2
  );

DROP POLICY IF EXISTS "Creator or manager can update registros" ON public.registros_horas;
DROP POLICY IF EXISTS "Creator coordinator or manager can update registros" ON public.registros_horas;

CREATE POLICY "Creator coordinator or manager can update registros"
  ON public.registros_horas
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'coordenador'::public.app_role)
    OR public.get_user_level(auth.uid()) >= 2
  )
  WITH CHECK (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'coordenador'::public.app_role)
    OR public.get_user_level(auth.uid()) >= 2
  );
