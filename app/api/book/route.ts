import { NextRequest, NextResponse } from "next/server";
import { createBooking, hasExistingSubscription } from "@/lib/db";
import { PLANS, isSubscriberPlan } from "@/lib/plans";
import { signupSchema, normalizeCellNumber } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Stage 1 of the book-then-pay flow: name/house/WhatsApp/plan, no PayFast interaction.
 * Scoped to monthly/annual - "recurring billing starts" in Stage 2 has no meaning for a
 * once-off visit, so that plan only ever goes through the pay-now /api/signup route.
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

  if (!isSubscriberPlan(planId)) {
    return NextResponse.json(
      { error: "Booking now and paying later is only available for the monthly and annual plans." },
      { status: 400 }
    );
  }

  if (await hasExistingSubscription(whatsappNumber)) {
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
