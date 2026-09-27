import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { proposeRebalance, getAppSettings } from "@/lib/db";

export const runtime = "nodejs";

/** Read-only - proposes moves without applying anything. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getAppSettings();
  const moves = await proposeRebalance(settings.dailyVisitLimit);
  return NextResponse.json({ moves });
}
