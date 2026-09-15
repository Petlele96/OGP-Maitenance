import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { toDateKey, nowInJohannesburg } from "@/lib/schedule";
import { getActiveVisitsForDates, getVisitsForDates, getSkipsForDate } from "@/lib/db";
import { groupByBlock } from "@/lib/sort";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dateKey = toDateKey(nowInJohannesburg());

  const signups = await getActiveVisitsForDates([dateKey]);
  const visits = await getVisitsForDates([dateKey]);
  const visitBySignup = new Map(visits.map((v) => [v.signup_id, v]));
  const skips = await getSkipsForDate(dateKey);

  const customers = signups.map((s) => ({
    id: s.id,
    fullName: s.full_name,
    houseNumber: s.house_number,
    whatsappNumber: s.whatsapp_number,
    block: s.block,
    plan: s.plan,
    done: visitBySignup.has(s.id),
    completedAt: visitBySignup.get(s.id)?.completed_at ?? null,
    skippedReason: skips.get(s.id)?.reason ?? null,
    skippedRescheduledDate: skips.get(s.id)?.rescheduledDate ?? null,
  }));

  return NextResponse.json({
    date: dateKey,
    total: customers.length,
    doneCount: customers.filter((c) => c.done).length,
    skippedCount: customers.filter((c) => c.skippedReason !== null).length,
    groups: groupByBlock(customers),
  });
}
