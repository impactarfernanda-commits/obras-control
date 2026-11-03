import { createFileRoute } from "@tanstack/react-router";
import { executarHookAlertasAutorizado } from "@/lib/alertas-hook-autorizacao";

export const Route = createFileRoute("/api/public/hooks/check-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const execucao = await executarHookAlertasAutorizado({
            authorization: request.headers.get("authorization"),
            segredoEsperado: process.env.ALERTS_HOOK_SECRET,
            executar: async () => {
              const { runAlertChecks } = await import("@/lib/alertas.server");
              return runAlertChecks();
            },
          });

          if (!execucao.autorizado) {
            return new Response("Unauthorized", { status: 401 });
          }

          return Response.json({ ok: true, ...execucao.resultado });
        } catch (e) {
          console.error("check-alerts failed:", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
