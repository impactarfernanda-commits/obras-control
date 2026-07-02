-- Corrige a classificacao MOD/MOI de cargos que sao sempre mao de obra indireta.
-- A fonte da tela Configuracoes e public.categorias.tipo.
-- Nao altera salarios, encargos, seguro de vida, funcionarios, alocacoes ou registros_horas.
-- Nao usa unaccent; a normalizacao remove acentos via translate com literal Unicode ASCII.

-- Verificacao antes de aplicar:
-- SELECT nome, tipo
-- FROM public.categorias
-- WHERE lower(trim(regexp_replace(translate(coalesce(nome, ''),
--      U&'\00C1\00C0\00C2\00C3\00C4\00E1\00E0\00E2\00E3\00E4\00C9\00C8\00CA\00CB\00E9\00E8\00EA\00EB\00CD\00CC\00CE\00CF\00ED\00EC\00EE\00EF\00D3\00D2\00D4\00D5\00D6\00F3\00F2\00F4\00F5\00F6\00DA\00D9\00DB\00DC\00FA\00F9\00FB\00FC\00C7\00E7',
--      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'), '\s+', ' ', 'g'))) IN (
--   'supervisor i',
--   'supervisor ii',
--   'supervisor iii',
--   'supervisor obra',
--   'assistente administrativo obras',
--   'assistente de engenharia',
--   'tecnico de seguranca do trabalho'
-- )
-- ORDER BY nome;

DO $$
DECLARE
  linhas_a_corrigir integer;
BEGIN
  SELECT count(*)
    INTO linhas_a_corrigir
  FROM public.categorias
  WHERE tipo IS DISTINCT FROM 'MOI'
    AND lower(trim(regexp_replace(translate(coalesce(nome, ''),
     U&'\00C1\00C0\00C2\00C3\00C4\00E1\00E0\00E2\00E3\00E4\00C9\00C8\00CA\00CB\00E9\00E8\00EA\00EB\00CD\00CC\00CE\00CF\00ED\00EC\00EE\00EF\00D3\00D2\00D4\00D5\00D6\00F3\00F2\00F4\00F5\00F6\00DA\00D9\00DB\00DC\00FA\00F9\00FB\00FC\00C7\00E7',
     'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'), '\s+', ' ', 'g'))) IN (
      'supervisor i',
      'supervisor ii',
      'supervisor iii',
      'supervisor obra',
      'assistente administrativo obras',
      'assistente de engenharia',
      'tecnico de seguranca do trabalho'
    );

  RAISE NOTICE 'Categorias a corrigir para MOI: %', linhas_a_corrigir;
END $$;

UPDATE public.categorias
   SET tipo = 'MOI'
 WHERE tipo IS DISTINCT FROM 'MOI'
   AND lower(trim(regexp_replace(translate(coalesce(nome, ''),
     U&'\00C1\00C0\00C2\00C3\00C4\00E1\00E0\00E2\00E3\00E4\00C9\00C8\00CA\00CB\00E9\00E8\00EA\00EB\00CD\00CC\00CE\00CF\00ED\00EC\00EE\00EF\00D3\00D2\00D4\00D5\00D6\00F3\00F2\00F4\00F5\00F6\00DA\00D9\00DB\00DC\00FA\00F9\00FB\00FC\00C7\00E7',
     'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'), '\s+', ' ', 'g'))) IN (
     'supervisor i',
     'supervisor ii',
     'supervisor iii',
     'supervisor obra',
     'assistente administrativo obras',
     'assistente de engenharia',
     'tecnico de seguranca do trabalho'
   );
