"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { buildWelcomeLink, buildChaseLink, buildWhatsAppChatLink } from "@/lib/site";
import type { SkipOrMoveReason } from "@/lib/schedule";
import ScheduleTab from "./ScheduleTab";
import CustomerProfile from "./CustomerProfile";
import {
  CustomerFields,
  EMPTY_FORM,
  PLAN_LABELS,
  STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  SKIP_REASON_LABELS,
  formatShortDate,
  formToPayload,
  type CustomerRow,
  type CustomerFormState,
} from "./CustomerShared";

type AuthState = "checking" | "unauthenticated" | "authenticated";
type OwnerTab = "dashboard" | "customers" | "schedule" | "messages";

interface FailedOrOverdue {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  daysLate: number;
  status: "failed" | "overdue" | "unpaid";
}

interface UnwelcomedCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  serviceDayLabel: string;
  trackingUrl: string;
}

interface SkippedVisit {
  id: string;
  signupId: string;
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

interface MessageCentreCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  lastContactedAt: string | null;
}

function formatRand(amount: number): string {
  return `R${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function recordContact(signupId: string) {
  fetch("/api/owner/customers/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signupId }),
  }).catch(() => {});
}

function formatLastContacted(iso: string | null): string {
  if (!iso) return "Never contacted";
  return `Last contacted ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

export default function OwnerPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [tab, setTab] = useState<OwnerTab>("dashboard");
  const [data, setData] = useState<DashboardData | null>(null);
  const [viewingCustomerId, setViewingCustomerId] = useState<string | null>(null);

  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<CustomerFormState>(EMPTY_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [messages, setMessages] = useState<MessageCentreCustomer[] | null>(null);

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

  const loadMessages = useCallback(async () => {
    const res = await fetch("/api/owner/messages", { cache: "no-store" });
    if (res.status === 401) {
      setAuthState("unauthenticated");
      return;
    }
    const json = await res.json();
    setMessages(json.customers);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (authState === "authenticated" && tab === "customers" && !customers) loadCustomers();
  }, [authState, tab, customers, loadCustomers]);

  useEffect(() => {
    if (authState === "authenticated" && tab === "messages") loadMessages();
  }, [authState, tab, loadMessages]);

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

  async function handleWelcome(c: UnwelcomedCustomer) {
    await fetch("/api/owner/welcome", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId: c.id }),
    });
    recordContact(c.id);
    setData((prev) =>
      prev ? { ...prev, unwelcomedCustomers: prev.unwelcomedCustomers.filter((u) => u.id !== c.id) } : prev
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

  function refreshAfterProfileChange() {
    loadCustomers();
    loadDashboard();
    if (tab === "messages") loadMessages();
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
      {viewingCustomerId && (
        <CustomerProfile
          id={viewingCustomerId}
          onClose={() => setViewingCustomerId(null)}
          onChanged={refreshAfterProfileChange}
        />
      )}

      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-brand-900">OGP Owner Dashboard</h1>
        <button onClick={handleLogout} className="text-xs font-medium text-brand-500 underline">
          Log out
        </button>
      </header>

      <div className="flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-brand-100">
        <button
          onClick={() => setTab("dashboard")}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold ${tab === "dashboard" ? "bg-brand-600 text-white" : "text-brand-700"}`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setTab("customers")}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold ${tab === "customers" ? "bg-brand-600 text-white" : "text-brand-700"}`}
        >
          Customers
        </button>
        <button
          onClick={() => setTab("schedule")}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold ${tab === "schedule" ? "bg-brand-600 text-white" : "text-brand-700"}`}
        >
          Schedule
        </button>
        <button
          onClick={() => setTab("messages")}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold ${tab === "messages" ? "bg-brand-600 text-white" : "text-brand-700"}`}
        >
          Messages
        </button>
      </div>

      {tab === "schedule" && <ScheduleTab />}

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
                      <button onClick={() => setViewingCustomerId(c.id)} className="min-w-0 text-left">
                        <p className="font-semibold text-brand-900 underline">{c.fullName}</p>
                        <p className="text-sm text-brand-700">House {c.houseNumber}</p>
                      </button>
                      <span className="ml-3 shrink-0 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                        {c.status === "failed"
                          ? "Failed"
                          : c.status === "unpaid"
                            ? "No payment recorded"
                            : `${c.daysLate} day${c.daysLate === 1 ? "" : "s"} overdue`}
                      </span>
                    </div>
                    <a
                      href={buildWhatsAppChatLink(c.whatsappNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => recordContact(c.id)}
                      className="text-sm text-brand-500 underline"
                    >
                      {c.whatsappNumber}
                    </a>
                    <a
                      href={buildChaseLink(c.fullName, c.whatsappNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => recordContact(c.id)}
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
                    <button onClick={() => setViewingCustomerId(c.id)} className="min-w-0 text-left">
                      <p className="font-semibold text-brand-900 underline">{c.fullName}</p>
                      <p className="text-sm text-brand-700">House {c.houseNumber}</p>
                      <a
                        href={buildWhatsAppChatLink(c.whatsappNumber)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.stopPropagation();
                          recordContact(c.id);
                        }}
                        className="text-sm text-brand-500 underline"
                      >
                        {c.whatsappNumber}
                      </a>
                      <p className="mt-0.5 text-xs text-brand-500">Service day: {c.serviceDayLabel}</p>
                    </button>
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
                      <button onClick={() => setViewingCustomerId(c.id)} className="min-w-0 text-left">
                        <p className="font-semibold text-brand-900 underline">{c.fullName}</p>
                        <p className="text-sm text-brand-700">House {c.houseNumber}</p>
                      </button>
                      <a
                        href={buildWelcomeLink(c.fullName, c.whatsappNumber, c.serviceDayLabel, c.trackingUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => handleWelcome(c)}
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
                    <button onClick={() => setViewingCustomerId(v.signupId)} className="min-w-0 text-left">
                      <p className="font-semibold text-brand-900 underline">{v.fullName}</p>
                      <p className="text-sm text-brand-700">House {v.houseNumber}</p>
                      <p className="text-xs text-brand-500">
                        {formatShortDate(v.originalDate)} → moved to {formatShortDate(v.rescheduledDate)}
                      </p>
                    </button>
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
                    onClick={() => setViewingCustomerId(c.id)}
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
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "messages" && (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
          <h2 className="text-sm font-semibold text-brand-900">Message centre</h2>
          {messages === null ? (
            <p className="mt-3 text-sm text-brand-500">Loading...</p>
          ) : messages.length === 0 ? (
            <p className="mt-3 text-sm text-brand-500">No customers yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {messages.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-t border-brand-50 pt-3 first:border-0 first:pt-0">
                  <button onClick={() => setViewingCustomerId(c.id)} className="min-w-0 text-left">
                    <p className="font-semibold text-brand-900 underline">{c.fullName}</p>
                    <p className="text-sm text-brand-700">House {c.houseNumber}</p>
                    <p className="text-xs text-brand-400">{formatLastContacted(c.lastContactedAt)}</p>
                  </button>
                  <a
                    href={buildWhatsAppChatLink(c.whatsappNumber)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      recordContact(c.id);
                      setMessages((prev) =>
                        prev
                          ? prev.map((m) => (m.id === c.id ? { ...m, lastContactedAt: new Date().toISOString() } : m))
                          : prev
                      );
                    }}
                    className="ml-3 shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
                  >
                    WhatsApp
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
