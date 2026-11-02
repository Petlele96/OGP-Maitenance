import { NextResponse } from "next/server";
import { getPublicReviews } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public. Approved, un-hidden reviews only, newest first - first name and block, never a surname or
 * house number. Briefly cached so a busy homepage doesn't hit the database on every view, which also
 * bounds how long a hidden review can linger.
 */
export async function GET() {
  try {
    const reviews = await getPublicReviews();
    return NextResponse.json(
      { reviews },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } }
    );
  } catch {
    // The homepage treats "no reviews" as render-nothing, so a failure here must never break it.
    return NextResponse.json({ reviews: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
