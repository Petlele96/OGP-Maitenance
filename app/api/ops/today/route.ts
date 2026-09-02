import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { candidateSlotForDate, toDateKey } from "@/lib/schedule";
import { getActiveSignupsForSlots, getVisitsForDates } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new Date();
  const slot = candidateSlotForDate(today);
  const dateKey = toDateKey(today);

  const signups = slot ? await getActiveSignupsForSlots([slot]) : [];
  const visits = await getVisitsForDates([dateKey]);
  const visitBySignup = new Map(visits.map((v) => [v.signup_id, v]));

  const customers = signups.map((s) => ({
    id: s.id,
    fullName: s.full_name,
    houseNumber: s.house_number,
    whatsappNumber: s.whatsapp_number,
    done: visitBySignup.has(s.id),
    completedAt: visitBySignup.get(s.id)?.completed_at ?? null,
  }));

  return NextResponse.json({
    date: dateKey,
    total: customers.length,
    doneCount: customers.filter((c) => c.done).length,
    customers,
  });
}
