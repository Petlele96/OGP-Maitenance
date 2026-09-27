import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { applyRebalance } from "@/lib/db";
import { rebalanceApplySchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Commits moves the owner explicitly accepted from the rebalance preview. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = rebalanceApplySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing or invalid moves" }, { status: 400 });

  await applyRebalance(parsed.data.moves);
  return NextResponse.json({ ok: true });
}
