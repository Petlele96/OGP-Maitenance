import { NextRequest, NextResponse } from "next/server";
import { getSignupByPaymentLinkToken } from "@/lib/db";
import { PLANS, isPlanId } from "@/lib/plans";
import { buildCheckoutFields } from "@/lib/payfast";

export const runtime = "nodejs";

function siteUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return req.nextUrl.origin;
}

/**
 * Stage 2 of the book-then-pay flow: the page a "Send payment link" WhatsApp message
 * points to. Builds the exact same PayFast checkout fields /api/signup would have built
 * at signup time - the booking's `id` was already set as its payfast_m_payment_id back
 * in Stage 1, so the ITN handler activates this same row with no special-casing once the
 * customer pays here, whether that's minutes or days after booking.
 */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const signup = await getSignupByPaymentLinkToken(params.token);

  if (!signup) {
    return NextResponse.json({ error: "This payment link isn't valid." }, { status: 404 });
  }

  if (signup.payment_status !== "booked") {
    const message =
      signup.payment_status === "active"
        ? "This booking has already been paid - you're all set."
        : "This booking is no longer available. Please contact OGP Services on WhatsApp.";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  if (!signup.payment_link_expires_at || new Date(signup.payment_link_expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "This payment link has expired. Please contact OGP Services on WhatsApp for a new one." },
      { status: 410 }
    );
  }

  if (!isPlanId(signup.plan)) {
    return NextResponse.json({ error: "Something went wrong. Please contact OGP Services on WhatsApp." }, { status: 500 });
  }

  const base = siteUrl(req);
  const { actionUrl, fields } = buildCheckoutFields({
    signupId: signup.id,
    fullName: signup.full_name,
    whatsappNumber: signup.whatsapp_number,
    plan: PLANS[signup.plan],
    returnUrl: `${base}/thank-you?id=${signup.id}`,
    cancelUrl: `${base}/cancelled?id=${signup.id}`,
    notifyUrl: `${base}/api/payfast/itn`,
  });

  return NextResponse.json({ actionUrl, fields });
}
