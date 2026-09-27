"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { buildWelcomeLink, buildChaseLink } from "@/lib/site";
import type { SkipOrMoveReason } from "@/lib/schedule";
import type { PlanId } from "@/lib/plans";
import { MIN_BLOCK, MAX_BLOCK } from "@/lib/sort";

type AuthState = "checking" | "unauthenticated" | "authenticated";
type OwnerTab = "dashboard" | "customers";
type PaymentMethod = "payfast" | "eft" | "cash";
type PaymentStatus = "booked" | "pending" | "active" | "failed" | "cancelled";

interface FailedOrOverdue {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  daysLate: number;
  status: "failed" | "overdue";
}

interface UnwelcomedCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  serviceDayLabel: string;
}

interface SkippedVisit {
  id: string;
  fullName: string;
  houseNumber: string;
  reason: SkipOrMoveReason;
  originalDate: string;
  rescheduledDate: string;
}

interface BookedCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  serviceDayLabel: string;
  paymentLinkSentAt: string | null;
  paymentLinkExpired: boolean;
}

interface DashboardData {
  activeCustomers: { total: number; monthly: number; annual: number };
  onceOffJobsThisMonth: number;
  revenueThisMonth: {
    subscriber: number;
    onceOff: number;
    total: number;
    byMethod: { payfast: number; eft: number; cash: number };
  };
  failedOrOverdue: FailedOrOverdue[];
  cancellationsThisMonth: number;
  completion: { done: number; scheduled: number };
  unwelcomedCustomers: UnwelcomedCustomer[];
  skippedVisits: SkippedVisit[];
  bookedCount: number;
  bookedCustomers: BookedCustomer[];
}

