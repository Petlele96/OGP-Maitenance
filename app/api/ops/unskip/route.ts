import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { unflagNotDone } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({
  signupId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Undo a "Not done" flag - the yard goes back to being assumed done on that day. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing signupId or date" }, { status: 400 });

  await unflagNotDone(parsed.data.signupId, parsed.data.date);
  return NextResponse.json({ ok: true });
}
