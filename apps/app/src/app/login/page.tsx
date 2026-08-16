import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { appPath } from "@/lib/paths";

export const metadata: Metadata = {
  title: "Meridian — Entrar",
  description: "Acesso ao painel.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // already signed in → straight to the app
  if (await currentUser()) redirect("/");

  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Out of the app and back to the marketing site, which is a different
            server on the same host — so this one is deliberately NOT appPath(). */}
        <a href="/" className="inline-flex items-center gap-2.5" aria-label="Meridian home">
          <svg width="26" height="26" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="9.25" stroke="currentColor" strokeWidth="1.5" className="text-foreground/70" />
            <path d="M2 11h18" stroke="#3ecf8e" strokeWidth="1.5" />
            <path d="M11 1.75v18.5" stroke="currentColor" strokeWidth="1.5" className="text-foreground/25" />
          </svg>
          <span className="text-lg font-semibold tracking-[-0.02em]">Meridian</span>
        </a>

        <p className="eyebrow mt-10">Painel</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">Entrar</h1>

        {error && (
          <p className="border-destructive/40 bg-destructive/10 text-destructive mt-6 rounded-md border px-3 py-2 text-sm">
            {error === "locked"
              ? "Muitas tentativas. Aguarde alguns minutos e tente de novo."
              : "Usuário ou senha inválidos."}
          </p>
        )}

        <form method="POST" action={appPath("/api/login")} className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">Usuário</span>
            <input
              name="username"
              autoComplete="username"
              required
              autoFocus
              className="border-input bg-surface-1 focus-visible:ring-ring/50 h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">Senha</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="border-input bg-surface-1 focus-visible:ring-ring/50 h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            />
          </label>
          <button
            type="submit"
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors"
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  );
}
