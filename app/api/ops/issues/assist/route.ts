import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { runIssueAssist } from "@/lib/issue-assist";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({ id: z.string().uuid() });

/** Asked for by the form right after an issue is saved. Suggests a description and a flag - changes nothing else. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  return NextResponse.json({ result: await runIssueAssist(parsed.data.id) });
}
