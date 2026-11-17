import { z } from "zod";
import { daysBetween } from "./payments";
import { MIN_PHASE, MAX_PHASE } from "./sort";

/**
 * Maintenance issues: things the crew notice in the estate (at a subscriber's property or anywhere else) that are
 * not the yard service itself. Pure helpers shared by the ops form, the owner panel, the AI step and the PDF.
 * Nothing here talks to the database or sends anything.
 */

export interface IssueTypeDef {
  key: string;
  label: string;
}
export interface IssueGroupDef {
  key: string;
  label: string;
  types: IssueTypeDef[];
}

/** The picker is grouped; the group is the "category" used for filters and for the PDF sections. */
export const ISSUE_GROUPS: IssueGroupDef[] = [
  {
    key: "water",
    label: "Water",
    types: [
      { key: "leaking_tap", label: "Leaking tap or standpipe" },
      { key: "burst_pipe", label: "Burst or leaking pipe" },
      { key: "water_running", label: "Water running unattended" },
      { key: "blocked_drain", label: "Blocked or overflowing drain" },
      { key: "missing_drain_cover", label: "Missing drain cover" },
    ],
  },
  {
    key: "electrical",
    label: "Electrical",
    types: [
      { key: "exposed_wiring", label: "Exposed wiring" },
      { key: "dead_street_light", label: "Dead street light" },
      { key: "meter_box", label: "Damaged or open meter box" },
    ],
  },
  {
    key: "structural",
    label: "Structural",
    types: [
      { key: "damaged_wall_fence", label: "Damaged wall or fence" },
      { key: "broken_paving", label: "Broken paving" },
      { key: "pothole", label: "Pothole" },
      { key: "missing_manhole_cover", label: "Missing manhole cover" },
      { key: "blocked_stormwater", label: "Blocked stormwater channel" },
    ],
  },
  {
    key: "grounds_safety",
    label: "Grounds and safety",
    types: [
      { key: "dangerous_tree", label: "Dangerous or fallen tree" },
      { key: "branches_power_lines", label: "Branches on power lines" },
      { key: "overgrowth", label: "Overgrowth blocking a light or a corner" },
      { key: "illegal_dumping", label: "New illegal dumping" },
      { key: "broken_gate", label: "Broken gate" },
    ],
  },
  {
    // For anything the list above misses. The note is required so it says what it is. If this gets used a lot,
    // the list is missing something real (the owner panel points that out).
    key: "other",
    label: "Other",
    types: [{ key: "other", label: "Other (see note)" }],
  },
];

export const OTHER_ISSUE_TYPE = "other";

export function findIssueType(typeKey: string): { group: IssueGroupDef; type: IssueTypeDef } | null {
  for (const group of ISSUE_GROUPS) {
    const type = group.types.find((t) => t.key === typeKey);
    if (type) return { group, type };
  }
  return null;
}

export function issueGroupLabel(groupKey: string): string {
  return ISSUE_GROUPS.find((g) => g.key === groupKey)?.label ?? groupKey;
}

export const ISSUE_STATUSES = ["open", "reported", "resolved"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  reported: "Reported to client",
  resolved: "Resolved",
};

/** An issue open for more than this many days is highlighted. */
export const OVERDUE_ISSUE_DAYS = 30;

/** Limits shared by the client (before it sends) and the server (before it saves). */
export const ISSUE_NOTE_MAX = 500;
export const ISSUE_LOCATION_MAX = 120;
export const ISSUE_DESCRIPTION_MAX = 200;
export const ISSUE_PHOTO_MAX_BYTES = 3_500_000;
export const ISSUE_THUMB_MAX_BYTES = 300_000;

