import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { getOwnerReviews } from "@/lib/db";

export const runtime = "nodejs";

/** Every review with the submitted phone number matched against the customer list. Owner-only: it includes the phone. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ reviews: await getOwnerReviews() });
}
