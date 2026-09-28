import type { PlanId } from "@/lib/plans";
import type { SkipOrMoveReason } from "@/lib/schedule";
import { MIN_BLOCK, MAX_BLOCK } from "@/lib/sort";

export type PaymentMethod = "payfast" | "eft" | "cash";
export type PaymentStatus = "booked" | "pending" | "active" | "failed" | "cancelled";

export interface CustomerRow {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  block: number | null;
  serviceSlot: number | null;
  scheduledVisitDate: string | null;
  notes: string | null;
  pausedAt: string | null;
}

export interface CustomerFormState {
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  paymentMethod: PaymentMethod;
  block: string;
  serviceSlot: string;
  scheduledVisitDate: string;
  notes: string;
}

export const EMPTY_FORM: CustomerFormState = {
  fullName: "",
  houseNumber: "",
  whatsappNumber: "",
  plan: "monthly",
  paymentMethod: "payfast",
  block: "",
  serviceSlot: "",
  scheduledVisitDate: "",
  notes: "",
};

export const PLAN_LABELS: Record<PlanId, string> = { monthly: "Monthly", annual: "Annual", "once-off": "Once-off" };
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  payfast: "Card (PayFast)",
  eft: "EFT",
  cash: "Cash",
};
export const STATUS_LABELS: Record<PaymentStatus, string> = {
  booked: "Booked",
  pending: "Pending",
  active: "Active",
  failed: "Failed",
  cancelled: "Cancelled",
};
export const SKIP_REASON_LABELS: Record<SkipOrMoveReason, string> = {
  rain: "Rain",
  gate_locked: "Gate locked",
  dogs_loose: "Dogs loose",
  customer_requested: "Customer requested",
  other: "Other",
  moved: "Moved",
  blocked: "Blocked date",
};

export function formatRand(amount: number): string {
  return `R${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatShortDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function formToPayload(form: CustomerFormState) {
  return {
    fullName: form.fullName.trim(),
    houseNumber: form.houseNumber.trim(),
    whatsappNumber: form.whatsappNumber.trim(),
    plan: form.plan,
    paymentMethod: form.paymentMethod,
    block: form.block.trim() === "" ? null : Number(form.block),
    serviceSlot: form.plan !== "once-off" && form.serviceSlot.trim() !== "" ? Number(form.serviceSlot) : null,
    scheduledVisitDate: form.plan === "once-off" && form.scheduledVisitDate.trim() !== "" ? form.scheduledVisitDate : null,
    notes: form.notes.trim() === "" ? null : form.notes.trim(),
  };
}

export function customerToForm(c: CustomerRow): CustomerFormState {
  return {
    fullName: c.fullName,
    houseNumber: c.houseNumber,
    whatsappNumber: c.whatsappNumber,
    plan: c.plan,
    paymentMethod: c.paymentMethod,
    block: c.block === null ? "" : String(c.block),
    serviceSlot: c.serviceSlot === null ? "" : String(c.serviceSlot),
    scheduledVisitDate: c.scheduledVisitDate ?? "",
    notes: c.notes ?? "",
  };
}

export function CustomerFields({
  form,
  onChange,
}: {
  form: CustomerFormState;
  onChange: (patch: Partial<CustomerFormState>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <input
        value={form.fullName}
        onChange={(e) => onChange({ fullName: e.target.value })}
        placeholder="Full name"
        className="rounded-xl border border-brand-200 px-3 py-2.5 text-sm text-brand-900 outline-none focus:border-brand-500"
      />
      <div className="flex gap-2">
        <input
          value={form.houseNumber}
          onChange={(e) => onChange({ houseNumber: e.target.value })}
          placeholder="House number"
          className="flex-1 rounded-xl border border-brand-200 px-3 py-2.5 text-sm text-brand-900 outline-none focus:border-brand-500"
        />
        <select
          value={form.block}
          onChange={(e) => onChange({ block: e.target.value })}
          className="rounded-xl border border-brand-200 px-3 py-2.5 text-sm text-brand-900"
        >
          <option value="">No block</option>
          {Array.from({ length: MAX_BLOCK - MIN_BLOCK + 1 }, (_, i) => MIN_BLOCK + i).map((b) => (
            <option key={b} value={b}>
              Block {b}
            </option>
          ))}
        </select>
      </div>
      <input
        value={form.whatsappNumber}
        onChange={(e) => onChange({ whatsappNumber: e.target.value })}
        placeholder="WhatsApp number"
        className="rounded-xl border border-brand-200 px-3 py-2.5 text-sm text-brand-900 outline-none focus:border-brand-500"
      />
      <div className="flex gap-2">
        <select
          value={form.plan}
          onChange={(e) => onChange({ plan: e.target.value as PlanId, serviceSlot: "", scheduledVisitDate: "" })}
          className="flex-1 rounded-xl border border-brand-200 px-3 py-2.5 text-sm text-brand-900"
        >
          <option value="monthly">Monthly</option>
          <option value="annual">Annual</option>
          <option value="once-off">Once-off</option>
        </select>
        <select
          value={form.paymentMethod}
          onChange={(e) => onChange({ paymentMethod: e.target.value as PaymentMethod })}
          className="flex-1 rounded-xl border border-brand-200 px-3 py-2.5 text-sm text-brand-900"
        >
          <option value="payfast">Card (PayFast)</option>
          <option value="eft">EFT</option>
          <option value="cash">Cash</option>
        </select>
      </div>
      {form.plan === "once-off" ? (
        <label className="text-xs text-brand-500">
          Visit date (optional - leave blank for 3 working days from now)
          <input
            type="date"
            value={form.scheduledVisitDate}
            onChange={(e) => onChange({ scheduledVisitDate: e.target.value })}
            className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2.5 text-sm text-brand-900"
          />
        </label>
      ) : (
        <label className="text-xs text-brand-500">
          Service slot 1-14 (optional - leave blank to auto-assign)
          <input
            type="number"
            min={1}
            max={14}
            value={form.serviceSlot}
            onChange={(e) => onChange({ serviceSlot: e.target.value })}
            className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2.5 text-sm text-brand-900"
          />
        </label>
      )}
      <textarea
        value={form.notes}
        onChange={(e) => onChange({ notes: e.target.value })}
        placeholder="Notes - gate code, dogs, where the tap is..."
        rows={2}
        className="rounded-xl border border-brand-200 px-3 py-2.5 text-sm text-brand-900 outline-none focus:border-brand-500"
      />
    </div>
  );
}
