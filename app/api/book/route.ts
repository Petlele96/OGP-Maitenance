import { NextRequest, NextResponse } from "next/server";
import { createBooking, hasExistingSubscription } from "@/lib/db";
import { PLANS, isSubscriberPlan } from "@/lib/plans";
import { signupSchema, normalizeCellNumber } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * "Book now, pay after your first service": name/house/WhatsApp, no PayFast interaction. Monthly plan only - the
 * customer is created as booked (awaiting payment) with no service day, which the owner assigns from the dashboard,
 * and a payment link follows once their first visit is done.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please check the form for mistakes.", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { fullName, houseNumber, plan: planId } = parsed.data;
  if (planId !== "monthly") {
    return NextResponse.json(
      { error: "Booking now and paying after your first service is only available on the Monthly plan." },
      { status: 400 }
    );
  }
  const whatsappNumber = normalizeCellNumber(parsed.data.whatsappNumber);

  // Scoped to subscriptions, same as the pay-now route - a once-off booking (first-time
  // or repeat) is normal business, not an accidental double-signup.
  if (isSubscriberPlan(planId) && (await hasExistingSubscription(whatsappNumber))) {
    return NextResponse.json(
      {
        error:
          "This WhatsApp number already has an active or booked plan with us. If you'd like to make a change, message us on WhatsApp and we'll help.",
      },
      { status: 409 }
    );
  }

  const plan = PLANS[planId];
  const booking = await createBooking({
    fullName,
    houseNumber,
    whatsappNumber,
    plan: planId,
    amount: plan.amount,
    block: parsed.data.block ?? null,
  });

  return NextResponse.json({ id: booking.id });
}
