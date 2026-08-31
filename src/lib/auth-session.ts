import type { User } from "@supabase/supabase-js";

/** Mantém a identidade React estável durante refresh normal do token. */
export function preserveAuthenticatedUser(current: User | null, next: User | null): User | null {
  return current?.id && current.id === next?.id ? current : next;
}
