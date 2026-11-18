import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { createIssue, getSignup, getWorker } from "@/lib/db";
import {
  ISSUE_PHOTO_MAX_BYTES,
  ISSUE_THUMB_MAX_BYTES,
  createIssueSchema,
  looksLikeJpeg,
  parseGpsFields,
} from "@/lib/issues";

export const runtime = "nodejs";

async function jpegFrom(entry: FormDataEntryValue | null, maxBytes: number): Promise<Buffer | null> {
  if (!entry || typeof entry === "string") return null;
  if (entry.size === 0 || entry.size > maxBytes) return null;
  const bytes = Buffer.from(await entry.arrayBuffer());
  return looksLikeJpeg(bytes) ? bytes : null;
}

/**
 * Log a maintenance issue (ops side). Multipart: the photo is required, so it travels with the fields. The form
 * shrinks the picture to a JPEG on the phone first and sends a small copy for the monthly PDF alongside it.
 * Saving does not wait for the AI step - the form asks for that separately afterwards - and nothing is sent anywhere.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const photo = await jpegFrom(form.get("photo"), ISSUE_PHOTO_MAX_BYTES);
  const thumb = await jpegFrom(form.get("thumb"), ISSUE_THUMB_MAX_BYTES);
  if (!photo || !thumb) {
    return NextResponse.json({ error: "Add a photo of the issue (it must be a picture, under 3 MB)." }, { status: 400 });
  }

  const fields: Record<string, string> = {};
  for (const key of ["issueType", "urgent", "signupId", "locationText", "locationDetail", "phase", "note", "workerId"]) {
    const v = form.get(key);
    if (typeof v === "string" && v.trim() !== "") fields[key] = v.trim();
  }
  const parsed = createIssueSchema.safeParse(fields);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form" }, { status: 400 });
  }
  const input = parsed.data;
  // GPS is a bonus: a missing, malformed or odd fix is simply left out and the issue still saves.
  const gps = parseGpsFields({
    gpsLat: String(form.get("gpsLat") ?? "").trim(),
    gpsLng: String(form.get("gpsLng") ?? "").trim(),
    gpsAccuracy: String(form.get("gpsAccuracy") ?? "").trim(),
  });

  const worker = await getWorker(input.workerId);
  if (!worker) return NextResponse.json({ error: "That worker is not on the list any more. Pick another." }, { status: 400 });

  // A customer's issue is located by their house number only - never their name - so reports can go to a client safely.
  let signupId: string | null = null;
  let locationLabel = input.locationText ?? "";
  let phase: number | null = input.phase ?? null;
  if (input.signupId) {
    const customer = await getSignup(input.signupId);
    if (!customer) return NextResponse.json({ error: "That customer was not found." }, { status: 400 });
    signupId = customer.id;
    locationLabel = `House ${customer.house_number}`;
    phase = input.phase ?? customer.phase ?? null;
  }

  const id = await createIssue({
    issueType: input.issueType,
    note: input.note ?? null,
    urgent: input.urgent === "yes",
    signupId,
    locationLabel,
    locationDetail: signupId ? (input.locationDetail ?? null) : null,
    gps,
    phase,
    loggedBy: worker.name,
    photo,
    thumb,
  });
  return NextResponse.json({ ok: true, id });
}
