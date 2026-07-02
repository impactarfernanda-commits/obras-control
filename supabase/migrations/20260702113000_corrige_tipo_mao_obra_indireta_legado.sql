-- Corrige somente o tipo de mao de obra das alocacoes importadas no legado.
-- Periodo importado: 2026-05-25 a 2026-06-24.
-- Campo usado para identificar cargo/funcao: public.funcionarios.categoria_mo.
-- Nao altera obra_id, funcionario_id, data, registros_horas, salarios ou categorias.
-- O literal U& abaixo evita acentos no arquivo e ainda normaliza TECNICO/TECNICO com acento.

-- Verificacao antes de aplicar, caso queira conferir no Supabase:
-- SELECT
--   f.categoria_mo,
--   a.tipo_mao_obra AS tipo_atual,
--   count(*) AS quantidade
-- FROM public.alocacoes a
-- JOIN public.funcionarios f ON f.id = a.funcionario_id
-- WHERE a.data BETWEEN DATE '2026-05-25' AND DATE '2026-06-24'
--   AND lower(trim(regexp_replace(translate(coalesce(f.categoria_mo, ''),
--     U&'\00C1\00C0\00C2\00C3\00C4\00E1\00E0\00E2\00E3\00E4\00C9\00C8\00CA\00CB\00E9\00E8\00EA\00EB\00CD\00CC\00CE\00CF\00ED\00EC\00EE\00EF\00D3\00D2\00D4\00D5\00D6\00F3\00F2\00F4\00F5\00F6\00DA\00D9\00DB\00DC\00FA\00F9\00FB\00FC\00C7\00E7',
--     'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'), '\s+', ' ', 'g'))) IN (
--       'supervisor i',
--       'supervisor ii',
--       'supervisor iii',
--       'supervisor obra',
--       'assistente administrativo obras',
--       'assistente de engenharia',
--       'tecnico de seguranca do trabalho'
--   )
-- GROUP BY f.categoria_mo, a.tipo_mao_obra
-- ORDER BY f.categoria_mo, a.tipo_mao_obra;

DO $$
DECLARE
  linhas_a_corrigir integer;
BEGIN
  SELECT count(*)
    INTO linhas_a_corrigir
  FROM public.alocacoes a
  JOIN public.funcionarios f ON f.id = a.funcionario_id
  WHERE a.data BETWEEN DATE '2026-05-25' AND DATE '2026-06-24'
    AND a.tipo_mao_obra IS DISTINCT FROM 'indireta'
    AND lower(trim(regexp_replace(translate(coalesce(f.categoria_mo, ''),
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

  RAISE NOTICE 'Alocacoes legado com tipo_mao_obra a corrigir para indireta: %', linhas_a_corrigir;
END $$;

UPDATE public.alocacoes a
   SET tipo_mao_obra = 'indireta'
  FROM public.funcionarios f
 WHERE f.id = a.funcionario_id
   AND a.data BETWEEN DATE '2026-05-25' AND DATE '2026-06-24'
   AND a.tipo_mao_obra IS DISTINCT FROM 'indireta'
   AND lower(trim(regexp_replace(translate(coalesce(f.categoria_mo, ''),
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
