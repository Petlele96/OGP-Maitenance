import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { listIssues } from "@/lib/db";
import { isAssistConfigured } from "@/lib/issue-assist";

export const runtime = "nodejs";

/** Every issue, newest first (no photos - each one is fetched on its own). Filtering is done on the page. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ issues: await listIssues(), assistConfigured: isAssistConfigured() });
}
