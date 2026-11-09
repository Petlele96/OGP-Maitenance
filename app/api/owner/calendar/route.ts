import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { getServiceCalendar, getAppSettings } from "@/lib/db";

export const runtime = "nodejs";

/** ?month=YYYY-MM - who was serviced and who is due on each day of that month, across all clients. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const monthParam = req.nextUrl.searchParams.get("month");
  const match = monthParam?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "month out of range" }, { status: 400 });
  }

  const [days, settings] = await Promise.all([getServiceCalendar(year, month), getAppSettings()]);
  return NextResponse.json({ days, dailyVisitLimit: settings.dailyVisitLimit });
}
