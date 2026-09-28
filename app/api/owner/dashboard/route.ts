import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import {
  getActiveCustomerCounts,
  getOnceOffJobsThisMonth,
  getRevenueThisMonth,
  getFailedOrOverdueCustomers,
  getCancellationsThisMonth,
  getCompletionRateThisMonth,
  getUnwelcomedCustomers,
  getSkippedVisitsThisMonth,
  getBookedCustomers,
  getEffectiveNextServiceDate,
} from "@/lib/db";
import { nowInJohannesburg } from "@/lib/schedule";

export const runtime = "nodejs";

function formatServiceDay(date: Date | null): string {
  if (!date) return "a day we'll confirm on WhatsApp";
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

function siteUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [
    activeCustomers,
    onceOffJobsThisMonth,
    revenueThisMonth,
    failedOrOverdue,
    cancellationsThisMonth,
    completion,
    unwelcomedCustomers,
    skippedVisits,
    bookedCustomers,
  ] = await Promise.all([
    getActiveCustomerCounts(),
    getOnceOffJobsThisMonth(),
    getRevenueThisMonth(),
    getFailedOrOverdueCustomers(),
    getCancellationsThisMonth(),
    getCompletionRateThisMonth(),
    getUnwelcomedCustomers(),
    getSkippedVisitsThisMonth(),
    getBookedCustomers(),
  ]);

  const now = nowInJohannesburg();
  const base = siteUrl(req);
  const unwelcomed = await Promise.all(
    unwelcomedCustomers.map(async (c) => ({
      id: c.id,
      fullName: c.fullName,
      houseNumber: c.houseNumber,
      whatsappNumber: c.whatsappNumber,
      serviceDayLabel: formatServiceDay(
        await getEffectiveNextServiceDate(c.id, { service_slot: c.serviceSlot, scheduled_visit_date: c.scheduledVisitDate }, now)
      ),
      trackingUrl: `${base}/track/${c.trackingToken}`,
    }))
  );

  const booked = await Promise.all(
    bookedCustomers.map(async (c) => ({
      id: c.id,
      fullName: c.fullName,
      houseNumber: c.houseNumber,
      whatsappNumber: c.whatsappNumber,
      serviceDayLabel: formatServiceDay(
        await getEffectiveNextServiceDate(c.id, { service_slot: c.serviceSlot, scheduled_visit_date: c.scheduledVisitDate }, now)
      ),
      paymentLinkSentAt: c.paymentLinkSentAt,
      paymentLinkExpired:
        c.paymentLinkExpiresAt !== null && new Date(c.paymentLinkExpiresAt).getTime() < Date.now(),
    }))
  );

  return NextResponse.json({
    activeCustomers: {
      total: activeCustomers.monthly + activeCustomers.annual,
      monthly: activeCustomers.monthly,
      annual: activeCustomers.annual,
    },
    onceOffJobsThisMonth,
    revenueThisMonth,
    failedOrOverdue,
    cancellationsThisMonth,
    completion,
    unwelcomedCustomers: unwelcomed,
    skippedVisits,
    bookedCount: bookedCustomers.length,
    bookedCustomers: booked,
  });
}
