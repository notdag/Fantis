"use client";

import { useEffect, useState } from "react";
import {
  clearStoredToken,
  decodeJwtUnverified,
  getStoredToken,
  isExpired,
  setStoredToken,
  type DecodedSleeperToken,
} from "@/lib/sleeperToken";

// Deliberately separate from ManagerDashboard.tsx's Sleeper-account
// "connect" flow (which is server-driven — POST to /api/manager/connect,
// stored in Postgres). This flow is the opposite on purpose: the token
// captured here is a live Sleeper login session, so it must never reach
// Fantis's own server. It's kept in this browser's localStorage only and
// used solely by lib/sleeperWrite.ts's direct browser-to-sleeper.com calls.
function formatExpiry(expiresAt: number): string {
  const ms = expiresAt * 1000 - Date.now();
  if (ms <= 0) return "expired";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `expires in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `expires in ${hours}h`;
  return `expires in ${Math.round(hours / 24)}d`;
}

export default function ConnectWriteAccess({
  onTokenReady,
}: {
  onTokenReady: (token: string | null) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [decoded, setDecoded] = useState<DecodedSleeperToken | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setMounted(true);
    const stored = getStoredToken();
    if (stored) {
      const d = decodeJwtUnverified(stored);
      setDecoded(d);
      onTokenReady(d && !isExpired(d) ? stored : null);
    }
    // onTokenReady is a stable callback from the parent; only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = () => {
    const token = tokenInput.trim();
    if (!token) return;
    const d = decodeJwtUnverified(token);
    if (!d) {
      setError("That doesn't look like a valid Sleeper token — expected a JWT (three dot-separated parts).");
      return;
    }
    if (isExpired(d)) {
      setError("That token is already expired — capture a fresh one from sleeper.com.");
      return;
    }
    setStoredToken(token);
    setDecoded(d);
    setTokenInput("");
    setError("");
    onTokenReady(token);
  };

  const disconnect = () => {
    clearStoredToken();
    setDecoded(null);
    onTokenReady(null);
  };

  if (!mounted) return null;

  if (decoded) {
    const expired = isExpired(decoded);
    return (
      <div className="card sync" style={{ marginBottom: 16 }}>
        <div className="field" style={{ alignItems: "center", gap: 10 }}>
          <span className="hint" style={{ margin: 0 }}>
            {expired ? (
              <span style={{ color: "var(--red)" }}>● write access expired</span>
            ) : (
              <span style={{ color: "var(--mint)" }}>● write access connected</span>
            )}
            {decoded.displayName && ` as ${decoded.displayName}`}
            {decoded.expiresAt > 0 && ` · ${formatExpiry(decoded.expiresAt)}`}
          </span>
          <button className="btn ghost sm" onClick={disconnect}>
            Disconnect
          </button>
        </div>
        {expired && (
          <p className="hint" style={{ marginTop: 8, color: "var(--red)" }}>
            This token has expired — disconnect and capture a fresh one from sleeper.com before
            applying any changes below.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="card sync" style={{ marginBottom: 16 }}>
      <p className="hint" style={{ margin: 0 }}>
        Setting lineups and IR moves here requires a real Sleeper login session, since Sleeper has
        no public write API — this is the same session sleeper.com itself uses. This is your live
        Sleeper login, not just a username: anyone with it can act as you on Sleeper. It&rsquo;s
        stored only in this browser (never sent to or seen by Fantis&rsquo;s own server) and used
        only to call sleeper.com directly. Disconnect below whenever you&rsquo;re done.
      </p>
      <ol className="hint" style={{ marginTop: 10, paddingLeft: 18 }}>
        <li>Open sleeper.com in this browser and log in as usual.</li>
        <li>Open DevTools → Network, then set any lineup change on sleeper.com so a request fires.</li>
        <li>Filter requests for &ldquo;graphql&rdquo;, click one, and find the <code>authorization</code> request header.</li>
        <li>Copy that header&rsquo;s value (starts with &ldquo;eyJ&rdquo;) and paste it below.</li>
      </ol>
      <div className="field" style={{ marginTop: 10 }}>
        <input
          className="input"
          placeholder="Paste your Sleeper authorization token"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && connect()}
          style={{ flex: 1, minWidth: 260 }}
        />
        <button className="btn" onClick={connect} disabled={!tokenInput.trim()}>
          Connect
        </button>
      </div>
      {error && <div className="err">{error}</div>}
    </div>
  );
}
