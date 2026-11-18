import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { IssueReportRow } from "./db";
import {
  ISSUE_GROUPS,
  findIssueType,
  formatCoords,
  formatIssueDate,
  gpsAccuracy,
  issueDaysOpen,
  issueLocationDisplay,
  issuePhaseLabel,
  issueReportWording,
  mapsUrl,
  monthBounds,
  monthLabel,
} from "./issues";
import { COMPANY_NAME } from "./site";

/**
 * The monthly maintenance report: OGP branded, issues grouped by category, each with its photo, a one-line
 * description, location, phase, date logged, days open and status. Neutral wording throughout - "still open",
 * never anything that reads as blaming anyone. Built on demand and handed back for download - never sent.
 */

const NAVY = rgb(0.071, 0.231, 0.427); // #123B6D
const SKY = rgb(0.106, 0.553, 0.82); // #1B8DD1
const ORANGE = rgb(0.941, 0.478, 0.133); // #F07A22
const INK = rgb(0.13, 0.15, 0.18);
const GREY = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.85, 0.88, 0.92);
const PANEL = rgb(0.945, 0.965, 0.985);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 56;
const CARD_H = 112; // the smallest a card gets
const GPS_ROW_H = 14; // added when the issue has a GPS fix
const LINE_H = 11; // added when the location needs a second line
const PHOTO_W = 118;
const PHOTO_H = 96;
const TEXT_X = MARGIN + 8 + PHOTO_W + 14;
const TEXT_W = CONTENT_W - (TEXT_X - MARGIN) - 10;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The standard PDF fonts only cover Western characters; anything else (emoji, say) becomes "?" instead of failing. */
function safe(text: string, font: PDFFont): string {
  return Array.from(text.replace(/\s+/g, " "))
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return "?";
      }
    })
    .join("");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const words = safe(text, font).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && font.widthOfTextAtSize(`${last}...`, size) > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}...`;
  }
  return lines;
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const t = safe(text, font);
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  let cut = t;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

export interface IssueReportInput {
  month: string; // YYYY-MM
  issues: IssueReportRow[];
  generatedAt: Date;
  /** The logo as PNG bytes. The header is drawn without it when this is null. */
  logo: Uint8Array | null;
}

export async function buildIssueReportPdf({ month, issues, generatedAt, logo }: IssueReportInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`OGP Services maintenance report - ${monthLabel(month)}`);
  pdf.setAuthor(COMPANY_NAME);
  pdf.setCreator("OGP Services");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logoImg: PDFImage | null = null;
  if (logo) {
    try {
      logoImg = await pdf.embedPng(logo);
    } catch {
      logoImg = null; // a broken logo never stops the report
    }
  }

  const label = monthLabel(month);
  const { from, to } = monthBounds(month);
  const asAt = formatIssueDate(generatedAt.toISOString());

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function text(p: PDFPage, t: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) {
    p.drawText(safe(t, f), { x, y: yy, size, font: f, color });
  }

  // ---- first-page header
  if (logoImg) page.drawImage(logoImg, { x: MARGIN - 8, y: y - 78, width: 86, height: 86 });
  const headX = MARGIN + (logoImg ? 84 : 0);
  text(page, "Maintenance report", headX, y - 28, 24, bold, NAVY);
  text(page, label, headX, y - 50, 15, bold, SKY);
  text(page, COMPANY_NAME, headX, y - 68, 9, font, GREY);
  y -= 88;
  page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: 3, color: NAVY });
  page.drawRectangle({ x: MARGIN, y, width: 90, height: 3, color: ORANGE });
  y -= 22;

  // ---- summary
  const resolved = issues.filter((i) => i.status === "resolved").length;
  const stillOpen = issues.length - resolved;
  const gap = 12;
  const boxW = (CONTENT_W - gap * 2) / 3;
  [
    ["Issues logged", issues.length],
    ["Still open", stillOpen],
    ["Resolved", resolved],
  ].forEach(([name, value], idx) => {
    const x = MARGIN + idx * (boxW + gap);
    page.drawRectangle({ x, y: y - 56, width: boxW, height: 56, color: PANEL });
    page.drawRectangle({ x, y: y - 56, width: 3, height: 56, color: idx === 2 ? SKY : idx === 1 ? ORANGE : NAVY });
    text(page, String(value), x + 14, y - 34, 26, bold, NAVY);
    text(page, String(name), x + 14, y - 49, 9, font, GREY);
  });
  y -= 56 + 12;
  const range = `${formatIssueDate(`${from}T12:00:00+02:00`)} to ${formatIssueDate(`${to}T12:00:00+02:00`)}`;
  text(page, `Issues logged ${range}. Status and days open are as at ${asAt}.`, MARGIN, y - 8, 8.5, font, GREY);
  y -= 30;

  if (issues.length === 0) {
    text(page, `No maintenance issues were logged in ${label}.`, MARGIN, y - 10, 11, font, INK);
  }

  // ---- issues, grouped by category
  function newPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    text(page, `OGP Services  |  Maintenance report  |  ${label}`, MARGIN, y - 4, 8.5, font, GREY);
    page.drawRectangle({ x: MARGIN, y: y - 12, width: CONTENT_W, height: 1, color: LINE });
    y -= 30;
  }

  /** The place as printed: the house or place plus the worker's own words, over at most two lines. */
  function locationLines(issue: IssueReportRow): string[] {
    const off = font.widthOfTextAtSize("Location ", 8) + 3;
    return wrap(issueLocationDisplay(issue.locationLabel, issue.locationDetail), bold, 9, TEXT_W - off, 2);
  }
  function hasGps(issue: IssueReportRow): boolean {
    return issue.gpsLat !== null && issue.gpsLng !== null;
  }
  function cardHeight(issue: IssueReportRow): number {
    return CARD_H + (locationLines(issue).length > 1 ? LINE_H : 0) + (hasGps(issue) ? GPS_ROW_H : 0);
  }

  for (const group of ISSUE_GROUPS) {
    const inGroup = issues.filter((i) => i.category === group.key);
    if (inGroup.length === 0) continue;

    if (y - 30 - (CARD_H + GPS_ROW_H + LINE_H) < BOTTOM) newPage();
    page.drawRectangle({ x: MARGIN, y: y - 22, width: CONTENT_W, height: 22, color: PANEL });
    page.drawRectangle({ x: MARGIN, y: y - 22, width: 4, height: 22, color: ORANGE });
    text(page, group.label, MARGIN + 14, y - 15, 12, bold, NAVY);
    const count = plural(inGroup.length, "issue");
    text(page, count, MARGIN + CONTENT_W - 10 - font.widthOfTextAtSize(count, 9), y - 15, 9, font, GREY);
    y -= 22 + 10;

    for (const issue of inGroup) {
      const h = cardHeight(issue);
      if (y - h < BOTTOM) newPage();
      await drawCard(issue, y, h);
      y -= h + 10;
    }
    y -= 6;
  }

  async function drawCard(issue: IssueReportRow, top: number, height: number) {
    page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT_W, height, borderColor: LINE, borderWidth: 1 });

    // photo, fitted inside its box
    const px = MARGIN + 8;
    const py = top - 8 - PHOTO_H;
    page.drawRectangle({ x: px, y: py, width: PHOTO_W, height: PHOTO_H, color: PANEL });
    let drewPhoto = false;
    if (issue.thumb) {
      try {
        const img = await pdf.embedJpg(issue.thumb);
        const scale = Math.min(PHOTO_W / img.width, PHOTO_H / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: px + (PHOTO_W - w) / 2, y: py + (PHOTO_H - h) / 2, width: w, height: h });
        drewPhoto = true;
      } catch {
        drewPhoto = false;
      }
    }
    if (!drewPhoto) text(page, "Photo unavailable", px + 22, py + PHOTO_H / 2 - 3, 8, font, GREY);

    const tx = TEXT_X;
    const tw = TEXT_W;
    const def = findIssueType(issue.issueType);
    const typeLabel = def?.type.label ?? issue.issueType;

    // With no AI line or owner wording the description is just the issue type - don't print it twice.
    const description = issueReportWording({
      reportDescription: issue.reportDescription,
      aiDescription: issue.aiDescription,
      issueType: issue.issueType,
      note: issue.note,
      typeLabel,
    });
    const showTypeLine = description.trim().toLowerCase() !== typeLabel.toLowerCase();
    if (showTypeLine) text(page, typeLabel.toUpperCase(), tx, top - 17, 8, bold, SKY);
    const desc = wrap(description, bold, 10.5, tw, 3);
    desc.forEach((line, n) => text(page, line, tx, top - (showTypeLine ? 32 : 22) - n * 13, 10.5, bold, INK));

    const daysOpen = issueDaysOpen(issue.loggedAt, issue.resolvedAt, generatedAt);
    const status =
      issue.status === "resolved" && issue.resolvedAt
        ? `Resolved on ${formatIssueDate(issue.resolvedAt)}`
        : issue.status === "reported" && issue.reportedAt
          ? `Reported on ${formatIssueDate(issue.reportedAt)}, still open`
          : "Still open";
    const detail = (name: string, value: string, x: number, yy: number, maxW: number) => {
      text(page, name, x, yy, 8, font, GREY);
      const off = font.widthOfTextAtSize(`${name} `, 8) + 3;
      text(page, fit(value, bold, 9, maxW - off), x + off, yy, 9, bold, INK);
    };

    // Location: the house or place plus the worker's own words. This is what a reader falls back on with no GPS.
    const locLines = locationLines(issue);
    const locOff = font.widthOfTextAtSize("Location ", 8) + 3;
    text(page, "Location", tx, top - 74, 8, font, GREY);
    locLines.forEach((line, n) => text(page, line, tx + locOff, top - 74 - n * LINE_H, 9, bold, INK));
    const shift = (locLines.length - 1) * LINE_H;

    const colW = tw / 3;
    detail("Phase", issuePhaseLabel(issue.phase), tx, top - 88 - shift, colW - 6);
    detail("Logged", formatIssueDate(issue.loggedAt), tx + colW, top - 88 - shift, colW - 6);
    detail("Days open", String(daysOpen), tx + colW * 2, top - 88 - shift, colW);
    detail("Status", status, tx, top - 102 - shift, tw);

    // GPS: the coordinates as text (they survive printing) and a link that opens the spot in Google Maps.
    if (issue.gpsLat !== null && issue.gpsLng !== null) {
      const yy = top - 116 - shift;
      const linkText = "Open in Google Maps";
      const linkW = bold.widthOfTextAtSize(linkText, 8.5);
      const off = font.widthOfTextAtSize("GPS ", 8) + 3;
      const coords = `${formatCoords(issue.gpsLat, issue.gpsLng)} (${gpsAccuracy(issue.gpsAccuracyM).label})`;
      text(page, "GPS", tx, yy, 8, font, GREY);
      const shown = fit(coords, bold, 9, tw - off - linkW - 12);
      text(page, shown, tx + off, yy, 9, bold, INK);
      const lx = tx + off + bold.widthOfTextAtSize(shown, 9) + 10;
      text(page, linkText, lx, yy, 8.5, bold, SKY);
      page.drawRectangle({ x: lx, y: yy - 1.5, width: linkW, height: 0.6, color: SKY });
      const link = pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [lx, yy - 3, lx + linkW, yy + 10],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(mapsUrl(issue.gpsLat, issue.gpsLng)) },
      });
      page.node.addAnnot(pdf.context.register(link));
    }
  }

  // ---- footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, idx) => {
    p.drawRectangle({ x: MARGIN, y: 40, width: CONTENT_W, height: 1, color: LINE });
    text(p, `${COMPANY_NAME}  |  Maintenance report, ${label}`, MARGIN, 26, 8, font, GREY);
    const num = `Page ${idx + 1} of ${pages.length}`;
    text(p, num, MARGIN + CONTENT_W - font.widthOfTextAtSize(num, 8), 26, 8, font, GREY);
  });

  return pdf.save();
}
