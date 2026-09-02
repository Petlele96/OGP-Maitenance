import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { toDateKey } from "@/lib/schedule";
import { getActiveVisitsForDates, getVisitsForDates } from "@/lib/db";
import { groupByBlock } from "@/lib/sort";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dateKey = toDateKey(new Date());

  const signups = await getActiveVisitsForDates([dateKey]);
  const visits = await getVisitsForDates([dateKey]);
  const visitBySignup = new Map(visits.map((v) => [v.signup_id, v]));

  const customers = signups.map((s) => ({
    id: s.id,
    fullName: s.full_name,
    houseNumber: s.house_number,
    whatsappNumber: s.whatsapp_number,
    block: s.block,
    plan: s.plan,
    done: visitBySignup.has(s.id),
    completedAt: visitBySignup.get(s.id)?.completed_at ?? null,
  }));

  return NextResponse.json({
    date: dateKey,
    total: customers.length,
    doneCount: customers.filter((c) => c.done).length,
    groups: groupByBlock(customers),
  });
}
