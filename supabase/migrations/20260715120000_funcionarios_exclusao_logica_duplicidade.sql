-- Exclusao logica e deduplicacao de funcionarios sem alterar historico.
ALTER TABLE public.funcionarios
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_by uuid NULL;

CREATE OR REPLACE FUNCTION public.normalizar_nome_funcionario(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN trim(regexp_replace(upper(translate(coalesce(value, ''),
  'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
  'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
  '[[:space:]]+', ' ', 'g'));

CREATE OR REPLACE FUNCTION public.guard_funcionario_duplicado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existente_ativo boolean;
BEGIN
  SELECT f.ativo INTO existente_ativo
  FROM public.funcionarios f
  WHERE f.id <> NEW.id
    AND public.normalizar_nome_funcionario(f.nome) = public.normalizar_nome_funcionario(NEW.nome)
  ORDER BY f.ativo DESC
  LIMIT 1;

  IF FOUND THEN
    IF existente_ativo THEN
      RAISE EXCEPTION 'FUNCIONARIO_DUPLICADO_ATIVO' USING ERRCODE = '23505';
    ELSE
      RAISE EXCEPTION 'FUNCIONARIO_DUPLICADO_INATIVO' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_funcionario_duplicado ON public.funcionarios;
CREATE TRIGGER trg_guard_funcionario_duplicado
BEFORE INSERT OR UPDATE OF nome ON public.funcionarios
FOR EACH ROW EXECUTE FUNCTION public.guard_funcionario_duplicado();

-- Cria a protecao concorrente somente quando o legado nao contem conflitos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.funcionarios
    WHERE ativo AND deleted_at IS NULL
    GROUP BY public.normalizar_nome_funcionario(nome)
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS funcionarios_nome_ativo_normalizado_uidx
      ON public.funcionarios (public.normalizar_nome_funcionario(nome))
      WHERE ativo AND deleted_at IS NULL;
  ELSE
    RAISE WARNING 'Indice unico de funcionarios ativos nao criado: existem nomes normalizados duplicados. Corrija-os e reaplique a migration.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_exclusao_logica_funcionario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at OR OLD.deleted_by IS DISTINCT FROM NEW.deleted_by)
     AND OLD.ativo = NEW.ativo
     AND NOT (public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'diretor')) THEN
    RAISE EXCEPTION 'Apenas gerentes e diretores podem alterar metadados de exclusao';
  END IF;
  IF OLD.ativo AND NOT NEW.ativo THEN
    IF NOT (public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'diretor')) THEN
      RAISE EXCEPTION 'Apenas gerentes e diretores podem excluir funcionarios';
    END IF;
    NEW.deleted_at := coalesce(NEW.deleted_at, now());
    NEW.deleted_by := auth.uid();
  ELSIF NOT OLD.ativo AND NEW.ativo THEN
    IF NOT (public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'diretor')) THEN
      RAISE EXCEPTION 'Apenas gerentes e diretores podem reativar funcionarios';
    END IF;
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_exclusao_logica_funcionario ON public.funcionarios;
CREATE TRIGGER trg_guard_exclusao_logica_funcionario
BEFORE UPDATE OF ativo, deleted_at, deleted_by ON public.funcionarios
FOR EACH ROW EXECUTE FUNCTION public.guard_exclusao_logica_funcionario();

-- Mantem o mascaramento salarial e expoe apenas metadados nao sensiveis.
DROP VIEW IF EXISTS public.funcionarios_safe;
CREATE VIEW public.funcionarios_safe WITH (security_invoker = on) AS
SELECT f.id, f.nome, f.categoria_mo, f.ativo, f.created_at, f.data_desligamento,
  f.deleted_at, f.deleted_by,
  (SELECT s.salario FROM public.get_funcionario_salario_masked(f.id) s) AS salario,
  (SELECT s.encargos FROM public.get_funcionario_salario_masked(f.id) s) AS encargos
FROM public.funcionarios f;

REVOKE SELECT ON public.funcionarios FROM authenticated, anon;
GRANT SELECT (id, nome, categoria_mo, ativo, created_at, data_desligamento, deleted_at, deleted_by)
  ON public.funcionarios TO authenticated;
GRANT SELECT ON public.funcionarios_safe TO authenticated;

REVOKE EXECUTE ON FUNCTION public.normalizar_nome_funcionario(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalizar_nome_funcionario(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.guard_funcionario_duplicado() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_exclusao_logica_funcionario() FROM PUBLIC, anon, authenticated;
