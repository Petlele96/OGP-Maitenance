/**
 * Next debit date for a subscriber. All arguments and results are 'YYYY-MM-DD' calendar dates.
 *
 * - PayFast recurring: anchored to the subscription date. Every debit falls on the subscription date's
 *   own day-of-month (the last day of a shorter month), so a subscription started on the 31st is debited on
 *   Feb 28, then Mar 31 - it never drifts.
 * - EFT and cash: the subscription date rolled forward one billing period at a time, each step starting from
 *   the date the last one landed on - so it can drift (Jan 31 -> Feb 28 -> Mar 28), exactly as a reminder
 *   moved on by hand would.
 * - Monthly plans step one month, annual plans twelve. Once-off bookings never recur: no debit.
 *
 * A debit due today counts as the next debit (it is not yet in the past).
 */

function parts(dateKey: string): [number, number, number] {
  const [y, m, d] = dateKey.split("-").map(Number);
  return [y, m, d];
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function format(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `months` after `dateKey`, keeping the day-of-month, or the month's last day if it is shorter. */
export function addMonthsClamped(dateKey: string, months: number): string {
  const [y, m, d] = parts(dateKey);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month1 = (index % 12) + 1;
  return format(year, month1, Math.min(d, daysInMonth(year, month1)));
}

export type BillingPlan = "monthly" | "annual" | "once-off";
export type BillingMethod = "payfast" | "eft" | "cash";

export function billingStepMonths(plan: BillingPlan): number | null {
  if (plan === "monthly") return 1;
  if (plan === "annual") return 12;
  return null;
}

export function nextDebitDate(input: {
  subscribedOn: string;
  plan: BillingPlan;
  method: BillingMethod;
  today: string;
}): string | null {
  const step = billingStepMonths(input.plan);
  if (step === null) return null;
  const { subscribedOn, today } = input;
  if (subscribedOn >= today) return subscribedOn;

  if (input.method === "payfast") {
    // Anchored: always count from the subscription date itself.
    const [sy, sm] = parts(subscribedOn);
    const [ty, tm] = parts(today);
    let k = Math.max(0, Math.floor((ty * 12 + tm - (sy * 12 + sm)) / step));
    while (k > 0 && addMonthsClamped(subscribedOn, (k - 1) * step) >= today) k--;
    while (addMonthsClamped(subscribedOn, k * step) < today) k++;
    return addMonthsClamped(subscribedOn, k * step);
  }

  // EFT / cash: roll forward one period at a time from wherever the last step landed.
  let date = subscribedOn;
  for (let i = 0; i < 5000 && date < today; i++) date = addMonthsClamped(date, step);
  return date;
}
