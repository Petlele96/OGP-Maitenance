import { NextResponse } from "next/server";
import { getLaunchOfferSpotsLeft } from "@/lib/db";
import { LAUNCH_OFFER_SPOTS } from "@/lib/site";

export const runtime = "nodejs";
// Otherwise Next.js statically renders this at build time (no cookies/params to force
// dynamic rendering automatically) and bakes in a stale count forever.
export const dynamic = "force-dynamic";

/** Public, unauthenticated - just a live count for the signup page. */
export async function GET() {
  const spotsLeft = await getLaunchOfferSpotsLeft();
  return NextResponse.json({ spotsLeft, totalSpots: LAUNCH_OFFER_SPOTS });
}
