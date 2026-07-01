ALTER TABLE public.funcionarios DISABLE TRIGGER USER;

UPDATE public.funcionarios f
   SET salario = cs.salario,
       encargos = cs.encargos
  FROM public.categoria_salarios cs
 WHERE f.categoria_mo = cs.categoria
   AND f.ativo = true
   AND (f.salario IS DISTINCT FROM cs.salario OR f.encargos IS DISTINCT FROM cs.encargos);

ALTER TABLE public.funcionarios ENABLE TRIGGER USER;