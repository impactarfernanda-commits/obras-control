# Funcionários inativos em alocações e custos

Objetivo: manter visíveis, editáveis e contabilizados os funcionários desligados, respeitando uma **data de desligamento** que limita lançamentos.

## 1. Banco

Migração em `funcionarios`:
- Adicionar coluna `data_desligamento DATE NULL`.
- Trigger `BEFORE UPDATE`: quando `ativo` passa de `true → false` e `data_desligamento` está nulo, preencher com `CURRENT_DATE`. Quando reativa (`false → true`), limpar `data_desligamento`.
- Expor `data_desligamento` em `funcionarios_safe` (recriar view).

Validação por trigger em `alocacoes` e `registros_horas` (`BEFORE INSERT OR UPDATE`):
- Se o funcionário estiver inativo e `data > data_desligamento`, levantar erro `Funcionário desligado em <data>; não é possível lançar dias posteriores`.
- Permitir qualquer data ≤ desligamento.

Sem mudanças em `categoria_salarios` nem em `calcularCusto` — o salário registrado no momento do desligamento permanece em `funcionarios.salario` (o sync por categoria só toca em `ativo=true`, então o snapshot do inativo é preservado).

## 2. Frontend

### `src/routes/_authenticated/alocacoes.tsx`
- Carregar `data_desligamento` junto com `funcionarios-min-all`.
- Construir `infoById` com `{nome, ativo, dataDesligamento}`.
- Calendário e popovers: exibir badge `Inativo` ao lado do nome quando `ativo=false`.
- Select de **Nova alocação**: incluir inativos (rotulados `— inativo`), e ao escolher um inativo limitar o `<input type="date">` com `max={dataDesligamento}`. Bloquear submit se data inválida com toast claro.
- Botão **Desfazer último** e remoção individual continuam funcionando para inativos (sem mudança).

### `src/components/AlocarPeriodoDialog.tsx`
- Listar ativos + inativos (com marcador). Ao selecionar inativo:
  - Forçar `dataFinal = min(dataFinal, dataDesligamento)`.
  - Avisar visualmente: "Funcionário desligado em dd/mm/aaaa — apenas dias até essa data serão lançados".
  - Recalcular preview de dias úteis.
- Validação cliente espelha a do trigger; em caso de erro do banco, mostrar mensagem amigável.

### `src/components/RegistrosGrid.tsx`
- Select "Adicionar funcionário" inclui inativos (marcados). Linhas de inativos já aparecem porque o componente monta a lista a partir de `alocacoes` da semana; adicionar badge `Inativo` na coluna de nome.
- Ao editar célula de um inativo cuja data > `data_desligamento`, desabilitar inputs e mostrar tooltip "Após desligamento".

### `src/routes/_authenticated/relatorios.tsx`
- **Custo por obra**: já considera inativos (sem mudança lógica). Apenas adicionar pequena indicação no agregado quando algum dos funcionários do mês está inativo (informativo).
- **Custo por funcionário**: nova seção/aba (ou toggle) "Incluir inativos com lançamentos no período". Quando ligado, lista funcionários inativos que tiveram `alocacoes` ou `registros_horas` no ciclo 25→24 selecionado, calculando custo proporcional via `custoDoDia` (mesma fórmula da obra) em vez do mensal cheio — o usuário marcou que esses custos serão pagos, então proporcional ao que efetivamente trabalharam no período é o correto.
- Total da folha passa a somar: ativos (custo mensal cheio) + inativos no período (custo proporcional).

### `src/routes/_authenticated/funcionarios.tsx`
- Mostrar `data_desligamento` nos detalhes/edição quando inativo (read-only, com botão "Editar data" para diretores caso precisem corrigir).

## 3. Fora de escopo

- Reativação automática.
- Recalcular custos retroativos de meses já fechados.
- Editar salário/encargos de inativos (mantém snapshot).

## Detalhes técnicos

- Trigger SQL exemplo:
  ```sql
  create or replace function public.guard_lancamento_inativo()
  returns trigger language plpgsql security definer set search_path=public as $$
  declare f record;
  begin
    select ativo, data_desligamento into f from funcionarios where id = NEW.funcionario_id;
    if not f.ativo and f.data_desligamento is not null and NEW.data > f.data_desligamento then
      raise exception 'Funcionário desligado em %; não é possível lançar dias posteriores', to_char(f.data_desligamento,'DD/MM/YYYY');
    end if;
    return NEW;
  end $$;
  ```
  Aplicado em `alocacoes` e `registros_horas`.
- `funcionarios_safe` precisa ser recriada (`create or replace view`) incluindo `data_desligamento` para o front ler sem precisar de RLS extra.
- `useCategorias`/`useSegurosVida` não muda.
- Invalidations: ao editar `data_desligamento`, invalidar `funcionarios-min-all`, `funcionarios`, `alocacoes-mes`, `aloc-week`.
