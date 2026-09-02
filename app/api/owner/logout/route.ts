import { NextResponse } from "next/server";
import { OWNER_COOKIE_NAME } from "@/lib/owner-auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(OWNER_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
