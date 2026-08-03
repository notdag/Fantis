// Owner-only gate for /admin. There's no real accounts system yet (see
// CLAUDE.md "Target architecture" — NextAuth is still on the build order),
// so this is a deliberately lightweight stopgap: a single shared passphrase,
// checked server-side against ADMIN_PASSPHRASE, backing an httpOnly cookie
// whose value is a hash rather than the passphrase itself so it can't be
// forged by just setting a cookie in devtools. Replace with real auth before
// this app has more than one owner.
import crypto from "crypto";

export const ADMIN_COOKIE = "fantis_admin";

function expectedToken(): string | null {
  const pass = process.env.ADMIN_PASSPHRASE;
  if (!pass) return null;
  return crypto.createHash("sha256").update(`fantis-admin:${pass}`).digest("hex");
}

// Returns the cookie token to set if the passphrase is correct, else null.
export function checkPassphrase(input: string): string | null {
  const expected = expectedToken();
  if (!expected) return null;
  const candidate = crypto.createHash("sha256").update(`fantis-admin:${input}`).digest("hex");
  return timingSafeEqualHex(expected, candidate) ? expected : null;
}

export function isValidToken(token: string | undefined | null): boolean {
  const expected = expectedToken();
  if (!expected || !token) return false;
  return timingSafeEqualHex(expected, token);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
