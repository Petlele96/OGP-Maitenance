import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createReview } from "@/lib/db";
import { REVIEW_MAX_PER_DAY, REVIEW_MAX_PER_HOUR } from "@/lib/reviews";
import { normalizeCellNumber, reviewSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** On Vercel these headers are set by the platform (a client can't forge them). */
function clientIp(req: NextRequest): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

/** Only a salted hash is kept, and only to rate-limit - the address itself is never stored. */
function hashIp(ip: string): string {
  const key = process.env.OWNER_PASSWORD?.trim() || "ogp-reviews";
  return crypto.createHmac("sha256", `${key}:review-ip`).update(ip).digest("hex");
}

/**
 * Public, no auth and no token - anyone with the link can send a review. It is always stored as Pending
 * and never appears on the site until the owner approves it. The response never says whether the phone
 * number matched a customer (that stays on the owner side).
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Please check your details." }, { status: 400 });
  }

  // Honeypot filled in: a bot. Look like a success so it learns nothing, and store nothing.
  if (parsed.data.website && parsed.data.website.trim() !== "") return NextResponse.json({ ok: true });

  const result = await createReview({
    name: parsed.data.name.replace(/\s+/g, " "),
    phone: normalizeCellNumber(parsed.data.phone),
    rating: parsed.data.rating,
    comment: parsed.data.comment,
    ipHash: hashIp(clientIp(req)),
    maxPerHour: REVIEW_MAX_PER_HOUR,
    maxPerDay: REVIEW_MAX_PER_DAY,
  });

  if (result === "rate_limited") {
    return NextResponse.json(
      { error: "We've received several reviews from this connection already. Please try again a little later." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }
  return NextResponse.json({ ok: true });
}
