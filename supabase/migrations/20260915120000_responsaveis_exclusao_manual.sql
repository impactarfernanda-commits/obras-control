-- Complemento incremental: restringe DELETE de pessoas à origem manual.
-- Sem mudanças de FKs, dados, funções ou policies de outros módulos.
BEGIN;

ALTER POLICY "Gerente e diretor excluem pessoas de responsabilidade"
  ON public.responsaveis_pessoas
  USING (
    funcionario_id IS NULL
    AND (
      public.has_role((SELECT auth.uid()), 'gerente')
      OR public.has_role((SELECT auth.uid()), 'diretor')
    )
  );

COMMIT;
