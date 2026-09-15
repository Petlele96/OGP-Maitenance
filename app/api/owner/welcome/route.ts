import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/owner-auth";
import { markWelcomed } from "@/lib/db";

export const runtime = "nodejs";

const welcomeSchema = z.object({ signupId: z.string().uuid() });

/** Marks a customer welcomed once the owner has opened the WhatsApp welcome message to send it. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = welcomeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing signupId" }, { status: 400 });

  await markWelcomed(parsed.data.signupId);
  return NextResponse.json({ ok: true });
}
