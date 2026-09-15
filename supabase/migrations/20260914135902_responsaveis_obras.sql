-- Modulo cadastral Responsaveis das Obras.
-- Migration aditiva: nao altera alocacoes, jornadas ou dados existentes.
BEGIN;

CREATE TABLE public.responsaveis_cargos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT responsaveis_cargos_nome_valido CHECK (
    length(btrim(nome)) BETWEEN 1 AND 120 AND nome = btrim(nome)
  ),
  CONSTRAINT responsaveis_cargos_ordem_valida CHECK (ordem >= 0)
);

CREATE UNIQUE INDEX responsaveis_cargos_nome_normalizado_uidx
  ON public.responsaveis_cargos (lower(nome));

CREATE TABLE public.responsaveis_pessoas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid UNIQUE REFERENCES public.funcionarios(id) ON DELETE RESTRICT,
  nome_manual text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT responsaveis_pessoas_origem_exclusiva CHECK (
    (funcionario_id IS NOT NULL AND nome_manual IS NULL)
    OR
    (funcionario_id IS NULL AND nome_manual IS NOT NULL)
  ),
  CONSTRAINT responsaveis_pessoas_nome_manual_valido CHECK (
    nome_manual IS NULL
    OR (length(btrim(nome_manual)) BETWEEN 2 AND 160 AND nome_manual = btrim(nome_manual))
  )
);

CREATE INDEX responsaveis_pessoas_nome_manual_idx
  ON public.responsaveis_pessoas (lower(nome_manual))
  WHERE nome_manual IS NOT NULL;

-- Reutiliza o padrao de auditoria temporal ja adotado pelo Obras Control.
CREATE TRIGGER responsaveis_cargos_touch_updated_at
  BEFORE UPDATE ON public.responsaveis_cargos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER responsaveis_pessoas_touch_updated_at
  BEFORE UPDATE ON public.responsaveis_pessoas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.obra_responsabilidade_cargos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id uuid NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  cargo_id uuid NOT NULL REFERENCES public.responsaveis_cargos(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, cargo_id)
);

CREATE INDEX obra_responsabilidade_cargos_obra_idx
  ON public.obra_responsabilidade_cargos (obra_id);

CREATE TABLE public.obra_responsabilidade_pessoas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_cargo_id uuid NOT NULL
    REFERENCES public.obra_responsabilidade_cargos(id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL REFERENCES public.responsaveis_pessoas(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_cargo_id, pessoa_id)
);

CREATE INDEX obra_responsabilidade_pessoas_pessoa_idx
  ON public.obra_responsabilidade_pessoas (pessoa_id);

INSERT INTO public.responsaveis_cargos (nome, ordem)
VALUES
  ('Diretor de Obras', 10),
  ('Gerente de Obras', 20),
  ('Gerente Comercial', 30),
  ('Coordenador', 40),
  ('Supervisor', 50),
  ('Assistente de Engenharia', 60),
  ('Auxiliar de Engenharia', 70),
  ('Assistente Administrativo de Obras', 80),
  ('Auxiliar Administrativo', 90),
  ('Técnico de Segurança', 100),
  ('Comprador', 110),
  ('Financeiro', 120);

ALTER TABLE public.responsaveis_cargos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responsaveis_pessoas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obra_responsabilidade_cargos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obra_responsabilidade_pessoas ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.responsaveis_cargos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.responsaveis_pessoas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obra_responsabilidade_cargos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obra_responsabilidade_pessoas TO authenticated;
GRANT ALL ON public.responsaveis_cargos TO service_role;
GRANT ALL ON public.responsaveis_pessoas TO service_role;
GRANT ALL ON public.obra_responsabilidade_cargos TO service_role;
GRANT ALL ON public.obra_responsabilidade_pessoas TO service_role;

CREATE POLICY "Internos consultam cargos de responsabilidade"
  ON public.responsaveis_cargos FOR SELECT TO authenticated
  USING (public.get_user_level((SELECT auth.uid())) >= 1);
