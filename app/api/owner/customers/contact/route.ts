import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/owner-auth";
import { recordContact } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({ signupId: z.string().uuid() });

/** Fired alongside any WhatsApp button on the owner side - records last_contacted_at. */
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

  await recordContact(parsed.data.signupId);
  return NextResponse.json({ ok: true });
}
