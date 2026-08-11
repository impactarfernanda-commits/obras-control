import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resetPasswordResult, type ResetPasswordVariables } from "./admin-user-reset.ts";

test("sucesso tardio usa o snapshot da mutation após o diálogo limpar o target", () => {
  let resetTarget: { id: string; email: string } | null = {
    id: "user-1",
    email: "karen.macedo@tanksbr.com.br",
  };
  const vars: ResetPasswordVariables = {
    user_id: resetTarget.id,
    email: resetTarget.email,
    password: "SenhaTemporaria42",
  };
  resetTarget = null;
  assert.equal(resetTarget, null);
  assert.deepEqual(resetPasswordResult(vars), {
    email: "karen.macedo@tanksbr.com.br",
    password: "SenhaTemporaria42",
  });
});

test("tela não lê resetTarget no onSuccess e envia ao servidor somente id e senha", () => {
  const source = fs.readFileSync("src/routes/_authenticated/admin.usuarios.tsx", "utf8");
  const success = source.slice(source.indexOf("const resetMut"), source.indexOf("const toggleMut"));
  assert.doesNotMatch(success, /resetTarget!\.email/);
  assert.match(success, /resetPasswordResult\(v\)/);
  assert.match(success, /resetPwd\(\{ data: \{ user_id: v\.user_id, password: v\.password \} \}\)/);
  assert.doesNotMatch(success, /resetPwd\(\{ data: v \}\)/);
});