interface CustomerRow {
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

interface CustomerFormState {
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

const EMPTY_FORM: CustomerFormState = {
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

function formatRand(amount: number): string {
  return `R${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SKIP_REASON_LABELS: Record<SkipOrMoveReason, string> = {
  rain: "Rain",
  gate_locked: "Gate locked",
  dogs_loose: "Dogs loose",
  customer_requested: "Customer requested",
  other: "Other",
  moved: "Moved",
};

const PLAN_LABELS: Record<PlanId, string> = { monthly: "Monthly", annual: "Annual", "once-off": "Once-off" };
const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = { payfast: "Card (PayFast)", eft: "EFT", cash: "Cash" };
const STATUS_LABELS: Record<PaymentStatus, string> = {
  booked: "Booked",
  pending: "Pending",
  active: "Active",
  failed: "Failed",
  cancelled: "Cancelled",
};

function formatShortDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formToPayload(form: CustomerFormState) {
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

function customerToForm(c: CustomerRow): CustomerFormState {
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

function CustomerFields({
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

export default function OwnerPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [tab, setTab] = useState<OwnerTab>("dashboard");
  const [data, setData] = useState<DashboardData | null>(null);

  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<CustomerFormState>(EMPTY_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CustomerFormState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  const loadDashboard = useCallback(async () => {
    const res = await fetch("/api/owner/dashboard", { cache: "no-store" });
    if (res.status === 401) {
      setAuthState("unauthenticated");
      return;
    }
    setData(await res.json());
    setAuthState("authenticated");
  }, []);

  const loadCustomers = useCallback(async () => {
    const res = await fetch("/api/owner/customers/list", { cache: "no-store" });
    if (res.status === 401) {
      setAuthState("unauthenticated");
      return;
    }
    const json = await res.json();
    setCustomers(json.customers);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (authState === "authenticated" && tab === "customers" && !customers) loadCustomers();
  }, [authState, tab, customers, loadCustomers]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    const res = await fetch("/api/owner/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoggingIn(false);
    if (!res.ok) {
      setLoginError("Incorrect password");
      return;
    }
    setPassword("");
    await loadDashboard();
  }

  async function handleLogout() {
    await fetch("/api/owner/logout", { method: "POST" });
    setAuthState("unauthenticated");
    setData(null);
    setCustomers(null);
  }

  async function handleWelcome(signupId: string) {
    await fetch("/api/owner/welcome", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId }),
    });
    setData((prev) =>
      prev ? { ...prev, unwelcomedCustomers: prev.unwelcomedCustomers.filter((c) => c.id !== signupId) } : prev
    );
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setAddSubmitting(true);
    setAddError(null);
    const res = await fetch("/api/owner/customers/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(formToPayload(addForm)),
    });
    setAddSubmitting(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setAddError(json.error ?? "Couldn't add that customer.");
      return;
    }
    setAddForm(EMPTY_FORM);
    setShowAddForm(false);
    await loadCustomers();
  }

  function startEditing(c: CustomerRow) {
    setEditingId(c.id);
    setEditForm(customerToForm(c));
    setEditError(null);
    setPaymentAmount("");
    setPaymentDate("");
    setPaymentError(null);
  }

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editingId || !editForm) return;
    setEditSubmitting(true);
    setEditError(null);
    const res = await fetch("/api/owner/customers/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId: editingId, ...formToPayload(editForm) }),
    });
    setEditSubmitting(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setEditError(json.error ?? "Couldn't save changes.");
      return;
    }
    await loadCustomers();
  }

  async function handlePauseResume(c: CustomerRow) {
    setActionBusyId(c.id);
    await fetch(`/api/owner/customers/${c.pausedAt ? "resume" : "pause"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId: c.id }),
    });
    setActionBusyId(null);
    await loadCustomers();
  }

  async function handleCancelCustomer(c: CustomerRow) {
    if (!window.confirm(`Cancel ${c.fullName}? This stops their schedule and billing.`)) return;
    setActionBusyId(c.id);
    await fetch("/api/owner/customers/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId: c.id }),
    });
    setActionBusyId(null);
    setEditingId(null);
    await loadCustomers();
  }

  async function handleRecordPayment(e: FormEvent, c: CustomerRow) {
    e.preventDefault();
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      setPaymentError("Enter a valid amount");
      return;
    }
    setPaymentSubmitting(true);
    setPaymentError(null);
    const res = await fetch("/api/owner/customers/record-payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signupId: c.id,
        amount,
        method: c.paymentMethod === "cash" ? "cash" : "eft",
        receivedAt: paymentDate.trim() === "" ? null : paymentDate,
      }),
    });
    setPaymentSubmitting(false);
    if (!res.ok) {
      setPaymentError("Couldn't record that payment.");
      return;
    }
    setPaymentAmount("");
    setPaymentDate("");
    await loadDashboard();
  }

  const filteredCustomers = useMemo(() => {
    if (!customers) return [];
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.houseNumber.toLowerCase().includes(q) ||
        c.whatsappNumber.includes(q)
    );
  }, [customers, search]);

  if (authState === "checking") {
    return <main className="flex min-h-dvh items-center justify-center bg-brand-50" />;
  }

  if (authState === "unauthenticated") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-brand-50 px-6">
        <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100">
          <h1 className="text-center text-lg font-bold text-brand-900">OGP Owner Dashboard</h1>
          <p className="mt-1 text-center text-sm text-brand-600">Enter the owner password</p>
          <form onSubmit={handleLogin} className="mt-5 flex flex-col gap-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              className="rounded-xl border border-brand-200 px-4 py-3 text-base text-brand-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {loginError && <p className="text-sm text-red-600">{loginError}</p>}
            <button
              type="submit"
              disabled={loggingIn || !password}
              className="w-full rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
            >
              {loggingIn ? "Checking..." : "Log in"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-10 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-brand-900">OGP Owner Dashboard</h1>
        <button onClick={handleLogout} className="text-xs font-medium text-brand-500 underline">
          Log out
        </button>
      </header>

      <div className="flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-brand-100">
        <button
          onClick={() => setTab("dashboard")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${tab === "dashboard" ? "bg-brand-600 text-white" : "text-brand-700"}`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setTab("customers")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${tab === "customers" ? "bg-brand-600 text-white" : "text-brand-700"}`}
        >
          Customers
        </button>
      </div>

      {tab === "dashboard" && data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
              <p className="text-xs font-medium text-brand-500">Active subscribers</p>
              <p className="mt-1 text-2xl font-bold text-brand-900">{data.activeCustomers.total}</p>
              <p className="mt-0.5 text-xs text-brand-600">
                {data.activeCustomers.monthly} monthly · {data.activeCustomers.annual} annual
              </p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
              <p className="text-xs font-medium text-brand-500">Once-off jobs</p>
              <p className="mt-1 text-2xl font-bold text-brand-900">{data.onceOffJobsThisMonth}</p>
              <p className="mt-0.5 text-xs text-brand-600">this month</p>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
            <p className="text-xs font-medium text-brand-500">Booked, awaiting payment</p>
            <p className="mt-1 text-2xl font-bold text-brand-900">{data.bookedCount}</p>
          </div>

          <div className="rounded-2xl bg-brand-600 p-4 shadow-sm">
            <p className="text-xs font-medium text-brand-100">Money in this month</p>
            <p className="mt-1 text-2xl font-bold text-white">{formatRand(data.revenueThisMonth.total)}</p>
            <p className="mt-0.5 text-xs text-brand-100">
              {formatRand(data.revenueThisMonth.subscriber)} subscribers · {formatRand(data.revenueThisMonth.onceOff)}{" "}
              once-off
            </p>
            <p className="mt-1 text-xs text-brand-100">
              {formatRand(data.revenueThisMonth.byMethod.payfast)} card ·{" "}
              {formatRand(data.revenueThisMonth.byMethod.eft)} EFT · {formatRand(data.revenueThisMonth.byMethod.cash)}{" "}
              cash
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
              <p className="text-xs font-medium text-brand-500">Completion rate</p>
              <p className="mt-1 text-2xl font-bold text-brand-900">
                {data.completion.scheduled === 0 ? "-" : `${Math.round((data.completion.done / data.completion.scheduled) * 100)}%`}
              </p>
              <p className="mt-0.5 text-xs text-brand-600">
                {data.completion.done} / {data.completion.scheduled} visits this month
              </p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
              <p className="text-xs font-medium text-brand-500">Cancellations</p>
              <p className="mt-1 text-2xl font-bold text-brand-900">{data.cancellationsThisMonth}</p>
              <p className="mt-0.5 text-xs text-brand-600">this month</p>
            </div>
          </div>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
            <h2 className="text-sm font-semibold text-brand-900">Unpaid this month</h2>
            {data.failedOrOverdue.length === 0 ? (
              <p className="mt-3 text-sm text-brand-500">None right now.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {data.failedOrOverdue.map((c) => (
                  <li key={c.id} className="border-t border-brand-50 pt-3 first:border-0 first:pt-0">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-brand-900">{c.fullName}</p>
                        <p className="text-sm text-brand-700">House {c.houseNumber}</p>
                        <a href={`tel:${c.whatsappNumber}`} className="text-sm text-brand-500 underline">
                          {c.whatsappNumber}
                        </a>
                      </div>
                      <span className="ml-3 shrink-0 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                        {c.status === "failed" ? "Failed" : `${c.daysLate} day${c.daysLate === 1 ? "" : "s"} overdue`}
                      </span>
                    </div>
                    <a
                      href={buildChaseLink(c.fullName, c.whatsappNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 block rounded-lg border-2 border-brand-500 px-4 py-2 text-center text-sm font-semibold text-brand-700"
                    >
                      Chase on WhatsApp
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
            <h2 className="text-sm font-semibold text-brand-900">Booked - awaiting payment</h2>
            {data.bookedCustomers.length === 0 ? (
              <p className="mt-3 text-sm text-brand-500">No one's waiting to pay.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {data.bookedCustomers.map((c) => (
                  <li key={c.id} className="flex items-center justify-between border-t border-brand-50 pt-3 first:border-0 first:pt-0">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-900">{c.fullName}</p>
                      <p className="text-sm text-brand-700">House {c.houseNumber}</p>
                      <a href={`tel:${c.whatsappNumber}`} className="text-sm text-brand-500 underline">
                        {c.whatsappNumber}
                      </a>
                      <p className="mt-0.5 text-xs text-brand-500">Service day: {c.serviceDayLabel}</p>
                    </div>
                    <span className="ml-3 shrink-0 rounded-lg bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700">
                      {c.paymentLinkExpired ? "Link expired" : c.paymentLinkSentAt ? "Link sent" : "Not sent yet"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
            <h2 className="text-sm font-semibold text-brand-900">Welcome new customers</h2>
            {data.unwelcomedCustomers.length === 0 ? (
              <p className="mt-3 text-sm text-brand-500">Everyone's been welcomed.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {data.unwelcomedCustomers.map((c) => (
                  <li key={c.id} className="border-t border-brand-50 pt-3 first:border-0 first:pt-0">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-brand-900">{c.fullName}</p>
                        <p className="text-sm text-brand-700">House {c.houseNumber}</p>
                      </div>
                      <a
                        href={buildWelcomeLink(c.fullName, c.whatsappNumber, c.serviceDayLabel)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => handleWelcome(c.id)}
                        className="ml-3 shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
                      >
                        Welcome
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
            <h2 className="text-sm font-semibold text-brand-900">Missed visits this month</h2>
            {data.skippedVisits.length === 0 ? (
              <p className="mt-3 text-sm text-brand-500">None this month.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {data.skippedVisits.map((v) => (
                  <li key={v.id} className="flex items-center justify-between border-t border-brand-50 pt-3 first:border-0 first:pt-0">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-900">{v.fullName}</p>
                      <p className="text-sm text-brand-700">House {v.houseNumber}</p>
                      <p className="text-xs text-brand-500">
                        {formatShortDate(v.originalDate)} → moved to {formatShortDate(v.rescheduledDate)}
                      </p>
                    </div>
                    <span className="ml-3 shrink-0 rounded-lg bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700">
                      {SKIP_REASON_LABELS[v.reason]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {tab === "customers" && (
        <>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white"
          >
            {showAddForm ? "Cancel" : "+ Add customer"}
          </button>

          {showAddForm && (
            <form onSubmit={handleCreate} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
              <CustomerFields form={addForm} onChange={(patch) => setAddForm((f) => ({ ...f, ...patch }))} />
              {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}
              <button
                type="submit"
                disabled={addSubmitting}
                className="mt-3 w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {addSubmitting ? "Adding..." : "Add customer"}
              </button>
            </form>
          )}

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, house or number"
            className="rounded-xl border border-brand-200 px-4 py-3 text-sm text-brand-900 outline-none focus:border-brand-500"
          />

          {!customers ? (
            <p className="mt-4 text-center text-sm text-brand-500">Loading...</p>
          ) : filteredCustomers.length === 0 ? (
            <p className="mt-4 text-center text-sm text-brand-500">No customers found.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {filteredCustomers.map((c) => (
                <li key={c.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
                  <button
                    onClick={() => (editingId === c.id ? setEditingId(null) : startEditing(c))}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-900">{c.fullName}</p>
                      <p className="text-sm text-brand-700">
                        House {c.houseNumber} <span className="text-brand-400">· {PLAN_LABELS[c.plan]}</span>
                      </p>
                    </div>
                    <div className="ml-3 flex shrink-0 flex-col items-end gap-1">
                      <span className="rounded-lg bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700">
                        {c.pausedAt ? "Paused" : STATUS_LABELS[c.paymentStatus]}
                      </span>
                      <span className="text-xs text-brand-400">{PAYMENT_METHOD_LABELS[c.paymentMethod]}</span>
                    </div>
                  </button>

                  {editingId === c.id && editForm && (
                    <form onSubmit={handleUpdate} className="mt-4 border-t border-brand-50 pt-4">
                      <CustomerFields form={editForm} onChange={(patch) => setEditForm((f) => (f ? { ...f, ...patch } : f))} />
                      {editError && <p className="mt-2 text-sm text-red-600">{editError}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={editSubmitting}
                          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {editSubmitting ? "Saving..." : "Save changes"}
                        </button>
                        {c.paymentStatus !== "cancelled" && (
                          <button
                            type="button"
                            onClick={() => handlePauseResume(c)}
                            disabled={actionBusyId === c.id}
                            className="rounded-lg border-2 border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-700 disabled:opacity-60"
                          >
                            {c.pausedAt ? "Resume" : "Pause"}
                          </button>
                        )}
                        {c.paymentStatus !== "cancelled" && (
                          <button
                            type="button"
                            onClick={() => handleCancelCustomer(c)}
                            disabled={actionBusyId === c.id}
                            className="rounded-lg border-2 border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-60"
                          >
                            Cancel customer
                          </button>
                        )}
                      </div>

                      {c.paymentMethod !== "payfast" && c.paymentStatus === "active" && (
                        <div className="mt-4 rounded-xl bg-brand-50 p-3">
                          <p className="text-xs font-semibold text-brand-700">Record a payment received</p>
                          <div className="mt-2 flex gap-2">
                            <input
                              type="number"
                              step="0.01"
                              value={paymentAmount}
                              onChange={(e) => setPaymentAmount(e.target.value)}
                              placeholder="Amount"
                              className="w-24 rounded-lg border border-brand-200 px-2 py-2 text-sm text-brand-900"
                            />
                            <input
                              type="date"
                              value={paymentDate}
                              onChange={(e) => setPaymentDate(e.target.value)}
                              className="flex-1 rounded-lg border border-brand-200 px-2 py-2 text-sm text-brand-900"
                            />
                            <button
                              type="button"
                              onClick={(e) => handleRecordPayment(e as unknown as FormEvent, c)}
                              disabled={paymentSubmitting}
                              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                            >
                              {paymentSubmitting ? "Saving..." : "Record"}
                            </button>
                          </div>
                          {paymentError && <p className="mt-1 text-xs text-red-600">{paymentError}</p>}
                        </div>
                      )}
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
