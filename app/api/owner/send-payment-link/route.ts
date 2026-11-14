import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/owner-auth";
import { generatePaymentLink } from "@/lib/db";
import { buildPaymentLinkLink, buildPaymentLinkMessage } from "@/lib/site";

export const runtime = "nodejs";

const schema = z.object({ signupId: z.string().uuid() });

function siteUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return req.nextUrl.origin;
}

/**
 * Issues a fresh 7-day payment link for a booked customer and returns the WhatsApp link to send it with. The link
 * opens /pay/[token], which builds the same recurring PayFast subscription checkout a web signup does (monthly
 * billing, not a single R200 payment) - the owner dashboard's "Send payment link" list calls this.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing signupId" }, { status: 400 });

  const link = await generatePaymentLink(parsed.data.signupId);
  if (!link) return NextResponse.json({ error: "Customer not found or already paid" }, { status: 404 });

  const payUrl = `${siteUrl(req)}/pay/${link.token}`;
  return NextResponse.json({
    whatsappLink: buildPaymentLinkLink(link.fullName, link.whatsappNumber, link.plan, payUrl),
    // The same message as plain text, for the dashboard's copy button.
    message: buildPaymentLinkMessage(link.fullName, link.plan, payUrl),
    expiresAt: link.expiresAt,
  });
}
