import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { TanksBRLogo } from "@/components/TanksBRLogo";
import {
  consumePortalLaunchMarker,
  isHandoffCode,
  PORTAL_LAUNCH_WINDOW_NAME,
  PORTAL_ORIGIN,
  portalLoginUrl,
  safeReturnPath,
} from "@/lib/sso";

export const Route = createFileRoute("/sso/callback")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Obras Control" }, { name: "robots", content: "noindex,nofollow,noarchive" }],
  }),
  component: SsoCallback,
});

function SsoCallback() {
  const [failed, setFailed] = useState(false);
  const launchedFromPortal = window.name === PORTAL_LAUNCH_WINDOW_NAME;
  useEffect(() => {
    let active = true;
    const fail = () => {
      if (!active) return;
      if (consumePortalLaunchMarker(window)) {
        window.location.replace(portalLoginUrl("/alocacoes", true));
        return;
      }
      setFailed(true);
    };
    void (async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      window.history.replaceState({}, document.title, url.pathname);
      if (!isHandoffCode(code)) {
        fail();
        return;
      }
      try {
        const { data, error } = await supabase.functions.invoke("obras-sso-exchange", {
          body: { code },
        });
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
        consumePortalLaunchMarker(window);
        window.location.replace(returnPath);
      } catch {
        fail();
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  return launchedFromPortal ? (
    <div
      className="flex min-h-screen items-center justify-center bg-background"
      aria-label="Abrindo Obras Control"
    >
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  ) : (
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
          <Loader2 className="mx-auto h-8 w-8 animate-spin" />
        )}
      </div>
    </div>
  );
}
