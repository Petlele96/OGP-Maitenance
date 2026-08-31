import { NextRequest, NextResponse } from "next/server";
import { getSignup } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const signup = await getSignup(params.id);
  if (!signup) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: signup.id,
    fullName: signup.full_name,
    plan: signup.plan,
    paymentStatus: signup.payment_status,
    startDate: signup.start_date,
  });
}
