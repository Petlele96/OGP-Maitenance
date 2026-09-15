/**
 * Two visits a month per customer, ~14 days apart, on a fixed day-of-month, September
 * through April. May through August (winter - grass grows slowly), that drops to one
 * visit, on the slot's first day only.
 * 14 slots (1-14); slot N means "visited on day N and day N+14" every summer month, or
 * "day N only" every winter month. Deliberately caps at day 28 so every month (even
 * February) behaves the same - the last day or few of longer months are always free.
 */
export const SLOT_COUNT = 14;

/**
 * "Now", but with getDate()/getMonth()/getDay()/getFullYear() always reading as
 * Johannesburg wall-clock time, regardless of what timezone the Node process actually
 * runs in - Vercel's runtime defaults to UTC and `TZ` is a reserved env var name Vercel
 * won't let us set, so every "what day is it" call in this app goes through this instead
 * of a bare `new Date()`. Uses Intl's real IANA timezone data (not a hardcoded +2), so it
 * would stay correct even if South Africa ever adopted DST.
 *
 * The returned Date is NOT a real instant - its epoch/UTC value is meaningless. Only its
 * local-time getters are valid to read (which is all this app's scheduling code ever
 * does with "today").
 */
export function nowInJohannesburg(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** May (4) through August (7), 0-indexed - the once-a-month season. */
export function isWinterMonth(monthIndex0: number): boolean {
  return monthIndex0 >= 4 && monthIndex0 <= 7;
}

export function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= SLOT_COUNT;
}

/** The slot that would be serviced on this date, or null if nobody is scheduled. */
export function candidateSlotForDate(date: Date): number | null {
  const day = date.getDate();
  if (day <= SLOT_COUNT) return isValidSlot(day) ? day : null;
  // day 15-28 is a slot's *second* visit of the month - which only exists Sep-Apr.
  if (isWinterMonth(date.getMonth())) return null;
  const slot = day - SLOT_COUNT;
  return isValidSlot(slot) ? slot : null;
}

/** The day(s)-of-month `slot` is visited on, for the month `date` falls in - one day in winter, two otherwise. */
export function visitDaysForSlotInMonth(slot: number, date: Date): number[] {
  return isWinterMonth(date.getMonth()) ? [slot] : [slot, slot + SLOT_COUNT];
}

/** Minimum notice OGP commits to before a customer's first visit. */
export const MIN_NOTICE_WORKING_DAYS = 3;

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** Adds `n` working days (Mon-Fri) to `date` - weekends don't count toward `n`. */
export function addWorkingDays(date: Date, n: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < n) {
    result.setDate(result.getDate() + 1);
    if (!isWeekend(result)) added++;
  }
  return result;
}

/** The next working day strictly after `date` (tomorrow, or Monday if that's a weekend). */
export function nextWorkingDay(date: Date): Date {
  return addWorkingDays(date, 1);
}

/**
 * The next calendar date (strictly after `from`) that `slot` is visited on - i.e. the
 * soonest of this month's visit day(s) that hasn't happened yet (one in winter, two
 * otherwise), or next month's first one if all of this month's have already passed.
 */
export function nextOccurrenceForSlot(slot: number, from: Date): Date {
  const year = from.getFullYear();
  const month = from.getMonth();
  const todayDay = from.getDate();

  const upcomingThisMonth = visitDaysForSlotInMonth(slot, from)
    .filter((d) => d > todayDay)
    .sort((a, b) => a - b);
  if (upcomingThisMonth.length > 0) return new Date(year, month, upcomingThisMonth[0]);
  // Next month's first visit day is always `slot` itself, regardless of season.
  return new Date(year, month + 1, slot);
}

/**
 * Slots (1-14) whose next occurrence from `from` still gives at least
 * MIN_NOTICE_WORKING_DAYS of notice - the pool a new signup is allowed to be assigned
 * from, so nobody's first visit lands sooner than that (and in particular never on
 * today's or tomorrow's list). Compared as date keys, not raw timestamps, so `from`'s
 * time-of-day never causes an off-by-one against the midnight-normalised slot dates.
 */
export function eligibleSlotsForNewSignup(from: Date): number[] {
  const minDateKey = toDateKey(addWorkingDays(from, MIN_NOTICE_WORKING_DAYS));
  const allSlots = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1);
  return allSlots.filter((slot) => toDateKey(nextOccurrenceForSlot(slot, from)) >= minDateKey);
}

/**
 * The next calendar date a signup will be visited, from whichever schedule field applies
 * (service_slot for subscribers, scheduled_visit_date for once-off) - or null if neither
 * is set yet (e.g. a once-off signup that hasn't been activated by the ITN handler).
 */
export function nextServiceDate(
  signup: { service_slot: number | null; scheduled_visit_date: string | null },
  from: Date
): Date | null {
  if (signup.service_slot !== null) return nextOccurrenceForSlot(signup.service_slot, from);
  if (signup.scheduled_visit_date !== null) return new Date(`${signup.scheduled_visit_date}T00:00:00`);
  return null;
}

export const SKIP_REASONS = ["rain", "gate_locked", "dogs_loose", "customer_requested", "other"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The 7 calendar dates (Monday-Sunday) of the week containing `date`. */
export function getWeekDates(date: Date): Date[] {
  const dayOfWeek = date.getDay(); // 0 = Sunday
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() + diffToMonday);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}
