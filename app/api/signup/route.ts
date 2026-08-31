import { NextRequest, NextResponse } from "next/server";
import { createSignup } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { buildCheckoutFields } from "@/lib/payfast";
import { signupSchema, normalizeCellNumber } from "@/lib/validation";

export const runtime = "nodejs";

function siteUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return req.nextUrl.origin;
}

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
  const plan = PLANS[planId];

  const signup = await createSignup({
    fullName,
    houseNumber,
    whatsappNumber,
    plan: planId,
    amount: plan.amount,
  });

  const base = siteUrl(req);
  const { actionUrl, fields } = buildCheckoutFields({
    signupId: signup.id,
    fullName,
    whatsappNumber,
    plan,
    returnUrl: `${base}/thank-you?id=${signup.id}`,
    cancelUrl: `${base}/cancelled?id=${signup.id}`,
    notifyUrl: `${base}/api/payfast/itn`,
  });

  return NextResponse.json({ id: signup.id, actionUrl, fields });
}
