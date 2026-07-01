import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { KeyRound, UserPlus, Ban, CheckCircle2, RefreshCw, Copy } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  listAdminUsers, adminCreateUser, adminSetUserRole, adminResetPassword,
  adminSetUserActive, ROLES, type AdminUser,
} from "@/lib/admin-users.functions";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  component: AdminUsuariosPage,
});

function gerarSenha(len = 12) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

const createSchema = z.object({
  email: z.string().email("Email inválido").max(255),
  full_name: z.string().trim().min(2, "Mínimo 2 caracteres").max(120),
  role: z.enum(["assistente", "supervisor", "coordenador", "gerente", "diretor"]),
  password: z.string().min(10, "Mínimo 10 caracteres").max(72),
});
type CreateForm = z.infer<typeof createSchema>;

const roleColor: Record<string, string> = {
  diretor: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  gerente: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  coordenador: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  supervisor: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  assistente: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

function AdminUsuariosPage() {
  const { isDirector, user } = useAuth();
  const qc = useQueryClient();

  const list = useServerFn(listAdminUsers);
  const create = useServerFn(adminCreateUser);
  const setRole = useServerFn(adminSetUserRole);
  const resetPwd = useServerFn(adminResetPassword);
  const setActive = useServerFn(adminSetUserActive);

  const [busca, setBusca] = useState("");
  const [filtroRole, setFiltroRole] = useState("todas");
  const [filtroStatus, setFiltroStatus] = useState("ativos");
  const [openCreate, setOpenCreate] = useState(false);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [roleTarget, setRoleTarget] = useState<AdminUser | null>(null);
  const [novaRole, setNovaRole] = useState<string>("assistente");
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetShown, setResetShown] = useState<{ email: string; password: string } | null>(null);
  const [toggleTarget, setToggleTarget] = useState<AdminUser | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => list(),
    enabled: !!isDirector,
  });

  const filtered = useMemo(() => {
    let r = users ?? [];
    if (busca.trim()) {
      const q = busca.toLowerCase();
      r = r.filter((u) => u.email.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q));
    }
    if (filtroRole !== "todas") r = r.filter((u) => u.role === filtroRole);
    if (filtroStatus === "ativos") r = r.filter((u) => !u.banned_until);
    if (filtroStatus === "inativos") r = r.filter((u) => !!u.banned_until);
    return r;
  }, [users, busca, filtroRole, filtroStatus]);

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { email: "", full_name: "", role: "assistente", password: gerarSenha() },
  });

  const createMut = useMutation({
    mutationFn: (d: CreateForm) => create({ data: d }),
    onSuccess: (_r, vars) => {
      toast.success("Usuário criado");
      setCreatedPassword(vars.password);
      setOpenCreate(false);
      form.reset({ email: "", full_name: "", role: "assistente", password: gerarSenha() });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const roleMut = useMutation({
    mutationFn: (v: { user_id: string; role: string }) =>
      setRole({ data: { user_id: v.user_id, role: v.role as any } }),
    onSuccess: () => {
      toast.success("Role atualizado");
      setRoleTarget(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: (v: { user_id: string; password: string }) =>
      resetPwd({ data: v }),
    onSuccess: (_r, v) => {
      toast.success("Senha redefinida");
      setResetShown({ email: resetTarget!.email, password: v.password });
      setResetTarget(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMut = useMutation({
    mutationFn: (v: { user_id: string; active: boolean }) =>
      setActive({ data: v }),
    onSuccess: () => {
      toast.success("Status atualizado");
      setToggleTarget(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isDirector) {
    return (
      <div className="space-y-4">
        <PageHeader title="Administração" description="Acesso restrito a diretores." />
      </div>
    );
  }


  return (
    <div className="space-y-4">
      <PageHeader
        title="Usuários"
        description="Gestão de usuários, roles e acesso ao sistema."
        actions={
          <Button onClick={() => { form.reset({ email: "", full_name: "", role: "assistente", password: gerarSenha() }); setOpenCreate(true); }}>
            <UserPlus className="mr-2 h-4 w-4" /> Novo usuário
          </Button>
        }
      />

      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-xs">Buscar</Label>
            <Input placeholder="Nome ou email" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={filtroRole} onValueChange={setFiltroRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ativos">Ativos</SelectItem>
                <SelectItem value="inativos">Inativos</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["admin-users"] })}>
              <RefreshCw className="mr-2 h-4 w-4" /> Recarregar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Criado</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum usuário</TableCell></TableRow>
                  ) : filtered.map((u) => {
                    const inactive = !!u.banned_until;
                    const isSelf = u.id === user?.id;
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.full_name || "—"} {isSelf && <span className="text-xs text-muted-foreground">(você)</span>}</TableCell>
                        <TableCell className="text-sm">{u.email}</TableCell>
                        <TableCell>
                          {u.role ? (
                            <Badge variant="outline" className={`capitalize ${roleColor[u.role]}`}>{u.role}</Badge>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {inactive
                            ? <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-300">Inativo</Badge>
                            : <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Ativo</Badge>}
                        </TableCell>
                        <TableCell className="text-xs">{new Date(u.created_at).toLocaleDateString("pt-BR")}</TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button size="sm" variant="outline" onClick={() => { setRoleTarget(u); setNovaRole(u.role ?? "assistente"); }}>
                            Role
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setResetTarget(u)}>
                            <KeyRound className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant={inactive ? "outline" : "outline"}
                            disabled={isSelf}
                            onClick={() => setToggleTarget(u)}
                            title={isSelf ? "Você não pode desativar a si mesmo" : ""}
                          >
                            {inactive ? <CheckCircle2 className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Criar usuário */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo usuário</DialogTitle>
            <DialogDescription>Crie a conta e repasse a senha temporária ao usuário.</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((d) => createMut.mutate(d))} className="space-y-3">
            <div>
              <Label>Nome completo</Label>
              <Input {...form.register("full_name")} />
              {form.formState.errors.full_name && <p className="text-xs text-destructive mt-1">{form.formState.errors.full_name.message}</p>}
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" {...form.register("email")} />
              {form.formState.errors.email && <p className="text-xs text-destructive mt-1">{form.formState.errors.email.message}</p>}
            </div>
            <div>
              <Label>Role</Label>
              <Select
                value={form.watch("role")}
                onValueChange={(v) => form.setValue("role", v as any, { shouldValidate: true })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Senha temporária</Label>
              <div className="flex gap-2">
                <Input {...form.register("password")} />
                <Button type="button" variant="outline" onClick={() => form.setValue("password", gerarSenha(), { shouldValidate: true })}>
                  Gerar
                </Button>
              </div>
              {form.formState.errors.password && <p className="text-xs text-destructive mt-1">{form.formState.errors.password.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpenCreate(false)}>Cancelar</Button>
              <Button type="submit" disabled={createMut.isPending}>Criar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Senha criada exibida */}
      <Dialog open={!!createdPassword} onOpenChange={(o) => !o && setCreatedPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usuário criado</DialogTitle>
            <DialogDescription>Copie a senha temporária — ela não será mostrada novamente.</DialogDescription>
          </DialogHeader>
          <div className="rounded border bg-muted p-3 font-mono text-sm break-all">{createdPassword}</div>
          <DialogFooter>
            <Button onClick={() => { navigator.clipboard.writeText(createdPassword ?? ""); toast.success("Copiado"); }}>
              <Copy className="mr-2 h-4 w-4" /> Copiar
            </Button>
            <Button variant="outline" onClick={() => setCreatedPassword(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar role */}
      <Dialog open={!!roleTarget} onOpenChange={(o) => !o && setRoleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar role</DialogTitle>
            <DialogDescription>
              {roleTarget?.full_name || roleTarget?.email} — role atual: <b className="capitalize">{roleTarget?.role ?? "—"}</b>
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Nova role</Label>
            <Select value={novaRole} onValueChange={setNovaRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRoleTarget(null)}>Cancelar</Button>
            <Button
              disabled={roleMut.isPending || !roleTarget || novaRole === roleTarget?.role}
              onClick={() => roleTarget && roleMut.mutate({ user_id: roleTarget.id, role: novaRole })}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset senha */}
      <AlertDialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redefinir senha?</AlertDialogTitle>
            <AlertDialogDescription>
              Será gerada uma nova senha temporária para <b>{resetTarget?.email}</b>. A senha atual deixará de funcionar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resetTarget && resetMut.mutate({ user_id: resetTarget.id, password: gerarSenha() })}
            >
              Redefinir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!resetShown} onOpenChange={(o) => !o && setResetShown(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova senha de {resetShown?.email}</DialogTitle>
            <DialogDescription>Copie e repasse ao usuário — não será mostrada novamente.</DialogDescription>
          </DialogHeader>
          <div className="rounded border bg-muted p-3 font-mono text-sm break-all">{resetShown?.password}</div>
          <DialogFooter>
            <Button onClick={() => { navigator.clipboard.writeText(resetShown?.password ?? ""); toast.success("Copiado"); }}>
              <Copy className="mr-2 h-4 w-4" /> Copiar
            </Button>
            <Button variant="outline" onClick={() => setResetShown(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ativar / desativar */}
      <AlertDialog open={!!toggleTarget} onOpenChange={(o) => !o && setToggleTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleTarget?.banned_until ? "Reativar usuário?" : "Desativar usuário?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTarget?.banned_until
                ? `Reativar o acesso de ${toggleTarget?.email}.`
                : `Bloquear o acesso de ${toggleTarget?.email}. Ele não conseguirá entrar até ser reativado.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toggleTarget && toggleMut.mutate({ user_id: toggleTarget.id, active: !!toggleTarget.banned_until })}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
