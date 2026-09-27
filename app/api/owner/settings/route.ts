import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { getAppSettings, getBlockedDates } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [settings, blockedDates] = await Promise.all([getAppSettings(), getBlockedDates()]);
  return NextResponse.json({ settings, blockedDates });
}
