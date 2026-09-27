import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/owner-auth";
import { resumeSignup } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({ signupId: z.string().uuid() });

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing signupId" }, { status: 400 });

  await resumeSignup(parsed.data.signupId);
  return NextResponse.json({ ok: true });
}