CREATE POLICY "Gerente e diretor cadastram cargos de responsabilidade"
  ON public.responsaveis_cargos FOR INSERT TO authenticated
  WITH CHECK (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'));
CREATE POLICY "Gerente e diretor editam cargos de responsabilidade"
  ON public.responsaveis_cargos FOR UPDATE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'));
CREATE POLICY "Gerente e diretor excluem cargos de responsabilidade"
  ON public.responsaveis_cargos FOR DELETE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'));

CREATE POLICY "Internos consultam pessoas de responsabilidade"
  ON public.responsaveis_pessoas FOR SELECT TO authenticated
  USING (public.get_user_level((SELECT auth.uid())) >= 1);
CREATE POLICY "Gerente e diretor cadastram pessoas de responsabilidade"
  ON public.responsaveis_pessoas FOR INSERT TO authenticated
  WITH CHECK (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'));
CREATE POLICY "Gerente e diretor editam pessoas de responsabilidade"
  ON public.responsaveis_pessoas FOR UPDATE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'));
CREATE POLICY "Gerente e diretor excluem pessoas de responsabilidade"
  ON public.responsaveis_pessoas FOR DELETE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'));

CREATE POLICY "Internos consultam cargos das obras"
  ON public.obra_responsabilidade_cargos FOR SELECT TO authenticated
  USING (
    public.get_user_level((SELECT auth.uid())) >= 1
    AND EXISTS (
      SELECT 1 FROM public.obras o
      WHERE o.id = obra_responsabilidade_cargos.obra_id
        AND o.visivel_obras_control IS DISTINCT FROM false
    )
  );
CREATE POLICY "Gerente e diretor cadastram cargos das obras"
  ON public.obra_responsabilidade_cargos FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'))
    AND EXISTS (
      SELECT 1 FROM public.obras o
      WHERE o.id = obra_responsabilidade_cargos.obra_id
        AND o.visivel_obras_control IS DISTINCT FROM false
    )
  );
CREATE POLICY "Gerente e diretor editam cargos das obras"
  ON public.obra_responsabilidade_cargos FOR UPDATE TO authenticated
  USING (
    (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'))
    AND EXISTS (
      SELECT 1 FROM public.obras o
      WHERE o.id = obra_responsabilidade_cargos.obra_id
        AND o.visivel_obras_control IS DISTINCT FROM false
    )
  )
  WITH CHECK (
    (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'))
    AND EXISTS (
      SELECT 1 FROM public.obras o
      WHERE o.id = obra_responsabilidade_cargos.obra_id
        AND o.visivel_obras_control IS DISTINCT FROM false
    )
  );
CREATE POLICY "Gerente e diretor excluem cargos das obras"
  ON public.obra_responsabilidade_cargos FOR DELETE TO authenticated
  USING (
    (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'))
    AND EXISTS (
      SELECT 1 FROM public.obras o
      WHERE o.id = obra_responsabilidade_cargos.obra_id
        AND o.visivel_obras_control IS DISTINCT FROM false
    )
  );

CREATE POLICY "Internos consultam pessoas das obras"
  ON public.obra_responsabilidade_pessoas FOR SELECT TO authenticated
  USING (
    public.get_user_level((SELECT auth.uid())) >= 1
    AND EXISTS (
      SELECT 1
      FROM public.obra_responsabilidade_cargos orc
      JOIN public.obras o ON o.id = orc.obra_id
      WHERE orc.id = obra_responsabilidade_pessoas.obra_cargo_id
        AND o.visivel_obras_control IS DISTINCT FROM false
    )
  );
CREATE POLICY "Gerente e diretor vinculam pessoas as obras"
  ON public.obra_responsabilidade_pessoas FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'))
    AND EXISTS (
      SELECT 1
      FROM public.obra_responsabilidade_cargos orc
      JOIN public.obras o ON o.id = orc.obra_id
      WHERE orc.id = obra_responsabilidade_pessoas.obra_cargo_id
        AND o.visivel_obras_control IS DISTINCT FROM false
    )
  );
CREATE POLICY "Gerente e diretor editam vinculos das obras"
  ON public.obra_responsabilidade_pessoas FOR UPDATE TO authenticated
  USING (
    (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'))
    AND EXISTS (
      SELECT 1
      FROM public.obra_responsabilidade_cargos orc
      JOIN public.obras o ON o.id = orc.obra_id
      WHERE orc.id = obra_responsabilidade_pessoas.obra_cargo_id
        AND o.visivel_obras_control IS DISTINCT FROM false
    )
  )
  WITH CHECK (
    (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'))
    AND EXISTS (
      SELECT 1
      FROM public.obra_responsabilidade_cargos orc
      JOIN public.obras o ON o.id = orc.obra_id
      WHERE orc.id = obra_responsabilidade_pessoas.obra_cargo_id
        AND o.visivel_obras_control IS DISTINCT FROM false
    )
  );
CREATE POLICY "Gerente e diretor excluem vinculos das obras"
  ON public.obra_responsabilidade_pessoas FOR DELETE TO authenticated
  USING (
    (public.has_role((SELECT auth.uid()), 'gerente') OR public.has_role((SELECT auth.uid()), 'diretor'))
    AND EXISTS (
      SELECT 1
      FROM public.obra_responsabilidade_cargos orc
      JOIN public.obras o ON o.id = orc.obra_id
      WHERE orc.id = obra_responsabilidade_pessoas.obra_cargo_id
        AND o.visivel_obras_control IS DISTINCT FROM false
    )
  );

-- Leitura achatada para manter o nome do funcionario na fonte original e
-- calcular Compartilhado por obras distintas, sem expor dados de RH.
CREATE OR REPLACE FUNCTION public.obras_control_responsaveis_lista()
RETURNS TABLE (
  obra_id uuid,
  obra_nome text,
  obra_status text,
  obra_cargo_id uuid,
  cargo_id uuid,
  cargo_nome text,
  cargo_ordem integer,
  vinculo_id uuid,
  pessoa_id uuid,
  pessoa_nome text,
  pessoa_tipo text,
  funcionario_id uuid,
  total_obras_pessoa bigint,
  compartilhado boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH totais AS (
    SELECT orp.pessoa_id, count(DISTINCT orc.obra_id) AS total_obras
    FROM public.obra_responsabilidade_pessoas orp
    JOIN public.obra_responsabilidade_cargos orc ON orc.id = orp.obra_cargo_id
    JOIN public.obras o ON o.id = orc.obra_id
    WHERE o.visivel_obras_control IS DISTINCT FROM false
    GROUP BY orp.pessoa_id
  )
  SELECT
    o.id AS obra_id,
    o.nome::text AS obra_nome,
    o.status::text AS obra_status,
    orc.id AS obra_cargo_id,
    c.id AS cargo_id,
    c.nome::text AS cargo_nome,
    c.ordem AS cargo_ordem,
    orp.id AS vinculo_id,
    p.id AS pessoa_id,
    (CASE WHEN p.funcionario_id IS NOT NULL THEN f.nome ELSE p.nome_manual END)::text
      AS pessoa_nome,
    (CASE
      WHEN p.id IS NULL THEN NULL
      WHEN p.funcionario_id IS NOT NULL THEN 'funcionario'
      ELSE 'manual'
    END)::text
      AS pessoa_tipo,
    p.funcionario_id AS funcionario_id,
    COALESCE(t.total_obras, 0)::bigint AS total_obras_pessoa,
    (COALESCE(t.total_obras, 0) > 1)::boolean AS compartilhado
  FROM public.obras o
  LEFT JOIN public.obra_responsabilidade_cargos orc ON orc.obra_id = o.id
  LEFT JOIN public.responsaveis_cargos c ON c.id = orc.cargo_id
  LEFT JOIN public.obra_responsabilidade_pessoas orp ON orp.obra_cargo_id = orc.id
  LEFT JOIN public.responsaveis_pessoas p ON p.id = orp.pessoa_id
  LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
  LEFT JOIN totais t ON t.pessoa_id = p.id
  WHERE auth.uid() IS NOT NULL
    AND public.get_user_level(auth.uid()) >= 1
    AND o.visivel_obras_control IS DISTINCT FROM false
  ORDER BY o.nome, c.ordem, c.nome, pessoa_nome;
$function$;

REVOKE ALL ON FUNCTION public.obras_control_responsaveis_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_control_responsaveis_lista() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.obras_control_responsaveis_pessoas_opcoes()
RETURNS TABLE (
  opcao_id text,
  pessoa_id uuid,
  funcionario_id uuid,
  nome text,
  tipo text,
  detalhe text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    ('funcionario:' || f.id::text)::text AS opcao_id,
    p.id AS pessoa_id,
    f.id AS funcionario_id,
    f.nome::text AS nome,
    'funcionario'::text AS tipo,
    f.categoria_mo::text AS detalhe
  FROM public.funcionarios f
  LEFT JOIN public.responsaveis_pessoas p ON p.funcionario_id = f.id
  WHERE auth.uid() IS NOT NULL
    AND public.get_user_level(auth.uid()) >= 1
    AND f.ativo
    AND f.deleted_at IS NULL
    AND f.visivel_obras_control IS DISTINCT FROM false
  UNION ALL
  SELECT
    ('manual:' || p.id::text)::text AS opcao_id,
    p.id AS pessoa_id,
    NULL::uuid AS funcionario_id,
    p.nome_manual::text AS nome,
    'manual'::text AS tipo,
    'Cadastro manual'::text AS detalhe
  FROM public.responsaveis_pessoas p
  WHERE auth.uid() IS NOT NULL
    AND public.get_user_level(auth.uid()) >= 1
    AND p.funcionario_id IS NULL
  ORDER BY nome;
$function$;

REVOKE ALL ON FUNCTION public.obras_control_responsaveis_pessoas_opcoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_control_responsaveis_pessoas_opcoes() TO authenticated, service_role;

COMMIT;
