import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { setNextServiceDate } from "@/lib/db";
import { nowInJohannesburg, toDateKey } from "@/lib/schedule";
import { MIN_RECORDABLE_DATE, dateKeySchema } from "@/lib/validation";

export const runtime = "nodejs";

const schema = z.object({
  signupId: z.string().uuid(),
  // null clears it. The calculated date is only ever a suggestion - this can always override it.
  date: dateKeySchema.nullable(),
});

/** Change (or clear) a client's next service date by hand. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid date" }, { status: 400 });
  if (parsed.data.date !== null && parsed.data.date < MIN_RECORDABLE_DATE) {
    return NextResponse.json({ error: "That date looks wrong - please check the year." }, { status: 400 });
  }

  const result = await setNextServiceDate(parsed.data.signupId, parsed.data.date, toDateKey(nowInJohannesburg()));
  if (result === "not_found") return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (result === "once_off") {
    return NextResponse.json({ error: "Once-off bookings don't repeat, so they have no next service date." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
