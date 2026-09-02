import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import {
  getActiveCustomerCounts,
  getOnceOffJobsThisMonth,
  getRevenueThisMonth,
  getFailedOrOverdueCustomers,
  getCancellationsThisMonth,
  getCompletionRateThisMonth,
  getLaunchOfferCustomers,
} from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [
    activeCustomers,
    onceOffJobsThisMonth,
    revenueThisMonth,
    failedOrOverdue,
    cancellationsThisMonth,
    completion,
    launchOfferCustomers,
  ] = await Promise.all([
    getActiveCustomerCounts(),
    getOnceOffJobsThisMonth(),
    getRevenueThisMonth(),
    getFailedOrOverdueCustomers(),
    getCancellationsThisMonth(),
    getCompletionRateThisMonth(),
    getLaunchOfferCustomers(),
  ]);

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
    launchOfferCustomers,
  });
}
