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
} from "@/lib/db";
import { nextServiceDate, nowInJohannesburg } from "@/lib/schedule";

export const runtime = "nodejs";

function formatServiceDay(date: Date | null): string {
  if (!date) return "a day we'll confirm on WhatsApp";
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
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
  const unwelcomed = unwelcomedCustomers.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    houseNumber: c.houseNumber,
    whatsappNumber: c.whatsappNumber,
    serviceDayLabel: formatServiceDay(
      nextServiceDate({ service_slot: c.serviceSlot, scheduled_visit_date: c.scheduledVisitDate }, now)
    ),
  }));

  const booked = bookedCustomers.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    houseNumber: c.houseNumber,
    whatsappNumber: c.whatsappNumber,
    serviceDayLabel: formatServiceDay(nextServiceDate({ service_slot: c.serviceSlot, scheduled_visit_date: null }, now)),
    paymentLinkSentAt: c.paymentLinkSentAt,
    paymentLinkExpired:
      c.paymentLinkExpiresAt !== null && new Date(c.paymentLinkExpiresAt).getTime() < Date.now(),
  }));

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
