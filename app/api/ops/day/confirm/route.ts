import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { nowInJohannesburg, toDateKey } from "@/lib/schedule";
import { confirmDay, getWorker } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  workerId: z.string().uuid(),
});

/**
 * "Confirm day" - a bulk shortcut that writes a visit record (that date, the worker picked) for every client on
 * today's list who has none for the date yet. It stores nothing about the day itself.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Pick who did the route." }, { status: 400 });

  // Only today: a list for another day is not a record of anything. Past work is recorded per client, with its real date.
  if (parsed.data.date !== toDateKey(nowInJohannesburg())) {
    return NextResponse.json(
      { error: "Confirm day works on today's list. Use Record a visit on the client for any other date." },
      { status: 400 }
    );
  }

  const worker = await getWorker(parsed.data.workerId);
  if (!worker) return NextResponse.json({ error: "That worker isn't on the list any more. Pick another." }, { status: 400 });

  const recorded = await confirmDay(parsed.data.date, worker.name);
  return NextResponse.json({ ok: true, recorded });
}
