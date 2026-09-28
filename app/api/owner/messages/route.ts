import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { getMessageCentreList } from "@/lib/db";

export const runtime = "nodejs";

/** Message centre - every customer with a WhatsApp button and their last-contacted date. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customers = await getMessageCentreList();
  return NextResponse.json({ customers });
}
