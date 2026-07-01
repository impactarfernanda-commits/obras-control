import { createFileRoute } from "@tanstack/react-router";
import { runAlertChecks } from "@/lib/alertas.server";

export const Route = createFileRoute("/api/public/hooks/check-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await runAlertChecks();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          console.error("check-alerts failed:", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
