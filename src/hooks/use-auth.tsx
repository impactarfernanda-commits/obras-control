import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { highestRole, type Role } from "@/lib/access-control";
import { portalLogoutUrl } from "@/lib/sso";
import { preserveAuthenticatedUser } from "@/lib/auth-session";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  role: Role | null;
  fullName: string;
  loading: boolean;
  authStatus: "initializing" | "authenticated" | "unauthenticated" | "error";
  profileStatus: "idle" | "loading" | "ready" | "error";
  retryProfile: () => void;
  isDirector: boolean;
  isManagerOrAbove: boolean;
  isLoggingOut: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<AuthContextValue["authStatus"]>("initializing");
  const [profileStatus, setProfileStatus] = useState<AuthContextValue["profileStatus"]>("idle");
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const userVersion = useRef(0);
  const signingOut = useRef(false);

  useEffect(() => {
    let active = true;
    const applySession = (s: Session | null) => {
      if (!active) return;
      setSession(s);
      setUser((current) => preserveAuthenticatedUser(current, s?.user ?? null));
      setAuthStatus(s ? "authenticated" : "unauthenticated");
      if (!s) {
        setRole(null);
        setFullName("");
        setProfileStatus("idle");
      }
    };
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => applySession(s));
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        applySession(data.session);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error(
          "Authentication initialization failed",
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: "Unknown authentication error" },
        );
        setAuthStatus("error");
        setLoading(false);
      });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [authAttempt]);

  useEffect(() => {
    if (!user) {
      setLoading(authStatus === "initializing");
      return;
    }
    let cancelled = false;
    const version = ++userVersion.current;
    setProfileStatus("loading");
    setLoading(true);
    (async () => {
      const [rolesRes, profileRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("users_profiles").select("full_name").eq("id", user.id).maybeSingle(),
      ]);
      if (rolesRes.error) throw rolesRes.error;
      if (profileRes.error) throw profileRes.error;
      if (cancelled || version !== userVersion.current) return;
      setRole(highestRole((rolesRes.data ?? []).map((r) => r.role)));
      setFullName(profileRes.data?.full_name ?? "");
      setProfileStatus("ready");
    })()
      .catch((error: unknown) => {
        if (cancelled || version !== userVersion.current) return;
        console.error(
          "User access profile failed",
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: "Unknown profile error" },
        );
        setRole(null);
        setFullName("");
        setProfileStatus("error");
      })
      .finally(() => {
        if (!cancelled && version === userVersion.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, profileAttempt, authStatus]);

  const retryProfile = useCallback(() => {
    setAuthStatus("initializing");
    setLoading(true);
    setAuthAttempt((attempt) => attempt + 1);
    setProfileAttempt((attempt) => attempt + 1);
  }, []);

  const value: AuthContextValue = {
    user,
    session,
    role,
    fullName,
    loading,
    authStatus,
    profileStatus,
    retryProfile,
    isDirector: role === "diretor",
    isManagerOrAbove: role === "diretor" || role === "gerente",
    isLoggingOut,
    signOut: async () => {
      if (signingOut.current) return;
      signingOut.current = true;
      setIsLoggingOut(true);
      try {
        await supabase.auth.signOut({ scope: "local" });
      } finally {
        userVersion.current += 1;
        setSession(null);
        setUser(null);
        setRole(null);
        setFullName("");
        setAuthStatus("unauthenticated");
        setProfileStatus("idle");
        setLoading(false);
        window.location.replace(portalLogoutUrl());
      }
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
