import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { getOpsClients } from "@/lib/db";

export const runtime = "nodejs";

/** Clients on the service list with their last visit (date and worker) and next service date. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ clients: await getOpsClients() });
}
