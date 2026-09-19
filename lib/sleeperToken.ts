// Lifecycle for the user's real Sleeper write-access token — a raw JWT the
// user captures themselves from their own browser's DevTools while logged
// into sleeper.com (see components/manager/ConnectWriteAccess.tsx for the
// capture instructions). This is a live session credential, stored only in
// this browser's localStorage under a key namespace deliberately distinct
// from lib/sleeper.ts's existing `fantis_` read-cache keys, so it's never
// swept by anything written against that public-data-cache convention.
// Never sent to or read by Fantis's own server.

const TOKEN_KEY = "fantis_sleeper_write_token_v1";

export interface DecodedSleeperToken {
  userId: string;
  displayName: string;
  issuedAt: number; // unix seconds
  expiresAt: number; // unix seconds
}

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (segment.length % 4)) % 4);
  return atob(padded);
}

// Decodes the JWT payload only — no signature verification, since that
// requires Sleeper's private signing key. Named "unverified" throughout so
// no future caller mistakes this for real validation; it's purely for
// showing the user which account/expiry the pasted token belongs to.
export function decodeJwtUnverified(token: string): DecodedSleeperToken | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    return {
      userId: String(payload.user_id ?? ""),
      displayName: typeof payload.display_name === "string" ? payload.display_name : "",
      issuedAt: typeof payload.iat === "number" ? payload.iat : 0,
      expiresAt: typeof payload.exp === "number" ? payload.exp : 0,
    };
  } catch {
    return null;
  }
}

export function isExpired(decoded: DecodedSleeperToken): boolean {
  return decoded.expiresAt * 1000 < Date.now();
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    // Storage unavailable (private browsing, quota) — nothing to fall back
    // to for a credential we deliberately never send to our own server.
  }
}

export function clearStoredToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // no-op
  }
}
