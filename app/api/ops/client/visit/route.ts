import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { getWorker, recordVisit } from "@/lib/db";
import { nowInJohannesburg, toDateKey } from "@/lib/schedule";
import { MIN_RECORDABLE_DATE, dateKeySchema } from "@/lib/validation";

export const runtime = "nodejs";

const schema = z.object({
  signupId: z.string().uuid(),
  date: dateKeySchema,
  workerId: z.string().uuid(),
  note: z.string().trim().max(200, "Keep the note under 200 characters").optional(),
});

/** "Record a visit": any past date (default today), a worker from the list, an optional note. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the date and worker" }, { status: 400 });
  }

  const today = toDateKey(nowInJohannesburg());
  if (parsed.data.date > today) {
    return NextResponse.json({ error: "A visit can't be recorded for a future date." }, { status: 400 });
  }
  if (parsed.data.date < MIN_RECORDABLE_DATE) {
    return NextResponse.json({ error: "That date looks wrong - please check the year." }, { status: 400 });
  }

  const worker = await getWorker(parsed.data.workerId);
  if (!worker) return NextResponse.json({ error: "That worker isn't on the list any more. Pick another." }, { status: 400 });

  const result = await recordVisit({
    signupId: parsed.data.signupId,
    serviceDate: parsed.data.date,
    worker: worker.name,
    note: parsed.data.note ? parsed.data.note : null,
  });

  if (!result.ok) {
    if (result.reason === "not_found") return NextResponse.json({ error: "Client not found" }, { status: 404 });
    return NextResponse.json(
      {
        error:
          "This yard is flagged Not done (or was moved) on that day. Unflag it on that day's route first, then record the visit.",
      },
      { status: 409 }
    );
  }
  return NextResponse.json({
    ok: true,
    updatedExisting: result.updatedExisting,
    nextServiceDate: result.nextServiceDate,
    nextDateUpdated: result.nextDateUpdated,
    nextDateReason: result.nextDateReason,
  });
}
