import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/nova-senha")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Definir nova senha — Aprovado Fiscal" },
      { name: "description", content: "Defina uma nova senha para sua conta do Aprovado Fiscal." },
      { property: "og:title", content: "Definir nova senha — Aprovado Fiscal" },
      { property: "og:description", content: "Redefinição de senha da plataforma Aprovado Fiscal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewPasswordPage,
});

function NewPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Senha atualizada.");
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={handleSubmit} className="panel w-full max-w-md px-6 py-7">
        <h1 className="text-lg font-semibold">Definir nova senha</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Abra esta página pelo link enviado ao seu e-mail para concluir a redefinição.
        </p>
        <div className="mt-6 space-y-2">
          <Label htmlFor="password">Nova senha</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            required
          />
        </div>
        <Button type="submit" className="mt-5 w-full" disabled={busy}>
          Salvar senha
        </Button>
      </form>
    </div>
  );
}
