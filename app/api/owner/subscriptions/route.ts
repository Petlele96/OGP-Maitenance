import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { getSubscriptions } from "@/lib/db";

export const runtime = "nodejs";

/** Every subscriber with the date they subscribed and their next debit date. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ subscriptions: await getSubscriptions() });
}
