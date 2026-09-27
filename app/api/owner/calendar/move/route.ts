import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { recordMovedVisit } from "@/lib/db";
import { moveVisitSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Tap-to-move a single visit from the owner calendar - one occurrence only. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = moveVisitSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });

  const { signupId, originalDate, targetDate } = parsed.data;
  const move = await recordMovedVisit(signupId, originalDate, targetDate);
  return NextResponse.json({ rescheduledDate: move.rescheduled_date });
}
