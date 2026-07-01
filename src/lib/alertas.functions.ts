import { createServerFn } from "@tanstack/react-start";
import { runAlertChecks } from "./alertas.server";

export const triggerAlertChecks = createServerFn({ method: "POST" }).handler(async () => {
  return await runAlertChecks();
});
