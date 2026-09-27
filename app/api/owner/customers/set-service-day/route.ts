import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { setServiceDay } from "@/lib/db";
import { setServiceDaySchema } from "@/lib/validation";

export const runtime = "nodejs";

/** "Change service day - apply to all future visits": permanently changes the schedule field. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = setServiceDaySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });

  await setServiceDay(parsed.data.signupId, parsed.data.serviceSlot ?? null, parsed.data.scheduledVisitDate ?? null);
  return NextResponse.json({ ok: true });
}
