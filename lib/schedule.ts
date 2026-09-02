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
