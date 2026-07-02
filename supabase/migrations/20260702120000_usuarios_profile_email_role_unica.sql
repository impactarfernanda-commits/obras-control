-- Sincroniza usuarios do auth.users com public.users_profiles e garante uma unica role principal.
-- Nao expoe service_role ao frontend. A tela usa server functions seguras.

ALTER TABLE public.users_profiles
  ADD COLUMN IF NOT EXISTS email text;

-- Garante profile publico para usuarios ja existentes no Auth.
INSERT INTO public.users_profiles (id, full_name, email, created_at)
SELECT
  u.id,
  COALESCE(NULLIF(u.raw_user_meta_data->>'full_name', ''), split_part(COALESCE(u.email, ''), '@', 1), ''),
  u.email,
  COALESCE(u.created_at, now())
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = CASE
    WHEN NULLIF(public.users_profiles.full_name, '') IS NULL THEN EXCLUDED.full_name
    ELSE public.users_profiles.full_name
  END;

-- Garante role inicial para usuarios sem role.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'assistente'::public.app_role
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id
);

-- Remove roles duplicadas, mantendo a de maior prioridade:
-- diretor > gerente > coordenador > supervisor > assistente.
WITH ranked AS (
  SELECT
    id,
    user_id,
    role,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY
        CASE role
          WHEN 'diretor' THEN 5
          WHEN 'gerente' THEN 4
          WHEN 'coordenador' THEN 3
          WHEN 'supervisor' THEN 2
          WHEN 'assistente' THEN 1
          ELSE 0
        END DESC,
        created_at ASC,
        id ASC
    ) AS rn
  FROM public.user_roles
)
DELETE FROM public.user_roles ur
USING ranked r
WHERE ur.id = r.id
  AND r.rn > 1;

-- A partir daqui, um usuario so pode ter uma role principal.
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_role_per_user_uidx
  ON public.user_roles (user_id);

-- Atualiza/cria profile ao criar ou atualizar usuario no Auth.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users_profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = CASE
      WHEN NULLIF(public.users_profiles.full_name, '') IS NULL THEN EXCLUDED.full_name
      ELSE public.users_profiles.full_name
    END;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'assistente'::public.app_role)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Consulta de conferencia apos aplicar:
-- SELECT user_id, count(*) AS roles
-- FROM public.user_roles
-- GROUP BY user_id
-- HAVING count(*) > 1;
