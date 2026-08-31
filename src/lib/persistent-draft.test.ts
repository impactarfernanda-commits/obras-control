import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAFT_TTL_MS,
  buildDraftKey,
  readPersistentDraft,
  removePersistentDraft,
  writePersistentDraft,
  type DraftStorage,
} from "./persistent-draft.ts";

function memoryStorage(): DraftStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}
const isPayload = (value: unknown): value is { field: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { field?: unknown }).field === "string";

test("persiste e restaura um rascunho após remount", () => {
  const storage = memoryStorage();
  const key = buildDraftKey("user-a", "nova-alocacao");
  writePersistentDraft(storage, key, "user-a", { field: "preenchido" }, 1000);
  assert.deepEqual(readPersistentDraft(storage, key, "user-a", isPayload, 2000), {
    field: "preenchido",
  });
});

test("isola rascunhos por usuário e contexto", () => {
  assert.notEqual(
    buildDraftKey("user-a", "alocar-periodo", "obra-1"),
    buildDraftKey("user-b", "alocar-periodo", "obra-1"),
  );
  assert.notEqual(
    buildDraftKey("user-a", "alocar-periodo", "obra-1"),
    buildDraftKey("user-a", "alocar-periodo", "obra-2"),
  );
});

test("remove rascunho concluído ou descartado", () => {
  const storage = memoryStorage();
  const key = buildDraftKey("user-a", "nova-alocacao");
  writePersistentDraft(storage, key, "user-a", { field: "x" });
  removePersistentDraft(storage, key);
  assert.equal(readPersistentDraft(storage, key, "user-a", isPayload), null);
});

test("descarta rascunho expirado, incompatível ou inválido", () => {
  const storage = memoryStorage();
  const expired = buildDraftKey("user-a", "expired");
  writePersistentDraft(storage, expired, "user-a", { field: "x" }, 1000);
  assert.equal(
    readPersistentDraft(storage, expired, "user-a", isPayload, 1001 + DRAFT_TTL_MS),
    null,
  );

  const incompatible = buildDraftKey("user-a", "bad-schema");
  storage.setItem(
    incompatible,
    JSON.stringify({ version: 999, savedAt: 1000, userId: "user-a", payload: { field: "x" } }),
  );
  assert.equal(readPersistentDraft(storage, incompatible, "user-a", isPayload, 1001), null);

  const invalid = buildDraftKey("user-a", "invalid-json");
  storage.setItem(invalid, "{");
  assert.equal(readPersistentDraft(storage, invalid, "user-a", isPayload), null);
});

test("falha ao remover conteúdo inválido não quebra a restauração", () => {
  const storage: DraftStorage = {
    getItem: () => "{",
    setItem: () => undefined,
    removeItem: () => {
      throw new Error("storage bloqueado");
    },
  };
  assert.doesNotThrow(() =>
    readPersistentDraft(storage, buildDraftKey("user-a", "bloqueado"), "user-a", isPayload),
  );
});
