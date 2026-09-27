import { NextRequest, NextResponse } from "next/server";
import { getWeekDates, toDateKey, nowInJohannesburg } from "@/lib/schedule";
import { isAuthorized } from "@/lib/ops-auth";
import { getVisitsGroupedByDate, getVisitsForDates } from "@/lib/db";
import { compareHouseNumbers } from "@/lib/sort";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const weekDates = getWeekDates(nowInJohannesburg());
  const dateKeys = weekDates.map(toDateKey);

  const grouped = await getVisitsGroupedByDate(dateKeys);
  const visits = await getVisitsForDates(dateKeys);
  const doneKeys = new Set(visits.map((v) => `${v.signup_id}|${v.service_date}`));

  const days = dateKeys.map((dateKey) => {
    const customers = (grouped.get(dateKey) ?? [])
      .map((s) => ({
        id: s.id,
        fullName: s.full_name,
        houseNumber: s.house_number,
        plan: s.plan,
        done: doneKeys.has(`${s.id}|${dateKey}`),
      }))
      .sort((a, b) => compareHouseNumbers(a.houseNumber, b.houseNumber));
    return { date: dateKey, customers };
  });

  return NextResponse.json({ days });
}
