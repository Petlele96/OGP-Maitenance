import { NextResponse } from "next/server";
import { OPS_COOKIE_NAME } from "@/lib/ops-auth";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(OPS_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
