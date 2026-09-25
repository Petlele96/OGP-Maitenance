import { NextRequest, NextResponse } from "next/server";
import { createBooking, hasExistingSubscription } from "@/lib/db";
import { PLANS, isSubscriberPlan } from "@/lib/plans";
import { signupSchema, normalizeCellNumber } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Stage 1 of the book-then-pay flow: name/house/WhatsApp/plan, no PayFast interaction.
 * Available for all three plans - insertSignup gives a once-off booking its tentative
 * visit date up front too, same as monthly/annual get their slot, so "given a service
 * day" holds regardless of which plan was picked.
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
