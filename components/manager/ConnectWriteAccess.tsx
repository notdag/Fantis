"use client";

import { useEffect, useRef, useState } from "react";
import { buildBookmarklet } from "@/lib/sleeperBookmarklet";
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

  const bookmarkletRef = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMounted(true);

    // One-click path: the "Send Sleeper token to Fantis" bookmarklet (see
    // lib/sleeperBookmarklet.ts) opens this page as `#token=<jwt>`. URL
    // fragments are never sent to a server, so the token stays in this
    // browser. Accept it, store it, and strip it from the address bar.
    const m = window.location.hash.match(/^#token=(.+)$/);
    if (m) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      let fromHash = m[1];
      try {
        fromHash = decodeURIComponent(fromHash);
      } catch {
        // keep raw value
      }
      const d = decodeJwtUnverified(fromHash);
      if (d && !isExpired(d)) {
        setStoredToken(fromHash);
        setDecoded(d);
        onTokenReady(fromHash);
        return;
      }
      setError("The token sent from Sleeper was invalid or already expired — try the bookmark again.");
    }

    const stored = getStoredToken();
    if (stored) {
      const d = decodeJwtUnverified(stored);
      setDecoded(d);
      onTokenReady(d && !isExpired(d) ? stored : null);
    }
    // onTokenReady is a stable callback from the parent; only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React refuses to render a `javascript:` href from JSX, so the bookmarklet
  // link's href is set directly on the DOM node once it exists.
  useEffect(() => {
    bookmarkletRef.current?.setAttribute("href", buildBookmarklet(window.location.origin));
  }, [mounted, decoded]);

  const copyBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(buildBookmarklet(window.location.origin));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy automatically — drag the button to your bookmarks bar instead.");
    }
  };

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
      <p className="hint" style={{ margin: "12px 0 6px", color: "var(--bone)", fontWeight: 600 }}>
        Easiest: one-click bookmark
      </p>
      <ol className="hint" style={{ margin: 0, paddingLeft: 18 }}>
        <li>
          Drag this button to your bookmarks bar:{" "}
          <a
            ref={bookmarkletRef}
            className="btn ghost sm"
            style={{ display: "inline-block", cursor: "grab" }}
            onClick={(e) => e.preventDefault()}
          >
            Send Sleeper token to Fantis
          </a>{" "}
          <button className="linklike" style={{ fontSize: 13 }} onClick={copyBookmarklet}>
            {copied ? "Copied!" : "or copy it"}
          </button>
        </li>
        <li>Open sleeper.com and log in as usual.</li>
        <li>Click the bookmark. This page reopens already connected.</li>
      </ol>
      <p className="hint" style={{ margin: "12px 0 6px", color: "var(--bone)", fontWeight: 600 }}>
        Or paste it manually
      </p>
      <ol className="hint" style={{ margin: 0, paddingLeft: 18 }}>
        <li>On sleeper.com, open DevTools → Network and make any lineup change so a request fires.</li>
        <li>Filter for &ldquo;graphql&rdquo;, click one, and copy the <code>authorization</code> request header value (starts with &ldquo;eyJ&rdquo;).</li>
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
