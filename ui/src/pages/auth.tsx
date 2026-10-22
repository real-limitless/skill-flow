import * as React from "react";
import { toast } from "sonner";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authStatus, go, postCredentials } from "@/lib/api";

type Mode = "setup" | "login";

const copy: Record<Mode, { eyebrow: string; title: string; description: string; submit: string; passwordLabel: string }> = {
  setup: {
    eyebrow: "First operator",
    title: "Create the first skill-flow operator",
    description: "Accounts are local to this skill-flow instance. Not SSO.",
    submit: "Create account",
    passwordLabel: "Password (8+)",
  },
  login: {
    eyebrow: "Operator login",
    title: "Sign in",
    description: "Accounts are local to this skill-flow instance. Not SSO. Installs stay local.",
    submit: "Sign in",
    passwordLabel: "Password",
  },
};

export function AuthPage({ mode }: { mode: Mode }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const c = copy[mode];

  React.useEffect(() => {
    void authStatus().then((st) => {
      if (mode === "setup" && !st.setupRequired) go("login");
      if (mode === "login") {
        if (st.setupRequired) go("setup");
        else if (st.authenticated) go("console");
      }
    });
  }, [mode]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await postCredentials(mode === "setup" ? "/v1/auth/setup" : "/v1/auth/login", email, password);
      go("console");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-muted flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex justify-center">
          <Brand />
        </div>
        <Card>
          <CardHeader>
            <p className="text-primary font-mono text-xs tracking-widest uppercase">{c.eyebrow}</p>
            <CardTitle className="text-xl">{c.title}</CardTitle>
            <CardDescription>{c.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="grid gap-4" noValidate={false}>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">{c.passwordLabel}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "setup" ? "new-password" : "current-password"}
                  minLength={mode === "setup" ? 8 : undefined}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={error ? true : undefined}
                />
              </div>
              {error ? (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {c.submit}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
