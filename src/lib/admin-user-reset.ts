export type ResetPasswordVariables = {
  user_id: string;
  email: string;
  password: string;
};

export function resetPasswordResult(vars: ResetPasswordVariables) {
  return { email: vars.email, password: vars.password };
}
