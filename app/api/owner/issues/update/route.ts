import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { dismissIssueFlag, setIssueReportDescription, setIssueStatus, setIssueUrgent } from "@/lib/db";
import { updateIssueSchema } from "@/lib/issues";

export const runtime = "nodejs";

/**
 * The owner's changes to an issue: its status (the date is stamped), urgent or not, the line used in the report,
 * and dismissing the AI's flag. Only the owner can do any of these - the AI never calls this route.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = updateIssueSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const c = parsed.data;

  let found = true;
  if (c.action === "status") {
    // Choosing the status it already has is not an error - it just changes nothing.
    await setIssueStatus(c.id, c.status);
  } else if (c.action === "urgent") {
    found = await setIssueUrgent(c.id, c.urgent);
  } else if (c.action === "dismiss_flag") {
    found = await dismissIssueFlag(c.id);
  } else {
    found = await setIssueReportDescription(c.id, c.description);
  }
  if (!found) return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
