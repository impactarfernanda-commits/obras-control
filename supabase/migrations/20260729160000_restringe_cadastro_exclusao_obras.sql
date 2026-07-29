-- Restringe cadastro e exclusao de centros de custo sem impedir que usuarios
-- autenticados alterem somente o status.
-- Migration idempotente: nao altera nem remove dados existentes.

CREATE OR REPLACE FUNCTION public.guard_obras_cadastro_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF public.has_role(auth.uid(), 'gerente'::public.app_role)
     OR public.has_role(auth.uid(), 'diretor'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.nome IS DISTINCT FROM OLD.nome
     OR NEW.data_inicio IS DISTINCT FROM OLD.data_inicio
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.visivel_obras_control IS DISTINCT FROM OLD.visivel_obras_control
     OR NEW.visivel_passagens IS DISTINCT FROM OLD.visivel_passagens
     OR NEW.escopo_passagens IS DISTINCT FROM OLD.escopo_passagens
     OR NEW.tipo_centro_custo IS DISTINCT FROM OLD.tipo_centro_custo THEN
    RAISE EXCEPTION 'Apenas gerentes e diretores podem editar o cadastro do centro de custo';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_obras_cadastro_update ON public.obras;
CREATE TRIGGER trg_guard_obras_cadastro_update
BEFORE UPDATE ON public.obras
FOR EACH ROW
EXECUTE FUNCTION public.guard_obras_cadastro_update();

DROP POLICY IF EXISTS "Atualizar obras (diretor ou alocado)" ON public.obras;
DROP POLICY IF EXISTS "Atualizar obras (autenticados; status ou gerente/diretor)" ON public.obras;
CREATE POLICY "Atualizar obras (autenticados; status ou gerente/diretor)"
ON public.obras
FOR UPDATE
TO authenticated
USING (public.get_user_level(auth.uid()) >= 1)
WITH CHECK (public.get_user_level(auth.uid()) >= 1);

DROP POLICY IF EXISTS "Excluir obras (diretor)" ON public.obras;
DROP POLICY IF EXISTS "Excluir obras (gerente/diretor)" ON public.obras;
CREATE POLICY "Excluir obras (gerente/diretor)"
ON public.obras
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'gerente'::public.app_role)
  OR public.has_role(auth.uid(), 'diretor'::public.app_role)
);

COMMENT ON FUNCTION public.guard_obras_cadastro_update() IS
  'Permite a usuarios comuns alterar somente status; cadastro completo fica restrito a gerente/diretor.';
