import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { TanksBRLogo } from "@/components/TanksBRLogo";
import { isHandoffCode, PORTAL_ORIGIN, safeReturnPath } from "@/lib/sso";

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
      if (!isHandoffCode(code)) {
        if (active) setFailed(true);
        return;
      }
      try {
        const { data, error } = await supabase.functions.invoke("obras-sso-exchange", {
          body: { code },
        });
        url.searchParams.delete("code");
        window.history.replaceState({}, document.title, url.pathname);
        if (error || typeof data?.token_hash !== "string") throw new Error("EXCHANGE_FAILED");
        const { data: old } = await supabase.auth.getSession();
        if (old.session) await supabase.auth.signOut({ scope: "local" });
        const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: data.token_hash,
          type: "magiclink",
        });
        if (verifyError || !verified.session) throw new Error("VERIFY_FAILED");
        window.location.replace(safeReturnPath(data.return_path));
      } catch {
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
