// Auth for the browser-automation routes (app/api/manager/automation/*) —
// a separate secret from ADMIN_PASSPHRASE (lib/adminAuth.ts). The
// userscript's token lives embedded in a real browser session (via
// GM_setValue), not behind the httpOnly-cookie boundary the admin
// passphrase gets, so it's checked directly as a bearer token rather than
// hashed into a cookie — there's no session to maintain here, just a
// stateless shared secret on every request.
import crypto from "crypto";

export function isValidAutomationToken(header: string | undefined | null): boolean {
  const expected = process.env.AUTOMATION_TOKEN;
  if (!expected || !header) return false;
  const presented = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
