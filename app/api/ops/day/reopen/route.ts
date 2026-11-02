import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { reopenDay } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Reopens a confirmed day for correction - never locked, no time limit. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing or invalid date" }, { status: 400 });

  await reopenDay(parsed.data.date);
  return NextResponse.json({ ok: true });
}
