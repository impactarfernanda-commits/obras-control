export const LEGACY_PORTAL_ORIGIN = "https://portal-tks-br.vercel.app";

export function canonicalOrigin(value: string | undefined, fallback = LEGACY_PORTAL_ORIGIN) {
  return new URL(value || fallback).origin;
}

export function configuredPortalOrigin(env?: Record<string, unknown>) {
  const value = env?.PORTAL_ORIGIN ?? env?.VITE_PORTAL_TANKS_URL;
  return canonicalOrigin(typeof value === "string" ? value : undefined);
}
