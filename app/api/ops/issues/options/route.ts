import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { listIssueCustomers, listWorkers } from "@/lib/db";

export const runtime = "nodejs";

/** What the "Log an issue" form needs: customers to attach it to, and the workers list for "Logged by". */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [customers, workers] = await Promise.all([listIssueCustomers(), listWorkers()]);
  return NextResponse.json({ customers, workers });
}
