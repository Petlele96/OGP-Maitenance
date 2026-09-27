import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { createManualSignup, hasExistingSubscription } from "@/lib/db";
import { manualSignupSchema, normalizeCellNumber } from "@/lib/validation";
import { isSubscriberPlan } from "@/lib/plans";

export const runtime = "nodejs";

/** "Add customer manually" on the owner page - creates a customer the same as a web signup would. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = manualSignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please check the form for mistakes.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const whatsappNumber = normalizeCellNumber(parsed.data.whatsappNumber);

  if (isSubscriberPlan(parsed.data.plan) && (await hasExistingSubscription(whatsappNumber))) {
    return NextResponse.json(
      { error: "This WhatsApp number already has an active or booked plan with us." },
      { status: 409 }
    );
  }

  const signup = await createManualSignup({
    fullName: parsed.data.fullName,
    houseNumber: parsed.data.houseNumber,
    whatsappNumber,
    plan: parsed.data.plan,
    paymentMethod: parsed.data.paymentMethod,
    block: parsed.data.block ?? null,
    serviceSlot: parsed.data.serviceSlot ?? null,
    scheduledVisitDate: parsed.data.scheduledVisitDate ?? null,
    notes: parsed.data.notes ?? null,
  });

  return NextResponse.json({ id: signup.id });
}
