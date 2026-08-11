const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const PORTAL_ORIGIN = env?.VITE_PORTAL_TANKS_URL || "https://portal-tks-br.vercel.app";
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
export function portalLoginUrl(path: string) {
  const url = new URL("/", PORTAL_ORIGIN);
  url.searchParams.set("app", "obras-control");
  url.searchParams.set("return_path", safeReturnPath(path));
  return url.toString();
}
export function isHandoffCode(code: string | null): code is string {
  return typeof code === "string" && /^[A-Za-z0-9_-]{43}$/u.test(code);
}
