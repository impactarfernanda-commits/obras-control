import { canonicalOrigin } from "./origin-config.ts";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const PORTAL_ORIGIN = canonicalOrigin(env?.VITE_PORTAL_TANKS_URL);
export const OBRAS_PATHS = new Set([
  "/alocacoes",
  "/funcionarios",
  "/obras",
  "/dashboard",
  "/relatorios",
  "/custos",
  "/registros",
  "/configuracoes",
]);
export function safeReturnPath(path: string | null | undefined) {
  return path && path.startsWith("/") && !path.startsWith("//") && OBRAS_PATHS.has(path)
    ? path
    : "/alocacoes";
}
export const PORTAL_LAUNCH_WINDOW_NAME = "obras-control-bootstrap";

export function consumePortalLaunchMarker(target: Pick<Window, "name">) {
  const launched = target.name === PORTAL_LAUNCH_WINDOW_NAME;
  if (launched) target.name = "";
  return launched;
}

export function portalLoginUrl(path: string, authenticationFailed = false) {
  const url = new URL("/", PORTAL_ORIGIN);
  url.searchParams.set("return_path", safeReturnPath(path));
  if (authenticationFailed) url.searchParams.set("obras_auth_failed", "1");
  return url.toString();
}
export function isHandoffCode(code: string | null): code is string {
  return typeof code === "string" && /^[A-Za-z0-9_-]{43}$/u.test(code);
}
