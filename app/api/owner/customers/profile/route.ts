import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { getCustomerDetail, getCustomerHistory, getPaymentHistory } from "@/lib/db";

export const runtime = "nodejs";

/** ?id=... - everything the owner Customer Profile panel needs, in one call. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const customer = await getCustomerDetail(id);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const [history, payments] = await Promise.all([getCustomerHistory(id), getPaymentHistory(id)]);
  return NextResponse.json({ customer, history, payments });
}
