import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TanksBRLogo } from "@/components/TanksBRLogo";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Redefinir senha — TanksBR" },
      { name: "description", content: "Defina uma nova senha para sua conta TanksBR." },
    ],
  }),
  component: ResetPasswordPage,
});

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("password should be at least") || m.includes("password_too_short") || m.includes("weak_password"))
    return "A senha deve ter pelo menos 6 caracteres.";
  if (m.includes("same password") || m.includes("same_password"))
    return "A nova senha deve ser diferente da anterior.";
  if (m.includes("pwned") || m.includes("compromised"))
    return "Esta senha apareceu em vazamentos públicos. Escolha outra mais forte.";
  if (m.includes("rate limit") || m.includes("too many requests"))
    return "Muitas tentativas. Aguarde alguns segundos e tente novamente.";
  return message;
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [validLink, setValidLink] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Listen for the recovery event triggered by Supabase parsing the URL hash.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setValidLink(true);
        setReady(true);
      }
    });

    // Fallback: if already has a session (Supabase already processed the hash),
    // assume the user arrived via a recovery link.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setValidLink(true);
      }
      // Give Supabase a moment to fire PASSWORD_RECOVERY from the URL hash.
      setTimeout(() => setReady(true), 600);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Senha muito curta", { description: "A senha deve ter pelo menos 6 caracteres." });
      return;
    }
    if (password !== confirm) {
      toast.error("Senhas não coincidem", { description: "Digite a mesma senha nos dois campos." });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível redefinir", { description: translateAuthError(error.message) });
      return;
    }
    setDone(true);
    toast.success("Senha redefinida com sucesso!");
    await supabase.auth.signOut();
    setTimeout(() => navigate({ to: "/auth" }), 2500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <TanksBRLogo className="w-[150px]" />
          <p className="text-sm text-muted-foreground">Redefinição de senha</p>
        </div>
        <Card className="shadow-brand">
          <CardHeader>
            <CardTitle>Definir nova senha</CardTitle>
            <CardDescription>
              {done
                ? "Senha atualizada. Redirecionando para o login..."
                : "Escolha uma nova senha para acessar sua conta."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!ready ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : done ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 p-6 text-center">
                <CheckCircle2 className="h-10 w-10 text-primary" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  Sua senha foi alterada. Você será redirecionado para a tela de login em
                  instantes.
                </p>
                <Link
                  to="/auth"
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Ir agora
                </Link>
              </div>
            ) : !validLink ? (
              <div className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Link inválido ou expirado. Solicite um novo e-mail de redefinição de senha.
                  </AlertDescription>
                </Alert>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/auth">Voltar ao login</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="rp-pass">Nova senha</Label>
                  <Input
                    id="rp-pass"
                    type="password"
                    minLength={6}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rp-confirm">Confirme a nova senha</Label>
                  <Input
                    id="rp-confirm"
                    type="password"
                    minLength={6}
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full brand-gradient text-primary-foreground"
                  disabled={loading}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Redefinir senha
                </Button>
                <Button asChild type="button" variant="ghost" className="w-full">
                  <Link to="/auth">Voltar ao login</Link>
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
