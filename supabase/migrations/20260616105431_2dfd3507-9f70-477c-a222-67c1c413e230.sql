INSERT INTO public.user_roles (user_id, role)
VALUES ('2efdc2fa-ab5b-423d-93fa-c1c28def6b06', 'diretor')
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM public.user_roles
WHERE user_id = '2efdc2fa-ab5b-423d-93fa-c1c28def6b06'
  AND role <> 'diretor';