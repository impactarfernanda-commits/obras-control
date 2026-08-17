import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { TanksBRLogo } from "@/components/TanksBRLogo";
import {
  isHandoffCode,
  isPortalBootstrap,
  OBRAS_ERROR_MESSAGE,
  OBRAS_READY_MESSAGE,
  portalBootstrapMessage,
  PORTAL_ORIGIN,
  safeReturnPath,
} from "@/lib/sso";

export const Route = createFileRoute("/sso/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrando no Obras Control" },
      { name: "robots", content: "noindex,nofollow,noarchive" },
    ],
  }),
  component: SsoCallback,
});
function SsoCallback() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      const url = new URL(window.location.href),
        code = url.searchParams.get("code");
      const background = isPortalBootstrap(url, window.parent !== window);
      const notifyPortal = (
        type: typeof OBRAS_READY_MESSAGE | typeof OBRAS_ERROR_MESSAGE,
        returnPath?: string,
      ) => {
        if (background)
          window.parent.postMessage(
            portalBootstrapMessage(type, returnPath),
            new URL(PORTAL_ORIGIN).origin,
          );
      };
      if (!isHandoffCode(code)) {
        notifyPortal(OBRAS_ERROR_MESSAGE);
        if (active) setFailed(true);
        return;
      }
      try {
        const { data, error } = await supabase.functions.invoke("obras-sso-exchange", {
          body: { code },
        });
        url.searchParams.delete("code");
        url.searchParams.delete("portal_bootstrap");
        window.history.replaceState({}, document.title, url.pathname);
        if (error || typeof data?.token_hash !== "string") throw new Error("EXCHANGE_FAILED");
        const { data: old } = await supabase.auth.getSession();
        if (old.session) await supabase.auth.signOut({ scope: "local" });
        const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: data.token_hash,
          type: "magiclink",
        });
        if (verifyError || !verified.session) throw new Error("VERIFY_FAILED");
        const returnPath = safeReturnPath(data.return_path);
        const [userResult, rolesResult, profileResult] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from("user_roles").select("role").eq("user_id", verified.session.user.id),
          supabase
            .from("users_profiles")
            .select("full_name")
            .eq("id", verified.session.user.id)
            .maybeSingle(),
        ]);
        if (userResult.error || !userResult.data.user || rolesResult.error || profileResult.error)
          throw new Error("BOOTSTRAP_FAILED");
        if (background) {
          notifyPortal(OBRAS_READY_MESSAGE, returnPath);
          return;
        }
        window.location.replace(returnPath);
      } catch {
        notifyPortal(OBRAS_ERROR_MESSAGE);
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <TanksBRLogo size="login" />
        {failed ? (
          <>
            <h1 className="text-xl font-semibold">
              Não foi possível concluir o acesso ao Obras Control.
            </h1>
            <Button onClick={() => window.location.assign(PORTAL_ORIGIN)}>Voltar ao Portal</Button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin" />
            <h1 className="text-xl font-semibold">Entrando no Obras Control…</h1>
          </>
        )}
      </div>
    </div>
  );
}
