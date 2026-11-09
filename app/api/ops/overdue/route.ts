import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { getOverdueClients } from "@/lib/db";

export const runtime = "nodejs";

/** Clients whose next service date has passed. Also doubles as the ops page's auth probe. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clients = await getOverdueClients();
  return NextResponse.json({ count: clients.length, clients });
}
