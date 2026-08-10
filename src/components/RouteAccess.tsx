import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useAuth } from "@/hooks/use-auth";
import { hasAnyRole, type Role } from "@/lib/access-control";

export function RequireRole({
  allowed,
  children,
}: {
  allowed: readonly Role[];
  children: ReactNode;
}) {
  const { role } = useAuth();
  return hasAnyRole(role, allowed) ? children : <Navigate to="/funcionarios" replace />;
}
