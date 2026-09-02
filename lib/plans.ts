export type PlanId = "monthly" | "annual" | "once-off";

export interface Plan {
  id: PlanId;
  label: string;
  amount: number;
  /** True for monthly/annual (a PayFast subscription); false for once-off (a plain payment). */
  recurring: boolean;
  /** PayFast frequency code: 3 = Monthly, 6 = Annual. Only meaningful when recurring. */
  frequency?: 3 | 6;
  itemName: string;
  itemDescription: string;
  priceLine: string;
  badge?: string;
}

export const PLANS: Record<PlanId, Plan> = {
  monthly: {
    id: "monthly",
    label: "Monthly",
    amount: 200.0,
    recurring: true,
    frequency: 3,
    itemName: "OGP Services - Monthly Yard Maintenance",
    itemDescription:
      "Recurring monthly yard maintenance: cutting, weeding, edging, refuse removal, general tidy.",
    priceLine: "R200 / month",
  },
  annual: {
    id: "annual",
    label: "Annual",
    amount: 2000.0,
    recurring: true,
    frequency: 6,
    itemName: "OGP Services - Annual Yard Maintenance",
    itemDescription:
      "Recurring annual yard maintenance: cutting, weeding, edging, refuse removal, general tidy.",
    priceLine: "R2,000 / year",
    badge: "2 months free",
  },
  "once-off": {
    id: "once-off",
    label: "Once-off visit",
    amount: 280.0,
    recurring: false,
    itemName: "OGP Services - Once-off Yard Visit",
    itemDescription: "Single yard visit: cutting, weeding, edging, refuse removal, general tidy.",
    priceLine: "R280 once-off",
  },
};

export function isPlanId(value: string): value is PlanId {
  return value === "monthly" || value === "annual" || value === "once-off";
}

export function isSubscriberPlan(planId: PlanId): boolean {
  return planId === "monthly" || planId === "annual";
}
