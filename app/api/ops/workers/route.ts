import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { addWorker, listWorkers } from "@/lib/db";

export const runtime = "nodejs";

const addSchema = z.object({ name: z.string().trim().min(2, "Enter the worker's name").max(60) });

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ workers: await listWorkers() });
}

/** Adds a name to the workers list (the "who did the job" picker). Name only - nothing else is stored. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter the worker's name" }, { status: 400 });
  }

  const worker = await addWorker(parsed.data.name.replace(/\s+/g, " "));
  if (!worker) return NextResponse.json({ error: "That worker is already on the list." }, { status: 409 });
  return NextResponse.json({ worker });
}
