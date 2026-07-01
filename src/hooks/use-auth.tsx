import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "assistente" | "supervisor" | "coordenador" | "gerente" | "diretor";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  role: Role | null;
  fullName: string;
  loading: boolean;
  isDirector: boolean;
  isManagerOrAbove: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!s) {
        setRole(null);
        setFullName("");
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [rolesRes, profileRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("users_profiles").select("full_name").eq("id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const roles = (rolesRes.data ?? []).map((r) => r.role as Role);
      const priority: Role[] = ["diretor", "gerente", "coordenador", "supervisor", "assistente"];
      const top = priority.find((p) => roles.includes(p)) ?? null;
      setRole(top);
      setFullName(profileRes.data?.full_name ?? "");
    })();
    return () => { cancelled = true; };
  }, [user]);

  const value: AuthContextValue = {
    user,
    session,
    role,
    fullName,
    loading,
    isDirector: role === "diretor",
    isManagerOrAbove: role === "diretor" || role === "gerente",
    signOut: async () => { await supabase.auth.signOut(); },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
