import { NextRequest, NextResponse } from "next/server";
import { candidateSlotForDate, getWeekDates, toDateKey, nowInJohannesburg } from "@/lib/schedule";
import { isAuthorized } from "@/lib/ops-auth";
import { getActiveVisitsForDates, getVisitsForDates } from "@/lib/db";
import { compareHouseNumbers } from "@/lib/sort";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const weekDates = getWeekDates(nowInJohannesburg());
  const dateKeys = weekDates.map(toDateKey);
  const slotByDate = new Map(dateKeys.map((key, i) => [key, candidateSlotForDate(weekDates[i])]));

  const signups = await getActiveVisitsForDates(dateKeys);
  const visits = await getVisitsForDates(dateKeys);
  const doneKeys = new Set(visits.map((v) => `${v.signup_id}|${v.service_date}`));

  const days = dateKeys.map((dateKey) => {
    const slot = slotByDate.get(dateKey) ?? null;
    const customers = signups
      .filter((s) => (slot !== null && s.service_slot === slot) || s.scheduled_visit_date === dateKey)
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
