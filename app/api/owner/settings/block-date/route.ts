import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { blockDate } from "@/lib/db";
import { blockDateSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Marks a date unavailable and bulk-moves everyone currently due on it to the next working day. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = blockDateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing or invalid date" }, { status: 400 });

  const moved = await blockDate(parsed.data.date, parsed.data.label ?? null);
  return NextResponse.json({ moved });
}
