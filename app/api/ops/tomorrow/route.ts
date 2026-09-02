import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { candidateSlotForDate, toDateKey } from "@/lib/schedule";
import { getActiveSignupsForSlots } from "@/lib/db";
import { groupByBlock } from "@/lib/sort";

export const runtime = "nodejs";

/** For the evening-before reminder round - no done-tracking, that only applies to today. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const slot = candidateSlotForDate(tomorrow);

  const signups = slot ? await getActiveSignupsForSlots([slot]) : [];
  const customers = signups.map((s) => ({
    id: s.id,
    fullName: s.full_name,
    houseNumber: s.house_number,
    whatsappNumber: s.whatsapp_number,
    block: s.block,
  }));

  return NextResponse.json({
    date: toDateKey(tomorrow),
    total: customers.length,
    groups: groupByBlock(customers),
  });
}
