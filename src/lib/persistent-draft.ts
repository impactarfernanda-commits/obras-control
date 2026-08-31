export const DRAFT_SCHEMA_VERSION = 1;
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type DraftEnvelope<T> = {
  version: number;
  savedAt: number;
  userId: string;
  payload: T;
};

export function buildDraftKey(userId: string, flow: string, context?: string) {
  const suffix = context ? `:${encodeURIComponent(context)}` : "";
  return `obras-control:draft:${userId}:${flow}${suffix}:v${DRAFT_SCHEMA_VERSION}`;
}

export function writePersistentDraft<T>(
  storage: DraftStorage,
  key: string,
  userId: string,
  payload: T,
  now = Date.now(),
) {
  const envelope: DraftEnvelope<T> = {
    version: DRAFT_SCHEMA_VERSION,
    savedAt: now,
    userId,
    payload,
  };
  storage.setItem(key, JSON.stringify(envelope));
}

export function readPersistentDraft<T>(
  storage: DraftStorage,
  key: string,
  userId: string,
  validate: (value: unknown) => value is T,
  now = Date.now(),
): T | null {
  const discard = () => {
    try {
      storage.removeItem(key);
    } catch {
      // Storage bloqueado também deve resultar apenas em ausência de rascunho.
    }
    return null;
  };
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<DraftEnvelope<unknown>>;
    if (
      value.version !== DRAFT_SCHEMA_VERSION ||
      value.userId !== userId ||
      typeof value.savedAt !== "number" ||
      now - value.savedAt > DRAFT_TTL_MS ||
      now < value.savedAt ||
      !validate(value.payload)
    )
      return discard();
    return value.payload;
  } catch {
    return discard();
  }
}

export function removePersistentDraft(storage: DraftStorage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // Limpar rascunho nunca deve quebrar o fluxo principal.
  }
}
