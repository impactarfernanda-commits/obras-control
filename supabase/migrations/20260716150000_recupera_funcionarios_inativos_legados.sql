-- Recupera funcionarios inativos legados como desligados, nao como excluidos.
-- A regra antiga marcava como excluido todo funcionario desligado (ativo = false).
-- Na regra nova, uma exclusao real nao altera ativo nem preenche data_desligamento.

-- Esta migration precisa ajustar dados legados e, por isso, desabilita
-- temporariamente os triggers de usuario da tabela funcionarios.
-- Isso evita que o trigger de permissao bloqueie a correcao historica.
ALTER TABLE public.funcionarios DISABLE TRIGGER USER;

UPDATE public.funcionarios
SET 
  deleted_at = NULL,
  deleted_by = NULL
WHERE ativo = false
  AND data_desligamento IS NOT NULL
  AND (deleted_at IS NOT NULL OR deleted_by IS NOT NULL);

ALTER TABLE public.funcionarios ENABLE TRIGGER USER;