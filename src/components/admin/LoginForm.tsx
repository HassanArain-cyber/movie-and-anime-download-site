"use client";

import { useState } from "react";

export default function LoginForm({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); setErr(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await res.json();
      if (res.ok) onLogin(); else setErr(data.error || "Login failed");
    } catch { setErr("Network error"); }
    finally { setLoading(false); }
  };

  return (
    <div className="mx-auto max-w-sm py-8">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h1 className="text-base font-semibold text-white">Admin Login</h1>
        <p className="mt-1 text-xs text-neutral-500">Enter the admin password to manage the library.</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" required autoFocus className="min-h-9 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-white outline-none focus:border-neutral-700" />
          {err && <p role="alert" className="text-xs text-red-400">{err}</p>}
          <button type="submit" disabled={loading} className="min-h-9 w-full rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50">{loading ? "Signing in…" : "Sign in"}</button>
        </form>
        <p className="mt-4 text-xs text-neutral-600">The password is configured with the server-only <code className="rounded bg-neutral-800 px-1 py-0.5">ADMIN_PASSWORD</code> environment variable. There is no default password.</p>
      </div>
    </div>
  );
}
