/**
 * When a pay-after customer's payment falls due. Pure date arithmetic on "YYYY-MM-DD" keys - nothing here touches
 * PayFast. The activation link is sent on the due date, so their recurring billing lands on that date from then on
 * without anything being configured on the PayFast side.
 */

export type PayAfterWhen = "service_day" | "month_end";

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function key(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The payday in the given month - or the month's last day when it is shorter (payday 31 in February). */
export function paydayInMonth(year: number, month1: number, payday: number): string {
  return key(year, month1, Math.min(payday, daysInMonth(year, month1)));
}

/**
 * "At month-end, when I get paid": the first payday on or after the given date - that month's payday if it has not
 * passed yet, otherwise next month's. Worked out from the first service date, so the customer is never asked for
 * money before the work is done, and it moves for everyone the moment the owner changes the payday setting.
 */
export function monthEndDueDate(onOrAfter: string, payday: number): string {
  const year = Number(onOrAfter.slice(0, 4));
  const month1 = Number(onOrAfter.slice(5, 7));
  const thisMonth = paydayInMonth(year, month1, payday);
  if (thisMonth >= onOrAfter) return thisMonth;
  return month1 === 12 ? paydayInMonth(year + 1, 1, payday) : paydayInMonth(year, month1 + 1, payday);
}

/**
 * The due date, or null while it cannot be known yet. Both choices hang off the first service date - the date their
 * first service is assigned, which becomes the day it was actually recorded - so nobody is asked for money before the
 * work, and a customer with no service day yet has no due date.
 *  - service_day (also the default when nothing was chosen): the first service date itself.
 *  - month_end: the first payday on or after the first service date.
 */
export function paymentDueDate(input: {
  when: PayAfterWhen | null;
  payday: number;
  /** First recorded visit if there is one, otherwise the service date currently assigned. */
  firstServiceDate: string | null;
}): string | null {
  if (input.firstServiceDate === null) return null;
  if (input.when === "month_end") return monthEndDueDate(input.firstServiceDate, input.payday);
  return input.firstServiceDate;
}

export type DueStatus = "overdue" | "today" | "later";

export function dueStatus(dueDate: string, today: string): DueStatus {
  if (dueDate < today) return "overdue";
  return dueDate === today ? "today" : "later";
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
