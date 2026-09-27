import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { unblockDate } from "@/lib/db";
import { unblockDateSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Removes a date from the blocked list going forward - does not undo any visits already moved. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = unblockDateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing date" }, { status: 400 });

  await unblockDate(parsed.data.date);
  return NextResponse.json({ ok: true });
}
