import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { executarAlertasManualAutorizado } from "./alertas-autorizacao";

export const triggerAlertChecks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    executarAlertasManualAutorizado({
      buscarRoles: () =>
        context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
      executar: async () => {
        const { runAlertChecks } = await import("./alertas.server");
        return runAlertChecks();
      },
    }),
  );
