import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Role = "assistente" | "supervisor" | "coordenador" | "gerente" | "diretor";

const ROLES: Role[] = ["assistente", "supervisor", "coordenador", "gerente", "diretor"];

type AuthRpcClient = {
  rpc: (
    fn: "has_role",
    args: { _user_id: string; _role: Role },
  ) => PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
};

async function assertDirector(ctx: { supabase: AuthRpcClient; userId: string }) {
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
      supabaseAdmin
        .from("users_profiles" as never)
        .select("id, full_name, email")
        .in("id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
    ]);
    const profiles = new Map(
      (
        (profilesRes.data ?? []) as unknown as Array<{
          id: string;
          full_name: string | null;
          email: string | null;
        }>
      ).map((p) => [p.id, { fullName: p.full_name ?? "", email: p.email ?? "" }]),
    );
    const rolesByUser = new Map<string, Role[]>();
    for (const r of (rolesRes.data ?? []) as Array<{ user_id: string; role: Role }>) {
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
        email: u.email ?? profiles.get(u.id)?.email ?? "",
        full_name: profiles.get(u.id)?.fullName ?? "",
        role: top,
        banned_until: (u as { banned_until?: string | null }).banned_until ?? null,
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
      .upsert({ id: userId, full_name: data.full_name, email: data.email } as never, {
        onConflict: "id",
      });

    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: data.role }, { onConflict: "user_id" });
    if (rErr) throw new Error(rErr.message);

    return { id: userId };
  });

const updateUserSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().trim().min(2).max(120),
  role: z.enum(["assistente", "supervisor", "coordenador", "gerente", "diretor"]),
});

export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateUserSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertDirector(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.role !== "diretor") {
      const { data: dirs } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", "diretor");
      const directorIds = new Set((dirs ?? []).map((r: { user_id: string }) => r.user_id));
      if (directorIds.has(data.user_id) && directorIds.size <= 1) {
        throw new Error("Não é possível remover o último diretor do sistema.");
      }
    }

    const { error: profileErr } = await supabaseAdmin
      .from("users_profiles")
      .upsert({ id: data.user_id, full_name: data.full_name }, { onConflict: "id" });
    if (profileErr) throw new Error(profileErr.message);

    const { error: metadataErr } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      user_metadata: { full_name: data.full_name },
    });
    if (metadataErr) throw new Error(metadataErr.message);

    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.user_id, role: data.role }, { onConflict: "user_id" });
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
      const directorIds = (dirs ?? []).map((r: { user_id: string }) => r.user_id) as string[];
      if (directorIds.includes(data.user_id)) {
        const { data: usersResp } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        const activeDirs = (usersResp?.users ?? []).filter(
          (u) =>
            directorIds.includes(u.id) && !(u as { banned_until?: string | null }).banned_until,
        );
        if (activeDirs.length <= 1) {
          throw new Error("Não é possível desativar o último diretor ativo.");
        }
      }
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: data.active ? "none" : "876000h",
    } as { ban_duration: string });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export { ROLES };