/** Calendar date (Johannesburg) of an instant, as YYYY-MM-DD. */
export function johannesburgDateKey(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

/**
 * Calendar days an issue has been open: logged date to resolved date, or to today while it is unresolved.
 * Logged today is day 0.
 */
export function issueDaysOpen(loggedAt: string, resolvedAt: string | null, now: Date = new Date()): number {
  const end = resolvedAt ?? now.toISOString();
  return Math.max(0, daysBetween(johannesburgDateKey(loggedAt), johannesburgDateKey(end)));
}

export function isIssueOverdue(status: IssueStatus, daysOpen: number): boolean {
  return status !== "resolved" && daysOpen > OVERDUE_ISSUE_DAYS;
}

/** What the report and the dashboard call the issue: the owner's wording, else the AI's, else just the issue type. */
export function issueDescription(i: {
  reportDescription: string | null;
  aiDescription: string | null;
  typeLabel: string;
}): string {
  return i.reportDescription?.trim() || i.aiDescription?.trim() || i.typeLabel;
}

/** True when neither the AI nor the owner has written a line for the report - the report is then using a fallback. */
export function issueNeedsWording(i: { reportDescription: string | null; aiDescription: string | null }): boolean {
  return !i.reportDescription?.trim() && !i.aiDescription?.trim();
}

/**
 * The line printed in the monthly report: the owner's wording, else the AI's, else - for "Other", where the type
 * says nothing - the worker's own note, else the issue type. The fallbacks are a safety net, not the normal path.
 */
export function issueReportWording(i: {
  reportDescription: string | null;
  aiDescription: string | null;
  issueType: string;
  note: string | null;
  typeLabel: string;
}): string {
  const written = i.reportDescription?.trim() || i.aiDescription?.trim();
  if (written) return written;
  if (i.issueType === OTHER_ISSUE_TYPE && i.note?.trim()) return i.note.trim();
  return i.typeLabel;
}

/** "Phase 3" - or nothing when the issue has no phase (a customer who has none set). */
export function issuePhaseLabel(phase: number | null): string {
  return phase === null ? "Phase not set" : `Phase ${phase}`;
}

export function formatIssueDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * A ready message about an urgent issue, for the owner to copy and send (or not) to whoever it concerns. It is only
 * ever copied to the clipboard - nothing sends it. Neutral wording, no names, no worker.
 */
export function buildUrgentIssueMessage(i: {
  groupLabel: string;
  typeLabel: string;
  locationLabel: string;
  phase: number | null;
  description: string;
  loggedAt: string;
}): string {
  const where = i.phase === null ? i.locationLabel : `${i.locationLabel}, Phase ${i.phase}`;
  return [
    "Urgent maintenance issue - OGP Services",
    `Issue: ${i.groupLabel} - ${i.typeLabel}`,
    `Location: ${where}`,
    `Seen on: ${formatIssueDate(i.loggedAt)}`,
    `Details: ${i.description}`,
    "A photo is available - please let us know if you would like it sent.",
  ].join("\n");
}

/** A month the PDF can be made for, "YYYY-MM". */
export const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-ZA", { timeZone: "UTC", month: "long", year: "numeric" });
}

/** First and last calendar day (YYYY-MM-DD) of a "YYYY-MM" month. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation of what the ops form sends

const typeKeys = ISSUE_GROUPS.flatMap((g) => g.types.map((t) => t.key));

/**
 * The form is sent as multipart (a photo is part of it), so every field arrives as a string. Either an existing
 * customer, or a free-text place plus a phase.
 */
export const createIssueSchema = z
  .object({
    issueType: z.string().refine((v) => typeKeys.includes(v), "Choose what the issue is"),
    urgent: z.enum(["yes", "no"], { errorMap: () => ({ message: "Say whether someone should come today" }) }),
    signupId: z.string().uuid().optional(),
    locationText: z.string().trim().max(ISSUE_LOCATION_MAX, "Keep the place short").optional(),
    phase: z
      .string()
      .regex(/^\d$/, "Choose a phase")
      .transform(Number)
      .refine((n) => n >= MIN_PHASE && n <= MAX_PHASE, "Choose a phase")
      .optional(),
    note: z.string().trim().max(ISSUE_NOTE_MAX, "Keep the note short").optional(),
    workerId: z.string().uuid("Choose who is logging this"),
  })
  .superRefine((v, ctx) => {
    if (v.issueType === OTHER_ISSUE_TYPE && !v.note) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Say what the issue is in the note" });
    }
    if (!v.signupId && !v.locationText) {
      ctx.addIssue({ code: "custom", path: ["locationText"], message: "Choose a customer, or say where it is" });
    }
    if (!v.signupId && v.phase === undefined) {
      ctx.addIssue({ code: "custom", path: ["phase"], message: "Choose a phase" });
    }
  });

export type CreateIssueInput = z.infer<typeof createIssueSchema>;

/** Every issue file the server accepts is a JPEG (the form shrinks and converts the photo before sending). */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export const updateIssueSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), id: z.string().uuid(), status: z.enum(ISSUE_STATUSES) }),
  z.object({ action: z.literal("urgent"), id: z.string().uuid(), urgent: z.boolean() }),
  z.object({ action: z.literal("dismiss_flag"), id: z.string().uuid() }),
  z.object({
    action: z.literal("description"),
    id: z.string().uuid(),
    description: z.string().trim().max(ISSUE_DESCRIPTION_MAX, "Keep it to one short line"),
  }),
]);
