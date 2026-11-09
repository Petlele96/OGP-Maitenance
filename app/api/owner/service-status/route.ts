import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { getServiceStatus } from "@/lib/db";

export const runtime = "nodejs";

/** Last service, who did it, next service date and overdue flag for every client - the same data /ops shows. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getServiceStatus());
}
