import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { updateSignup } from "@/lib/db";
import { updateSignupSchema, normalizeCellNumber } from "@/lib/validation";

export const runtime = "nodejs";

/** "Edit customer" on the owner page - always a full overwrite of the editable fields. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = updateSignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please check the form for mistakes.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const signup = await updateSignup({
    ...parsed.data,
    whatsappNumber: normalizeCellNumber(parsed.data.whatsappNumber),
  });
  if (!signup) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
