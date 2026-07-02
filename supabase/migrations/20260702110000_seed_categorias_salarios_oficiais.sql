-- Seed seguro dos cargos oficiais usados pela importacao legado.
-- Nao apaga dados existentes; insere categorias ausentes e atualiza valores oficiais.
INSERT INTO public.categorias (nome, tipo)
VALUES
  ('AJUDANTE', 'MOD'),
  ('ARMADOR', 'MOD'),
  ('ASSISTENTE ADMINISTRATIVO OBRAS', 'MOD'),
  ('ASSISTENTE DE ENGENHARIA', 'MOD'),
  ('CARPINTEIRO', 'MOD'),
  ('ENCARREGADO DE MONTAGEM', 'MOD'),
  ('LIDER DE MONTAGEM', 'MOD'),
  ('MEIO OFICIAL MONTADOR', 'MOD'),
  ('MESTRE DE OBRAS', 'MOD'),
  ('MONTADOR', 'MOD'),
  ('OPERADOR DE ESCAVADEIRA', 'MOD'),
  ('PEDREIRO', 'MOD'),
  ('SUPERVISOR I', 'MOD'),
  ('SUPERVISOR II', 'MOD'),
  ('SUPERVISOR III', 'MOD'),
  ('TECNICO DE SEGURANCA DO TRABALHO', 'MOD')
ON CONFLICT (nome) DO NOTHING;

INSERT INTO public.categoria_salarios (categoria, salario, encargos, seguro_vida)
VALUES
  ('AJUDANTE', 2142.80, 788.55, 20.77),
  ('ARMADOR', 2620.20, 964.23, 25.40),
  ('ASSISTENTE ADMINISTRATIVO OBRAS', 2300.00, 846.40, 22.30),
  ('ASSISTENTE DE ENGENHARIA', 3520.18, 1295.43, 36.12),
  ('CARPINTEIRO', 2620.20, 964.23, 25.40),
  ('ENCARREGADO DE MONTAGEM', 5277.86, 1942.25, 51.16),
  ('LIDER DE MONTAGEM', 4426.41, 1628.92, 42.91),
  ('MEIO OFICIAL MONTADOR', 2525.49, 929.38, 25.00),
  ('MESTRE DE OBRAS', 5436.20, 2000.52, 50.99),
  ('MONTADOR', 2979.14, 1096.32, 35.99),
  ('OPERADOR DE ESCAVADEIRA', 3060.30, 1126.19, 29.67),
  ('PEDREIRO', 2600.93, 957.14, 25.40),
  ('SUPERVISOR I', 5067.59, 1864.87, 75.41),
  ('SUPERVISOR II', 6264.86, 2305.47, 75.41),
  ('SUPERVISOR III', 7462.13, 2746.06, 75.41),
  ('TECNICO DE SEGURANCA DO TRABALHO', 3500.00, 1288.00, 38.78)
ON CONFLICT (categoria) DO UPDATE SET
  salario = EXCLUDED.salario,
  encargos = EXCLUDED.encargos,
  seguro_vida = EXCLUDED.seguro_vida,
  updated_at = now();
