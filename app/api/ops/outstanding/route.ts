import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { getOutstandingDays } from "@/lib/db";

export const runtime = "nodejs";

/** Every unconfirmed past day, oldest first. Also doubles as the ops page's auth probe. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const days = await getOutstandingDays();
  return NextResponse.json({ count: days.length, days });
}
