export type PlanId = "monthly" | "annual";

export interface Plan {
  id: PlanId;
  label: string;
  amount: number;
  /** PayFast frequency code: 3 = Monthly, 6 = Annual */
  frequency: 3 | 6;
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
    frequency: 6,
    itemName: "OGP Services - Annual Yard Maintenance",
    itemDescription:
      "Recurring annual yard maintenance: cutting, weeding, edging, refuse removal, general tidy.",
    priceLine: "R2,000 / year",
    badge: "2 months free",
  },
};

export function isPlanId(value: string): value is PlanId {
  return value === "monthly" || value === "annual";
}
