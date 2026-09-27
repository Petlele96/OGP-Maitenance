import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { postponeAllToday } from "@/lib/db";

export const runtime = "nodejs";

/** "Postpone today" - bulk-moves every remaining visit today to the next working day, for rain. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const count = await postponeAllToday();
  return NextResponse.json({ postponed: count });
}
