import { NextRequest, NextResponse } from "next/server";
import { getSignupByTrackingToken, getCompletedVisitDates, getEffectiveNextServiceDate, asDateKey } from "@/lib/db";
import { nowInJohannesburg, toDateKey } from "@/lib/schedule";
import { ASK_QUESTION_LINK } from "@/lib/site";
import { PLANS } from "@/lib/plans";

export const runtime = "nodejs";

/** Public, no auth - the token itself (a random UUID) is the only credential. */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const signup = await getSignupByTrackingToken(params.token);
  if (!signup || signup.payment_status === "cancelled") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const next = await getEffectiveNextServiceDate(
    signup.id,
    { service_slot: signup.service_slot, scheduled_visit_date: asDateKey(signup.scheduled_visit_date) },
    nowInJohannesburg()
  );
  const visitDates = await getCompletedVisitDates(signup.id);

  return NextResponse.json({
    fullName: signup.full_name,
    houseNumber: signup.house_number,
    planLabel: PLANS[signup.plan].label,
    nextServiceDate: next ? toDateKey(next) : null,
    visitDates,
    whatsappLink: ASK_QUESTION_LINK,
  });
}
