import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { getCalendarMonth, getAppSettings } from "@/lib/db";

export const runtime = "nodejs";

/** ?month=YYYY-MM - every scheduled visit that month, grouped by day. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const monthParam = req.nextUrl.searchParams.get("month");
  const match = monthParam?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });

  const year = Number(match[1]);
  const month = Number(match[2]);

  const [days, settings] = await Promise.all([getCalendarMonth(year, month), getAppSettings()]);
  return NextResponse.json({ days, dailyVisitLimit: settings.dailyVisitLimit });
}
