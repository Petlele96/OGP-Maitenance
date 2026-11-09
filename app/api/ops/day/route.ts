import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { nowInJohannesburg, toDateKey } from "@/lib/schedule";
import { getDayRoute } from "@/lib/db";

export const runtime = "nodejs";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** ?date=YYYY-MM-DD (or "today", the default) - one day's route as a single list in service order. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = toDateKey(nowInJohannesburg());
  const param = req.nextUrl.searchParams.get("date") ?? "today";
  const date = param === "today" ? today : param;
  if (!DATE_KEY.test(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });

  const { yards } = await getDayRoute(date);

  return NextResponse.json({
    date,
    isToday: date === today,
    isFuture: date > today,
    yards,
  });
}
