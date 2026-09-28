import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { getSignup, recordMovedVisit, getEffectiveNextServiceDate, asDateKey } from "@/lib/db";
import { moveNextVisitSchema } from "@/lib/validation";
import { nowInJohannesburg, toDateKey } from "@/lib/schedule";

export const runtime = "nodejs";

/** "Change service day - just the next one": moves only the customer's next occurrence, leaving their recurring slot/date untouched. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = moveNextVisitSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });

  const signup = await getSignup(parsed.data.signupId);
  if (!signup) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const nextDate = await getEffectiveNextServiceDate(
    signup.id,
    { service_slot: signup.service_slot, scheduled_visit_date: asDateKey(signup.scheduled_visit_date) },
    nowInJohannesburg()
  );
  if (!nextDate) return NextResponse.json({ error: "This customer has no upcoming visit to move" }, { status: 409 });

  const move = await recordMovedVisit(signup.id, toDateKey(nextDate), parsed.data.targetDate);
  return NextResponse.json({ rescheduledDate: move.rescheduled_date });
}
