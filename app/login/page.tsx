"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CHURCH_NAME } from "@/lib/format";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNote("");
    const supabase = createClient();
    const creds = { email: email.trim(), password };
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword(creds);
      if (error) {
        setBusy(false);
        return setError(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
      }
    } else {
      if (password.length < 8) {
        setBusy(false);
        return setError("Use at least 8 characters for your password.");
      }
      const { data, error } = await supabase.auth.signUp({
        ...creds,
        options: { data: name.trim() ? { full_name: name.trim() } : undefined },
      });
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
      if (!data.session) {
        setBusy(false);
        return setNote("Account created. Ask your worship leader to approve it, then sign in.");
      }
    }
    window.location.href = "/";
  }

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m);
        setError("");
        setNote("");
      }}
      className={`flex-1 border-b-2 pb-2 font-display text-xs font-bold uppercase tracking-wider ${mode === m ? "border-accent text-ink" : "border-transparent text-muted"}`}
    >
      {label}
    </button>
  );

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={CHURCH_NAME} className="mx-auto h-14 w-auto" />
          <p className="mt-3 font-display text-xs font-bold uppercase tracking-[0.2em] text-accent">Worship Planning</p>
        </div>
        <div className="mb-5 flex gap-4">
          {tab("signin", "Sign in")}
          {tab("signup", "Create account")}
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="label" htmlFor="name">Your name</label>
              <input id="name" required className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
          {note && <p className="text-sm text-ok">{note}</p>}
          <button className="btn w-full" disabled={busy}>
            {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
          {mode === "signin" && <p className="text-center text-xs text-muted">Forgot your password? Ask your worship leader to reset it.</p>}
        </form>
      </div>
    </main>
  );
}
