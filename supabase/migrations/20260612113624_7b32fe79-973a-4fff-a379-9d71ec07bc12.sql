ALTER TABLE public.categoria_salarios ADD COLUMN IF NOT EXISTS seguro_vida numeric NOT NULL DEFAULT 0;

UPDATE public.categoria_salarios SET seguro_vida = v.valor FROM (VALUES
  ('Ajudante', 20.77),
  ('Armador', 25.40),
  ('Assist. administrativo', 22.30),
  ('Assistente de Engenharia', 36.12),
  ('Carpinteiro', 25.40),
  ('Encarregado de montagem', 51.16),
  ('Líder de montagem', 42.91),
  ('Meio oficial montador', 25.00),
  ('Mestre de obras', 50.99),
  ('Montador', 35.99),
  ('Operador de Escavadeira', 29.67),
  ('Pedreiro', 25.40),
  ('Supervisor', 75.41),
  ('Técnico de Segurança', 38.78)
) AS v(categoria, valor)
WHERE public.categoria_salarios.categoria = v.categoria;