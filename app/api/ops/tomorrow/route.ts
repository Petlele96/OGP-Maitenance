import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { toDateKey, nowInJohannesburg } from "@/lib/schedule";
import { getActiveVisitsForDates } from "@/lib/db";
import { groupByBlock } from "@/lib/sort";

export const runtime = "nodejs";

/** For the evening-before reminder round - no done-tracking, that only applies to today. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tomorrow = nowInJohannesburg();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateKey = toDateKey(tomorrow);

  const signups = await getActiveVisitsForDates([dateKey]);
  const customers = signups.map((s) => ({
    id: s.id,
    fullName: s.full_name,
    houseNumber: s.house_number,
    whatsappNumber: s.whatsapp_number,
    block: s.block,
    plan: s.plan,
  }));

  return NextResponse.json({
    date: dateKey,
    total: customers.length,
    groups: groupByBlock(customers),
  });
}
