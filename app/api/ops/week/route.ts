import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { candidateSlotForDate, getWeekDates, toDateKey } from "@/lib/schedule";
import { getActiveSignupsForSlots, getVisitsForDates } from "@/lib/db";
import { compareHouseNumbers } from "@/lib/sort";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const weekDates = getWeekDates(new Date());
  const dateKeys = weekDates.map(toDateKey);
  const slotByDate = new Map(dateKeys.map((key, i) => [key, candidateSlotForDate(weekDates[i])]));
  const slots = Array.from(new Set(Array.from(slotByDate.values()).filter((s): s is number => s !== null)));

  const signups = await getActiveSignupsForSlots(slots);
  const visits = await getVisitsForDates(dateKeys);
  const doneKeys = new Set(visits.map((v) => `${v.signup_id}|${v.service_date}`));

  const days = dateKeys.map((dateKey) => {
    const slot = slotByDate.get(dateKey) ?? null;
    const customers = slot
      ? signups
          .filter((s) => s.service_slot === slot)
          .map((s) => ({
            id: s.id,
            fullName: s.full_name,
            houseNumber: s.house_number,
            done: doneKeys.has(`${s.id}|${dateKey}`),
          }))
          .sort((a, b) => compareHouseNumbers(a.houseNumber, b.houseNumber))
      : [];
    return { date: dateKey, customers };
  });

  return NextResponse.json({ days });
}
