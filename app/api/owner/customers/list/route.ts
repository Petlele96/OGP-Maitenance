import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { getAllCustomers } from "@/lib/db";

export const runtime = "nodejs";

/** Full roster for the owner "Customers" tab - search/filter happens client-side. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customers = await getAllCustomers();
  return NextResponse.json({ customers });
}
