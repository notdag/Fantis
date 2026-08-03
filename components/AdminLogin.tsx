"use client";

import { useState } from "react";

export default function AdminLogin() {
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!pass || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: pass }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Wrong passphrase.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="hero">
      <h1 className="big">Owner access</h1>
      <p className="sub">
        This unlocks the tier board — re-tiering and re-ranking the starter
        rankings for everyone. Not for regular visitors.
      </p>
      <div className="card sync">
        <div className="field">
          <input
            className="input"
            type="password"
            placeholder="Passphrase"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoFocus
          />
          <button className="btn" onClick={submit} disabled={loading || !pass}>
            {loading ? "Checking…" : "Unlock"}
          </button>
        </div>
        {error && <div className="err">{error}</div>}
      </div>
    </section>
  );
}
