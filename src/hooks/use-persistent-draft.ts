import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildDraftKey,
  readPersistentDraft,
  removePersistentDraft,
  writePersistentDraft,
} from "@/lib/persistent-draft";

type Options<T> = {
  userId?: string | null;
  flow: string;
  context?: string;
  validate: (value: unknown) => value is T;
  debounceMs?: number;
};

export function usePersistentDraft<T>({
  userId,
  flow,
  context,
  validate,
  debounceMs = 300,
}: Options<T>) {
  const key = useMemo(
    () => (userId ? buildDraftKey(userId, flow, context) : null),
    [context, flow, userId],
  );
  const [restored, setRestored] = useState<T | null>(null);
  const [ready, setReady] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ key: string; userId: string; payload: T } | null>(null);
  const suppressNextPersist = useRef(false);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = pending.current;
    pending.current = null;
    if (!value || typeof window === "undefined") return;
    try {
      writePersistentDraft(window.localStorage, value.key, value.userId, value.payload);
    } catch {
      // localStorage indisponível/quota cheia não deve interromper o formulário.
    }
  }, []);

  useEffect(() => {
    flush();
    setReady(false);
    setRecovered(false);
    setRestored(null);
    if (!key || !userId || typeof window === "undefined") return;
    const value = readPersistentDraft(window.localStorage, key, userId, validate);
    setRestored(value);
    setRecovered(value !== null);
    setReady(true);
  }, [flush, key, userId, validate]);

  const persist = useCallback(
    (payload: T) => {
      if (!ready || !key || !userId || typeof window === "undefined") return;
      if (suppressNextPersist.current) {
        suppressNextPersist.current = false;
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      pending.current = { key, userId, payload };
      timer.current = setTimeout(flush, debounceMs);
    },
    [debounceMs, flush, key, ready, userId],
  );

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    if (key && typeof window !== "undefined") removePersistentDraft(window.localStorage, key);
    suppressNextPersist.current = true;
    setRestored(null);
    setRecovered(false);
  }, [key]);

  useEffect(
    () => () => {
      flush();
    },
    [flush],
  );

  return { clear, persist, ready, recovered, restored };
}
