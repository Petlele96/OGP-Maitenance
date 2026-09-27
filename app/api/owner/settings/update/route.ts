import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { updateAppSettings } from "@/lib/db";
import { updateSettingsSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Please check the settings and try again." }, { status: 400 });

  const settings = await updateAppSettings(parsed.data);
  return NextResponse.json({ settings });
}
