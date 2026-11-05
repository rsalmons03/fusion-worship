"use client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function PendingNotice({ email }: { email: string }) {
  const router = useRouter();
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="card max-w-md p-6 text-sm">
        <h1 className="h2 mb-2">Almost there</h1>
        <p className="text-muted">
          You&apos;re signed in as <b>{email}</b>, but an admin still needs to approve your account. Ask your worship
          leader to give you access, then refresh this page.
        </p>
        <button
          className="btn-secondary mt-4"
          onClick={async () => {
            await createClient().auth.signOut();
            router.push("/login");
          }}
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
