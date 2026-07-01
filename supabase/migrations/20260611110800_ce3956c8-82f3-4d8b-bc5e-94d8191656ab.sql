
DROP POLICY IF EXISTS "Authenticated can update alocacoes" ON public.alocacoes;
DROP POLICY IF EXISTS "Authenticated can delete alocacoes" ON public.alocacoes;

CREATE POLICY "Creator or manager can update alocacoes"
  ON public.alocacoes FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.get_user_level(auth.uid()) >= 2)
  WITH CHECK (created_by = auth.uid() OR public.get_user_level(auth.uid()) >= 2);

CREATE POLICY "Creator or manager can delete alocacoes"
  ON public.alocacoes FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.get_user_level(auth.uid()) >= 2);
