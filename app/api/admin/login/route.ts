import { NextRequest, NextResponse } from "next/server";
import { checkPassphrase, ADMIN_COOKIE } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  if (!process.env.ADMIN_PASSPHRASE) {
    return NextResponse.json(
      { error: "Admin access isn't configured (set ADMIN_PASSPHRASE)." },
      { status: 501 }
    );
  }

  const body = (await req.json().catch(() => null)) as { passphrase?: string } | null;
  const token = checkPassphrase(String(body?.passphrase || ""));
  if (!token) {
    return NextResponse.json({ error: "Wrong passphrase." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return res;
}
