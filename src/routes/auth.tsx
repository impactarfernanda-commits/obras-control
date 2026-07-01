import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TanksBRLogo } from "@/components/TanksBRLogo";
import { Loader2, MailCheck, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — TanksBR" },
      { name: "description", content: "Acesse o sistema de gestão TanksBR." },
    ],
  }),
  component: AuthPage,
});

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials") || m.includes("invalid_credentials"))
    return "E-mail ou senha incorretos.";
  if (m.includes("email not confirmed") || m.includes("email_not_confirmed"))
    return "E-mail ainda não confirmado. Verifique sua caixa de entrada.";
  if (m.includes("user already registered") || m.includes("already registered"))
    return "Este e-mail já está em uso. Tente outro ou faça login.";
  if (m.includes("password should be at least") || m.includes("password_too_short") || m.includes("weak_password"))
    return "A senha deve ter pelo menos 6 caracteres.";
  if (m.includes("unable to validate email") || m.includes("invalid email"))
    return "E-mail inválido.";
  if (m.includes("rate limit") || m.includes("over_request_rate_limit") || m.includes("too many requests"))
    return "Muitas tentativas. Aguarde alguns segundos e tente novamente.";
  if (m.includes("pwned") || m.includes("compromised"))
    return "Esta senha apareceu em vazamentos públicos. Escolha outra mais forte.";
  return message;
}

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [signupSent, setSignupSent] = useState<{ email: string } | null>(null);
  const [loginNeedsConfirm, setLoginNeedsConfirm] = useState<string | null>(null);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState<{ email: string } | null>(null);

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível enviar", { description: translateAuthError(error.message) });
      return;
    }
    setForgotSent({ email });
    toast.success("E-mail enviado", { description: "Verifique sua caixa de entrada." });
  }

  function exitForgot() {
    setForgotMode(false);
    setForgotSent(null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/funcionarios" });
    });
  }, [navigate]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setLoginNeedsConfirm(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      const friendly = translateAuthError(error.message);
      const lower = error.message.toLowerCase();
      if (lower.includes("email not confirmed") || lower.includes("email_not_confirmed")) {
        setLoginNeedsConfirm(email);
      }
      toast.error("Erro ao entrar", { description: friendly });
      return;
    }
    toast.success("Bem-vindo de volta!");
    navigate({ to: "/funcionarios" });
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName },
      },
    });
    setLoading(false);
    if (error) {
      toast.error("Erro ao cadastrar", { description: translateAuthError(error.message) });
      return;
    }
    // Supabase returns user with empty identities[] when the e-mail is already registered
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      toast.error("Erro ao cadastrar", {
        description: "Este e-mail já está em uso. Tente entrar ou recuperar a senha.",
      });
      return;
    }
    toast.success("Conta criada com sucesso", {
      description: "Verifique seu e-mail para confirmar o cadastro.",
    });
    setSignupSent({ email });
  }

  async function handleResend(targetEmail: string) {
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: targetEmail,
      options: { emailRedirectTo: window.location.origin },
    });
    setResending(false);
    if (error) {
      toast.error("Não foi possível reenviar", { description: translateAuthError(error.message) });
      return;
    }
    toast.success("E-mail de verificação reenviado", {
      description: `Enviamos um novo link para ${targetEmail}.`,
    });
  }

  function resetSignup() {
    setSignupSent(null);
    setPassword("");
    setTab("login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <TanksBRLogo size={56} showWordmark={false} />
          <h1 className="text-3xl font-bold">TanksBR</h1>
          <p className="text-sm text-muted-foreground">Sistema de gestão de obras e equipes</p>
        </div>
        <Card className="shadow-brand">
          <CardHeader>
            <CardTitle>
              {forgotMode ? "Recuperar senha" : "Acesso ao sistema"}
            </CardTitle>
            <CardDescription>
              {forgotMode
                ? forgotSent
                  ? "Verifique sua caixa de entrada."
                  : "Informe seu e-mail para receber o link de redefinição."
                : signupSent
                ? "Confirme seu e-mail para ativar a conta."
                : "Entre com seu e-mail ou crie uma conta."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {forgotMode ? (
              forgotSent ? (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 p-6 text-center">
                    <MailCheck className="h-10 w-10 text-primary" aria-hidden />
                    <div className="space-y-1">
                      <p className="font-semibold">E-mail enviado</p>
                      <p className="text-sm text-muted-foreground">
                        Enviamos um link de redefinição para{" "}
                        <strong className="text-foreground">{forgotSent.email}</strong>. Clique
                        no link para criar uma nova senha.
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Não recebeu? Verifique a pasta de spam. O link pode levar alguns minutos para
                    chegar.
                  </p>
                  <Button type="button" variant="ghost" className="w-full" onClick={exitForgot}>
                    Voltar ao login
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="fp-email">E-mail</Label>
                    <Input
                      id="fp-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full brand-gradient text-primary-foreground"
                    disabled={loading}
                  >
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Enviar link de redefinição
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={exitForgot}
                  >
                    Voltar ao login
                  </Button>
                </form>
              )
            ) : signupSent ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 p-6 text-center">
                  <MailCheck className="h-10 w-10 text-primary" aria-hidden />
                  <div className="space-y-1">
                    <p className="font-semibold">Verifique seu e-mail</p>
                    <p className="text-sm text-muted-foreground">
                      Enviamos um link de verificação para{" "}
                      <strong className="text-foreground">{signupSent.email}</strong>. Clique no
                      link para ativar sua conta e fazer login.
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Não recebeu? Verifique a pasta de spam ou reenvie o e-mail. O link pode levar
                  alguns minutos para chegar.
                </p>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => handleResend(signupSent.email)}
                    disabled={resending}
                  >
                    {resending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Reenviar e-mail de verificação
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={resetSignup}>
                    Voltar ao login
                  </Button>
                </div>
              </div>
            ) : (
              <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "signup")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login">Entrar</TabsTrigger>
                  <TabsTrigger value="signup">Cadastrar</TabsTrigger>
                </TabsList>
                <TabsContent value="login">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="li-email">E-mail</Label>
                      <Input
                        id="li-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="li-pass">Senha</Label>
                        <button
                          type="button"
                          onClick={() => setForgotMode(true)}
                          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                        >
                          Esqueci minha senha
                        </button>
                      </div>
                      <Input
                        id="li-pass"
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    {loginNeedsConfirm && (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="space-y-2">
                          <p>
                            Sua conta ainda não foi confirmada. Verifique seu e-mail ou reenvie o
                            link de confirmação.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleResend(loginNeedsConfirm)}
                            disabled={resending}
                          >
                            {resending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Reenviar e-mail de confirmação
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}
                    <Button
                      type="submit"
                      className="w-full brand-gradient text-primary-foreground"
                      disabled={loading}
                    >
                      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Entrar
                    </Button>
                  </form>
                </TabsContent>
                <TabsContent value="signup">
                  <form onSubmit={handleSignup} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="su-name">Nome completo</Label>
                      <Input
                        id="su-name"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="su-email">E-mail</Label>
                      <Input
                        id="su-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="su-pass">Senha</Label>
                      <Input
                        id="su-pass"
                        type="password"
                        minLength={6}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Você receberá um e-mail de verificação. Confirme para ativar sua conta.
                    </p>
                    <Button
                      type="submit"
                      className="w-full brand-gradient text-primary-foreground"
                      disabled={loading}
                    >
                      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Criar conta
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
