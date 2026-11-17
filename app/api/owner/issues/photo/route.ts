import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/owner-auth";
import { getIssuePhoto } from "@/lib/db";

export const runtime = "nodejs";

const schema = z.object({ id: z.string().uuid(), size: z.enum(["full", "thumb"]).default("thumb") });

/** Owner-only photo. Issue photos are private: there is no public address for them. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse({
    id: req.nextUrl.searchParams.get("id"),
    size: req.nextUrl.searchParams.get("size") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const photo = await getIssuePhoto(parsed.data.id, parsed.data.size);
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(photo), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" },
  });
}
