import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/owner-auth";
import { moderateReview } from "@/lib/db";
import { REVIEW_REPLY_MAX } from "@/lib/reviews";

export const runtime = "nodejs";

const schema = z.object({
  reviewId: z.string().uuid(),
  action: z.enum(["approve", "hide", "unhide", "reply"]),
  reply: z.string().trim().max(REVIEW_REPLY_MAX).optional(),
});

/** Approve, Hide, Unhide, or Reply (an empty reply removes it). Nothing here deletes a review. */
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
    return NextResponse.json({ error: `Replies are limited to ${REVIEW_REPLY_MAX} characters.` }, { status: 400 });
  }

  const ok = await moderateReview(parsed.data.reviewId, parsed.data.action, parsed.data.reply);
  if (!ok) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
