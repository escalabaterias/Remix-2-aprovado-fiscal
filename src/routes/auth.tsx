import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Aprovado Fiscal" },
      {
        name: "description",
        content: "Acesse sua conta do Aprovado Fiscal para gerenciar concursos, editais e estudos.",
      },
      { property: "og:title", content: "Entrar — Aprovado Fiscal" },
      {
        property: "og:description",
        content: "Cadastro e login da plataforma de preparação para concursos fiscais.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "signup" | "recover">("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: `${window.location.origin}/dashboard`,
          },
        });
        if (error) throw error;
        toast.success("Conta criada. Verifique seu e-mail se a confirmação for solicitada.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/nova-senha`,
        });
        if (error) throw error;
        toast.success("Enviamos o link de recuperação para o seu e-mail.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir a operação.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth`,
          queryParams: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
          },
        },
      });
      if (error) throw error;
    } catch (error) {
      setBusy(false);
      toast.error(error instanceof Error ? error.message : "Não foi possível entrar com o Google.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-baseline justify-center gap-2">
          <span className="font-display text-base font-semibold tracking-tight">APROVADO</span>
          <span className="font-display text-base font-semibold tracking-tight text-primary">
            FISCAL
          </span>
        </Link>

        <div className="panel mt-6 px-5 py-6 sm:px-7">
          <Tabs
            value={mode === "recover" ? "login" : mode}
            onValueChange={(v) => setMode(v as "login" | "signup")}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-5">
              <h1 className="text-lg font-semibold">
                {mode === "recover" ? "Recuperar senha" : "Acessar sua conta"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {mode === "recover"
                  ? "Informe seu e-mail para receber o link de redefinição."
                  : "Use seu e-mail e senha ou entre com o Google."}
              </p>
            </TabsContent>

            <TabsContent value="signup" className="mt-5">
              <h1 className="text-lg font-semibold">Criar sua conta</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Seu perfil e seus dados de estudo ficam isolados na sua conta.
              </p>
            </TabsContent>
          </Tabs>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "signup" ? (
              <div className="space-y-2">
                <Label htmlFor="fullName">Nome</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            {mode !== "recover" ? (
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={8}
                  required
                />
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={busy}>
              {mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Enviar link"}
            </Button>
          </form>

          {mode !== "recover" ? (
            <>
              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="label-eyebrow">ou</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={busy}>
                Continuar com o Google
              </Button>
            </>
          ) : null}

          <div className="mt-5 text-center text-sm">
            {mode === "recover" ? (
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setMode("login")}
              >
                Voltar para o login
              </button>
            ) : (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => setMode("recover")}
              >
                Esqueci minha senha
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
