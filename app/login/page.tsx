"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CHURCH_NAME } from "@/lib/format";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: name.trim() ? { full_name: name.trim() } : undefined,
      },
    });
    if (error) {
      setError(error.message);
      setState("error");
    } else setState("sent");
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={CHURCH_NAME} className="mx-auto h-14 w-auto" />
          <p className="mt-3 font-display text-xs font-bold uppercase tracking-[0.2em] text-accent">Worship Planning</p>
        </div>
        {state === "sent" ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium">Check your email.</p>
            <p className="text-muted">We sent a sign-in link to {email}. Open it on this device to sign in.</p>
            <button className="btn-ghost" onClick={() => setState("idle")}>Use a different email</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div>
              <label className="label" htmlFor="name">Your name (first time only)</label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            {state === "error" && <p className="text-sm text-bad">{error}</p>}
            <button className="btn w-full" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
