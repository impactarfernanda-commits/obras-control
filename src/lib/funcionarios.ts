export type FuncionarioElegibilidade = {
  data_admissao: string | null;
  data_desligamento: string | null;
  deleted_at: string | null;
  visivel_obras_control: boolean | null;
};

export function funcionarioElegivelNoPeriodo(
  funcionario: FuncionarioElegibilidade,
  periodoInicio: string,
  periodoFim: string,
) {
  if (funcionario.deleted_at != null) return false;
  if (funcionario.visivel_obras_control === false) return false;
  if (funcionario.data_admissao && funcionario.data_admissao > periodoFim) return false;
  if (funcionario.data_desligamento && funcionario.data_desligamento < periodoInicio) return false;
  return true;
}
