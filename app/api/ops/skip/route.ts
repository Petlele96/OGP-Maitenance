import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { recordSkippedVisit } from "@/lib/db";
import { SKIP_REASONS } from "@/lib/schedule";

export const runtime = "nodejs";

const skipSchema = z.object({
  signupId: z.string().uuid(),
  reason: z.enum(SKIP_REASONS),
  // The day being flagged - defaults to today. Lets a past, unconfirmed day be corrected.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** "Not done" on a day's route - records why, and bumps the customer to the next working day. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = skipSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing signupId or reason" }, { status: 400 });

  const skip = await recordSkippedVisit(parsed.data.signupId, parsed.data.reason, parsed.data.date);
  return NextResponse.json({ rescheduledDate: skip.rescheduled_date });
}
