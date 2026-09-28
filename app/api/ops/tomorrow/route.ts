import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { toDateKey, nowInJohannesburg } from "@/lib/schedule";
import { getVisitsGroupedByDate } from "@/lib/db";
import { groupByBlock } from "@/lib/sort";

export const runtime = "nodejs";

/**
 * For the evening-before reminder round - no done-tracking, that only applies to today.
 * Uses getVisitsGroupedByDate (not the raw signups pool) so a customer moved off
 * tomorrow's date correctly disappears from this list, and anyone moved onto tomorrow
 * correctly appears - a plain "who matches tomorrow's raw slot/date" query doesn't know
 * about skipped_visits overrides either way.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tomorrow = nowInJohannesburg();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateKey = toDateKey(tomorrow);

  const grouped = await getVisitsGroupedByDate([dateKey]);
  const signups = grouped.get(dateKey) ?? [];
  const customers = signups.map((s) => ({
    id: s.id,
    fullName: s.full_name,
    houseNumber: s.house_number,
    whatsappNumber: s.whatsapp_number,
    block: s.block,
    plan: s.plan,
    notes: s.notes,
  }));

  return NextResponse.json({
    date: dateKey,
    total: customers.length,
    groups: groupByBlock(customers),
  });
}
