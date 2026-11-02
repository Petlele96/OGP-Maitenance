import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/owner-auth";
import { archiveSignup } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({ signupId: z.string().uuid() });

/** Archive a booking that never paid - reversible, nothing is deleted. */
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

  const archived = await archiveSignup(parsed.data.signupId);
  if (!archived) {
    return NextResponse.json(
      { error: "Only a customer who hasn't paid (booked, pending or failed) can be archived." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
