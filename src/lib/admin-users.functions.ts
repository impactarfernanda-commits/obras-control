import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Role = "assistente" | "supervisor" | "coordenador" | "gerente" | "diretor";

const ROLES: Role[] = ["assistente", "supervisor", "coordenador", "gerente", "diretor"];

async function assertDirector(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "diretor",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: apenas diretores");
}

export type AdminUser = {
  id: string;
  email: string;
  full_name: string;
  role: Role | null;
  banned_until: string | null;
  created_at: string;
};

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUser[]> => {
    await assertDirector(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (authErr) throw new Error(authErr.message);

    const ids = authData.users.map((u) => u.id);
    const [profilesRes, rolesRes] = await Promise.all([
      supabaseAdmin.from("users_profiles").select("id, full_name").in("id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
    ]);
    const profiles = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p.full_name]));
    const rolesByUser = new Map<string, Role[]>();
    for (const r of (rolesRes.data ?? []) as any[]) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as Role);
      rolesByUser.set(r.user_id, arr);
    }
    const priority: Role[] = ["diretor", "gerente", "coordenador", "supervisor", "assistente"];

    return authData.users.map((u) => {
      const userRoles = rolesByUser.get(u.id) ?? [];
      const top = priority.find((p) => userRoles.includes(p)) ?? null;
      return {
        id: u.id,
        email: u.email ?? "",
        full_name: (profiles.get(u.id) as string) ?? "",
        role: top,
        banned_until: (u as any).banned_until ?? null,
        created_at: u.created_at,
      };
    });
  });

const createSchema = z.object({
  email: z.string().email().max(255),
  full_name: z.string().trim().min(2).max(120),
  role: z.enum(["assistente", "supervisor", "coordenador", "gerente", "diretor"]),
  password: z.string().min(10).max(72),
});

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertDirector(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error) throw new Error(error.message);
    const userId = created.user!.id;

    // handle_new_user trigger cria profile + role 'assistente'. Ajustar.
    await supabaseAdmin
      .from("users_profiles")
      .upsert({ id: userId, full_name: data.full_name }, { onConflict: "id" });

    if (data.role !== "assistente") {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
      const { error: rErr } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: data.role });
      if (rErr) throw new Error(rErr.message);
    }

    return { id: userId };
  });

const setRoleSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["assistente", "supervisor", "coordenador", "gerente", "diretor"]),
});

export const adminSetUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => setRoleSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertDirector(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Anti-lockout: se o alvo é o último diretor e role nova não é diretor, bloquear.
    if (data.role !== "diretor") {
      const { data: dirs } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", "diretor");
      const directorIds = new Set((dirs ?? []).map((r: any) => r.user_id));
      if (directorIds.has(data.user_id) && directorIds.size <= 1) {
        throw new Error("Não é possível remover o último diretor do sistema.");
      }
    }

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.user_id, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const resetSchema = z.object({
  user_id: z.string().uuid(),
  password: z.string().min(10).max(72),
});

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => resetSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertDirector(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const activeSchema = z.object({
  user_id: z.string().uuid(),
  active: z.boolean(),
});

export const adminSetUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => activeSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertDirector(context);

    if (!data.active && data.user_id === context.userId) {
      throw new Error("Você não pode desativar a si mesmo.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!data.active) {
      // Anti-lockout: não desativar último diretor ativo
      const { data: dirs } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", "diretor");
      const directorIds = (dirs ?? []).map((r: any) => r.user_id) as string[];
      if (directorIds.includes(data.user_id)) {
        const { data: usersResp } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const activeDirs = (usersResp?.users ?? []).filter(
          (u) => directorIds.includes(u.id) && !(u as any).banned_until,
        );
        if (activeDirs.length <= 1) {
          throw new Error("Não é possível desativar o último diretor ativo.");
        }
      }
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: data.active ? "none" : "876000h",
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export { ROLES };
