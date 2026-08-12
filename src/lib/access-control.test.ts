import assert from "node:assert/strict";
import test from "node:test";

import {
  canDeactivateEmployee,
  canEditEmployeeTerminationDate,
  hasAnyRole,
  highestRole,
  isExpectedAccessError,
  isTransientReadError,
  shouldRetryRead,
} from "./access-control.ts";

test("todos os perfis internos podem desligar somente funcionario ativo", () => {
  for (const role of ["assistente", "supervisor", "coordenador", "gerente", "diretor"] as const) {
    assert.equal(canDeactivateEmployee(role, true), true, role);
    assert.equal(canDeactivateEmployee(role, false), false, role);
  }
  assert.equal(canDeactivateEmployee(null, true), false);
});

test("somente gerente e diretor editam data de funcionario ja desligado", () => {
  for (const role of ["assistente", "supervisor", "coordenador"] as const) {
    assert.equal(canEditEmployeeTerminationDate(role, false), false, role);
  }
  assert.equal(canEditEmployeeTerminationDate("gerente", false), true);
  assert.equal(canEditEmployeeTerminationDate("diretor", false), true);
  assert.equal(canEditEmployeeTerminationDate("gerente", true), false);
});

test("matriz de perfis preserva a maior role suportada", () => {
  assert.equal(highestRole(["assistente"]), "assistente");
  assert.equal(highestRole(["supervisor"]), "supervisor");
  assert.equal(highestRole(["coordenador"]), "coordenador");
  assert.equal(highestRole(["gerente"]), "gerente");
  assert.equal(highestRole(["diretor"]), "diretor");
  assert.equal(highestRole(["assistente", "gerente"]), "gerente");
  assert.equal(highestRole([]), null);
});

test("perfil equivalente ao da Sue acessa apenas rotas permitidas sem exceção", () => {
  const allowedSettings = ["supervisor", "coordenador", "gerente", "diretor"] as const;
  assert.equal(hasAnyRole("supervisor", allowedSettings), true);
  assert.equal(hasAnyRole("assistente", allowedSettings), false);
  assert.equal(hasAnyRole(null, allowedSettings), false);
});

test("dashboard e relatórios permanecem restritos a gerente e diretor", () => {
  const financial = ["gerente", "diretor"] as const;
  assert.equal(hasAnyRole("gerente", financial), true);
  assert.equal(hasAnyRole("diretor", financial), true);
  assert.equal(hasAnyRole("coordenador", financial), false);
});

test("401, 403 e RLS são acesso esperado e nunca recebem retry", () => {
  for (const error of [{ status: 401 }, { status: 403 }, { code: "42501" }]) {
    assert.equal(isExpectedAccessError(error), true);
    assert.equal(isTransientReadError(error), false);
    assert.equal(shouldRetryRead(0, error), false);
  }
});

test("falha transitória de leitura recebe no máximo um retry", () => {
  const networkError = Object.assign(new TypeError("fetch failed"), { status: 0 });
  assert.equal(shouldRetryRead(0, networkError), true);
  assert.equal(shouldRetryRead(1, networkError), false);
  assert.equal(shouldRetryRead(20, networkError), false);
});

test("erro permanente de validação não entra em loop de retry", () => {
  assert.equal(shouldRetryRead(0, { status: 400, code: "22P02" }), false);
});
