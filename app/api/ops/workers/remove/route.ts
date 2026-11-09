import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { removeWorker } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({ id: z.string().uuid() });

/** Removes a name from the picker. Visits already recorded keep that worker's name. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing worker id" }, { status: 400 });

  await removeWorker(parsed.data.id);
  return NextResponse.json({ ok: true });
}
