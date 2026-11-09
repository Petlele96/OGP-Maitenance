import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops-auth";
import { getOpsClientDetail } from "@/lib/db";

export const runtime = "nodejs";

/** One client's page: their details, next service date and visit history. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = z.string().uuid().safeParse(req.nextUrl.searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "Missing client id" }, { status: 400 });

  const detail = await getOpsClientDetail(id.data);
  if (!detail) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return NextResponse.json(detail);
}
