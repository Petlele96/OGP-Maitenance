import { NextRequest, NextResponse } from "next/server";
import { verifyItn } from "@/lib/payfast";
import { getSignupByMPaymentId, activateSignup, markSignupFailed, cancelSignup, recordPayment } from "@/lib/db";
import { PLANS, isPlanId } from "@/lib/plans";

export const runtime = "nodejs";

function sourceIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return null;
}

/**
 * PayFast notify_url. This is the ONLY place a signup is ever marked 'active' - the
 * return_url the browser lands on is just UX and is never trusted as proof of payment.
 * Returns non-2xx on any validation failure so PayFast retries the notification.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const mPaymentId = params.get("m_payment_id") ?? params.get("custom_str1");

  if (!mPaymentId) {
    return NextResponse.json({ error: "Missing m_payment_id" }, { status: 400 });
  }

  const signup = await getSignupByMPaymentId(mPaymentId);
  if (!signup || !isPlanId(signup.plan)) {
    return NextResponse.json({ error: "Unknown signup" }, { status: 404 });
  }

  const plan = PLANS[signup.plan];
  const result = await verifyItn(rawBody, sourceIp(req), { amount: plan.amount });

  if (!result.valid) {
    console.error("PayFast ITN rejected", { signupId: signup.id, reasons: result.reasons });
    return NextResponse.json({ error: "Invalid notification", reasons: result.reasons }, { status: 400 });
  }

  const paymentStatus = result.data.payment_status;
  if (paymentStatus === "COMPLETE") {
    await activateSignup(signup.id, result.data.token ?? null);
    const amount = Number.parseFloat(result.data.amount_gross ?? "");
    if (Number.isFinite(amount)) {
      await recordPayment(signup.id, amount, result.data.pf_payment_id ?? null);
    }
  } else if (signup.payment_status === "active") {
    // Any non-COMPLETE ITN against an already-active subscription means it stopped
    // renewing (explicit cancellation or a failed recurring charge) - PayFast's docs
    // don't specify the exact payment_status string for cancellation, so this is a
    // deliberately broad catch-all rather than matching a specific value.
    await cancelSignup(signup.id);
  } else {
    await markSignupFailed(signup.id);
  }

  return new NextResponse("OK", { status: 200 });
}
