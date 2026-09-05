import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppBackdrop } from "@/components/app-backdrop";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

function isNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|networkerror|network request failed|load failed/i.test(message);
}

async function signInWithNetworkRetry(email: string, password: string) {
  try {
    return await authClient.auth.signInWithPassword({ email, password });
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    return authClient.auth.signInWithPassword({ email, password });
  }
}

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Staff sign in | GBPIMS" },
      {
        name: "description",
        content: "Sign in to the Guwahati Biotech Park incubatee management dashboard.",
      },
      { property: "og:title", content: "Staff sign in | GBPIMS" },
      { property: "og:description", content: "Park staff access to occupancy and billing." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void authClient.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      if (mode === "signin") {
        const { error } = await signInWithNetworkRetry(email.trim(), password);
        if (error) throw error;
        navigate({ to: "/dashboard", replace: true });
      } else {
        const { data, error } = await authClient.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        if (data.session) {
          navigate({ to: "/dashboard", replace: true });
        } else {
          toast.success("Account created. Confirm via the email link, then sign in.");
          setMode("signin");
        }
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Sign in failed";
      const message = isNetworkError(error)
        ? "The connection was interrupted. Please check your internet and try again."
        : raw;
      setFormError(message);
      toast.error(message);
      console.error("[auth]", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-sidebar px-4 py-10">
      <AppBackdrop variant="feature" />
      <div className="relative w-full max-w-sm rounded-2xl bg-card/95 p-6 shadow-[var(--shadow-elevated-value)] backdrop-blur-sm">
        <BrandLogo className="mb-3" />
        <h1 className="mt-1 text-xl font-semibold">
          {mode === "signin" ? "Staff sign in" : "Create staff account"}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === "signin"
            ? "Use your office email address."
            : "The first account becomes admin; later accounts start as view-only."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive break-words"
            >
              {formError}
            </div>
          )}
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                maxLength={100}
                autoComplete="name"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button
          className="mt-4 w-full text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={async () => {
            if (!email) {
              toast.error("Enter your email address first.");
              return;
            }
            setBusy(true);
            const { error } = await authClient.auth.resetPasswordForEmail(email, {
              redirectTo: `${window.location.origin}/reset-password`,
            });
            setBusy(false);
            if (error) toast.error(error.message);
            else toast.success("Reset link sent. Check your inbox.");
          }}
        >
          Forgot password? Email me a reset link
        </button>

        <button
          className="mt-4 w-full text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin"
            ? "First time here? Create a staff account"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
