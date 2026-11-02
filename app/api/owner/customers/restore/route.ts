import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/owner-auth";
import { getSignup, hasExistingSubscription, restoreSignup } from "@/lib/db";
import { isSubscriberPlan } from "@/lib/plans";

export const runtime = "nodejs";

const schema = z.object({ signupId: z.string().uuid() });

/** Restore an archived customer: back on the schedule as 'booked', awaiting payment. */
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

  const signup = await getSignup(parsed.data.signupId);
  if (!signup || signup.payment_status !== "archived") {
    return NextResponse.json({ error: "That customer isn't archived." }, { status: 409 });
  }

  // The same number may have booked again since - restoring would create a double booking.
  if (isSubscriberPlan(signup.plan) && (await hasExistingSubscription(signup.whatsapp_number))) {
    return NextResponse.json(
      { error: "This WhatsApp number already has an active or booked plan, so this one can't be restored." },
      { status: 409 }
    );
  }

  await restoreSignup(signup.id);
  return NextResponse.json({ ok: true });
}
