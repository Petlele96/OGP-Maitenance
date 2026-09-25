import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops-auth";
import { getBookedCustomers } from "@/lib/db";
import { nextServiceDate, nowInJohannesburg } from "@/lib/schedule";
import { groupByBlock } from "@/lib/sort";

export const runtime = "nodejs";

function formatServiceDay(date: Date | null): string {
  if (!date) return "a day we'll confirm on WhatsApp";
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const booked = await getBookedCustomers();
  const now = nowInJohannesburg();

  const customers = booked.map((c) => {
    const isExpired = c.paymentLinkExpiresAt !== null && new Date(c.paymentLinkExpiresAt).getTime() < Date.now();
    return {
      id: c.id,
      fullName: c.fullName,
      houseNumber: c.houseNumber,
      whatsappNumber: c.whatsappNumber,
      plan: c.plan,
      block: c.block,
      serviceDayLabel: formatServiceDay(
        nextServiceDate({ service_slot: c.serviceSlot, scheduled_visit_date: c.scheduledVisitDate }, now)
      ),
      paymentLinkSentAt: c.paymentLinkSentAt,
      paymentLinkExpired: c.paymentLinkSentAt !== null && isExpired,
    };
  });

  return NextResponse.json({
    total: customers.length,
    groups: groupByBlock(customers),
  });
}
