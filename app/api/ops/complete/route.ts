import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { toDateKey, nowInJohannesburg } from "@/lib/schedule";
import { markVisitDone } from "@/lib/db";

export const runtime = "nodejs";

const completeSchema = z.object({ signupId: z.string().uuid() });

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing signupId" }, { status: 400 });

  const visit = await markVisitDone(parsed.data.signupId, toDateKey(nowInJohannesburg()));
  return NextResponse.json({ completedAt: visit.completed_at });
}
