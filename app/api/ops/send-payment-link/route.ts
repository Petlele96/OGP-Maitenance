import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { generatePaymentLink } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { buildPaymentLinkLink } from "@/lib/site";

export const runtime = "nodejs";

const sendLinkSchema = z.object({ signupId: z.string().uuid() });

function siteUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return req.nextUrl.origin;
}

/** Issues a fresh 7-day payment link for a booked customer and returns the WhatsApp link to send it with. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = sendLinkSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing signupId" }, { status: 400 });

  const link = await generatePaymentLink(parsed.data.signupId);
  if (!link) return NextResponse.json({ error: "Customer not found or already paid" }, { status: 404 });

  const payUrl = `${siteUrl(req)}/pay/${link.token}`;
  const whatsappLink = buildPaymentLinkLink(link.fullName, link.whatsappNumber, PLANS[link.plan].label, payUrl);

  return NextResponse.json({ whatsappLink, expiresAt: link.expiresAt });
}
