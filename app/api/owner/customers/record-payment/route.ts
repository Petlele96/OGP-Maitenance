import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { recordManualPayment } from "@/lib/db";
import { recordManualPaymentSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** "Record a payment" for an EFT/cash customer. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = recordManualPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please check the amount and try again." }, { status: 400 });
  }

  await recordManualPayment(
    parsed.data.signupId,
    parsed.data.amount,
    parsed.data.method,
    parsed.data.receivedAt ?? null
  );
  return NextResponse.json({ ok: true });
}
