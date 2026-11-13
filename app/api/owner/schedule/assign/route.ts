import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/owner-auth";
import { getAppSettings, getBlockedDates, getSignup, setNextServiceDate } from "@/lib/db";
import { isWorkingDay, nowInJohannesburg, toDateKey } from "@/lib/schedule";
import { dateKeySchema } from "@/lib/validation";

export const runtime = "nodejs";

const schema = z.object({ signupId: z.string().uuid(), date: dateKeySchema });

/**
 * Gives a "to be scheduled" customer their service date. It is the same hand-set next service date the owner can
 * set anywhere else (never locked - recording a visit recalculates it), so the customer drops off the to-be-scheduled
 * list and onto that day's route. The WhatsApp message that tells the customer is opened by the dashboard.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });

  const { signupId, date } = parsed.data;
  const today = toDateKey(nowInJohannesburg());
  if (date < today) return NextResponse.json({ error: "That date has already passed." }, { status: 400 });

  // The date you tell the customer must be a day the crew actually works, or the route would quietly move them.
  const [settings, blocked] = await Promise.all([getAppSettings(), getBlockedDates()]);
  if (!isWorkingDay(new Date(`${date}T00:00:00`), settings.workingDays)) {
    return NextResponse.json({ error: "That isn't one of your working days." }, { status: 400 });
  }
  const block = blocked.find((b) => b.date === date);
  if (block) {
    return NextResponse.json({ error: `That date is blocked${block.label ? ` (${block.label})` : ""}.` }, { status: 400 });
  }

  const signup = await getSignup(signupId);
  if (!signup) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  if (signup.payment_status !== "active" && signup.payment_status !== "booked") {
    return NextResponse.json({ error: "Only booked or active customers can be scheduled." }, { status: 400 });
  }

  const result = await setNextServiceDate(signupId, date, today);
  if (result === "once_off") {
    return NextResponse.json({ error: "Once-off bookings are dated when they're paid, not here." }, { status: 400 });
  }
  if (result !== "ok") return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  return NextResponse.json({ ok: true, date });
}
