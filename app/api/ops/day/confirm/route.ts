import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { nowInJohannesburg, toDateKey } from "@/lib/schedule";
import { confirmDay } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  crew: z.string().trim().max(80).nullable().optional(),
});

/** "Confirm day" - no time limit: any past day can be confirmed, however old. Only the future can't. */
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

  if (parsed.data.date > toDateKey(nowInJohannesburg())) {
    return NextResponse.json({ error: "That day hasn't happened yet." }, { status: 400 });
  }

  await confirmDay(parsed.data.date, parsed.data.crew?.trim() || null);
  return NextResponse.json({ ok: true });
}
