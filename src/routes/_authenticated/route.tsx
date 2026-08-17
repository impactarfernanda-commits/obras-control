import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { TanksBRLogo } from "@/components/TanksBRLogo";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { consumePortalLaunchMarker, portalLoginUrl } from "@/lib/sso";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { loading, authStatus, profileStatus, retryProfile, signOut } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (authStatus === "unauthenticated") {
    window.location.replace(portalLoginUrl(pathname, consumePortalLaunchMarker(window)));
    return null;
  }
  if (authStatus === "authenticated") consumePortalLaunchMarker(window);
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b bg-card px-4">
            <SidebarTrigger />
            <div className="flex-1" />
            <TanksBRLogo size="header" />
          </header>
          <main className="flex-1 p-4 md:p-6">
            {loading || authStatus === "initializing" ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : authStatus === "error" || profileStatus === "error" ? (
              <div className="mx-auto max-w-lg rounded-lg border bg-card p-6 text-center">
                <h1 className="text-lg font-semibold">Não foi possível carregar seu acesso</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Verifique sua conexão e tente novamente. Nenhuma permissão foi alterada.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button onClick={retryProfile}>Tentar novamente</Button>
                  <Button variant="outline" onClick={signOut}>
                    Sair
                  </Button>
                </div>
              </div>
            ) : (
              <RouteErrorBoundary resetKey={pathname}>
                <Outlet />
              </RouteErrorBoundary>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
