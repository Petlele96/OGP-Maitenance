/**
 * Two visits a month per customer, ~14 days apart, on a fixed day-of-month.
 * 14 slots (1-14); slot N means "visited on day N and day N+14" every month.
 * Deliberately caps at day 28 so every month (even February) behaves the same -
 * the last day or few of longer months are always free.
 */
export const SLOT_COUNT = 14;

export function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= SLOT_COUNT;
}

/** The slot that would be serviced on this date, or null if nobody is scheduled (days 29-31). */
export function candidateSlotForDate(date: Date): number | null {
  const day = date.getDate();
  const slot = day <= SLOT_COUNT ? day : day - SLOT_COUNT;
  return isValidSlot(slot) ? slot : null;
}

/** The two days-of-month a given slot is visited on. */
export function visitDaysForSlot(slot: number): [number, number] {
  return [slot, slot + SLOT_COUNT];
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
 * sooner of this month's two visit days that hasn't happened yet, or next month's first
 * one if both have already passed.
 */
export function nextOccurrenceForSlot(slot: number, from: Date): Date {
  const [dayA, dayB] = visitDaysForSlot(slot);
  const year = from.getFullYear();
  const month = from.getMonth();
  const todayDay = from.getDate();

  const upcomingThisMonth = [dayA, dayB].filter((d) => d > todayDay).sort((a, b) => a - b);
  if (upcomingThisMonth.length > 0) return new Date(year, month, upcomingThisMonth[0]);
  return new Date(year, month + 1, dayA);
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
