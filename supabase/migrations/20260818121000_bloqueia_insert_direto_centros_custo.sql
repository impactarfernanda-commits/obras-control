-- FASE 2/2: aplicar SOMENTE depois que o frontend com a RPC estiver publicado
-- e validado. A partir daqui, criacoes devem passar pela RPC de payload fechado.

DROP POLICY IF EXISTS "Criar obras (autenticados)" ON public.obras;
REVOKE INSERT ON TABLE public.obras FROM authenticated;

COMMENT ON FUNCTION public.obras_criar_centro_custo(text, text) IS
  'FASE 2/2 concluida: criacao disponivel somente pela RPC para usuarios internos autenticados.';
