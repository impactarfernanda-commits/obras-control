
DROP POLICY IF EXISTS "Ler obras (gerente+ ou alocado)" ON public.obras;

CREATE POLICY "Autenticados leem obras"
ON public.obras
FOR SELECT
TO authenticated
USING (public.get_user_level(auth.uid()) >= 1);

-- Limpar duplicatas mantendo a mais recente por nome
DELETE FROM public.obras o
USING public.obras o2
WHERE o.nome = o2.nome
  AND o.created_at < o2.created_at;

ALTER TABLE public.obras ADD CONSTRAINT obras_nome_unique UNIQUE (nome);
