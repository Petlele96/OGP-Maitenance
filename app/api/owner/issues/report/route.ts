import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/owner-auth";
import { getIssuesForMonth, listIssues } from "@/lib/db";
import { buildIssueReportPdf } from "@/lib/issue-report";
import { johannesburgDateKey, issueNeedsWording, MONTH_REGEX, monthBounds } from "@/lib/issues";

export const runtime = "nodejs";
export const maxDuration = 60;

async function fetchLogo(origin: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${origin}/logo.png`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** The monthly PDF for ?month=YYYY-MM. Made on request and returned for download - it is never sent anywhere. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH_REGEX.test(month)) return NextResponse.json({ error: "Choose a month" }, { status: 400 });

  // ?check=1: which issues in the month have neither AI wording nor wording the owner wrote. No PDF is made.
  if (req.nextUrl.searchParams.get("check") === "1") {
    const { from, to } = monthBounds(month);
    const inMonth = (await listIssues())
      .filter((i) => {
        const day = johannesburgDateKey(i.loggedAt);
        return day >= from && day <= to;
      })
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
    return NextResponse.json({
      total: inMonth.length,
      missingIds: inMonth.filter(issueNeedsWording).map((i) => i.id),
    });
  }

  const [issues, logo] = await Promise.all([getIssuesForMonth(month), fetchLogo(req.nextUrl.origin)]);
  const pdf = await buildIssueReportPdf({ month, issues, generatedAt: new Date(), logo });
  // Sent as a stream in chunks: a month with many photos can pass the size limit on a single buffered response.
  const CHUNK = 64 * 1024;
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= pdf.length) return controller.close();
      controller.enqueue(pdf.subarray(offset, offset + CHUNK));
      offset += CHUNK;
    },
  });
  return new NextResponse(body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="OGP-maintenance-report-${month}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
