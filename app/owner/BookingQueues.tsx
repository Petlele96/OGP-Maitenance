"use client";

import { useState } from "react";
import { buildDateChangedLink, buildWelcomeLink, buildWhatsAppChatLink } from "@/lib/site";

export interface ToBeScheduledItem {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  block: number | null;
  paid: boolean;
  payAfterService: boolean;
  welcomed: boolean;
  trackingUrl: string;
  waitingDays: number;
}

export interface PaymentLinkItem {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: "monthly" | "annual" | "once-off";
  lastVisitDate: string;
  paymentLinkSentAt: string | null;
  paymentLinkExpired: boolean;
}

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

function longDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

function shortDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function recordContact(signupId: string) {
  fetch("/api/owner/customers/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signupId }),
  }).catch(() => {});
}

/** A big count that cannot be missed: red while anyone is waiting on the owner, calm when nobody is. */
function CountCard({ count, title, waiting, clear }: { count: number; title: string; waiting: string; clear: string }) {
  return (
    <div
      className={`flex items-center gap-4 rounded-2xl p-4 shadow-sm ring-2 ${
        count > 0 ? "bg-red-50 ring-red-300" : "bg-white ring-brand-100"
      }`}
    >
      <p className={`text-5xl font-black leading-none ${count > 0 ? "text-red-700" : "text-brand-300"}`}>{count}</p>
      <div>
        <p className="text-base font-bold text-brand-900">{title}</p>
        <p className="text-xs text-brand-600">{count > 0 ? waiting : clear}</p>
      </div>
    </div>
  );
}

/**
 * Booked customers with no service date. They are on no route and no calendar until the owner gives them one, so
 * the count sits at the top of the dashboard. Assigning a date sets it and opens the WhatsApp message that tells
 * the customer (the welcome message, with their date and tracking page, the first time).
 */
export function ToBeScheduledPanel({ items, onChanged, onView }: { items: ToBeScheduledItem[]; onChanged: () => void; onView: (id: string) => void }) {
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [unsent, setUnsent] = useState<Record<string, string>>({});

  async function assign(c: ToBeScheduledItem) {
    const date = dates[c.id];
    if (!date) return;
    setBusyId(c.id);
    setErrors((e) => ({ ...e, [c.id]: "" }));
    // Opened before the request so mobile browsers treat it as the result of the tap, not a popup.
    const waTab = window.open("", "_blank");
    const res = await fetch("/api/owner/schedule/assign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId: c.id, date }),
    });
    setBusyId(null);
    if (!res.ok) {
      waTab?.close();
      const json = await res.json().catch(() => ({}));
      setErrors((e) => ({ ...e, [c.id]: json.error ?? "Couldn't assign that date." }));
      return;
    }
    const label = longDate(date);
    const link = c.welcomed
      ? buildDateChangedLink(c.fullName, c.whatsappNumber, label)
      : buildWelcomeLink(c.fullName, c.whatsappNumber, label, c.trackingUrl);
    if (!c.welcomed) {
      await fetch("/api/owner/welcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signupId: c.id }),
      }).catch(() => {});
    }
    recordContact(c.id);
    if (waTab) {
      waTab.location.href = link;
    } else {
      setUnsent((u) => ({ ...u, [c.id]: link })); // popup blocked: keep a one-tap button instead
    }
    onChanged();
  }

  return (
    <section className="flex flex-col gap-3">
      <CountCard
        count={items.length}
        title="To be scheduled"
        waiting="Booked customers waiting on you for a service date. They are on no route until you give them one."
        clear="Nobody is waiting for a service date."
      />
      {items.length > 0 && (
        <ul className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
          {items.map((c) => (
            <li key={c.id} className="border-t border-brand-50 pt-3 first:border-0 first:pt-0">
              <button onClick={() => onView(c.id)} className="text-left">
                <p className="font-semibold text-brand-900 underline">{c.fullName}</p>
              </button>
              <p className="text-sm text-brand-700">
                House {c.houseNumber}
                {c.block !== null && <> · Block {c.block}</>} ·{" "}
                <a
                  href={buildWhatsAppChatLink(c.whatsappNumber)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => recordContact(c.id)}
                  className="text-brand-500 underline"
                >
                  {c.whatsappNumber}
                </a>
              </p>
              <p className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-brand-700">
                  {c.paid ? "Paid - active" : c.payAfterService ? "Pays after first service" : "Awaiting payment"}
                </span>
                <span className={`rounded-md px-1.5 py-0.5 ${c.waitingDays >= 2 ? "bg-red-100 text-red-800" : "bg-brand-50 text-brand-700"}`}>
                  {c.waitingDays === 0 ? "Booked today" : `Waiting ${c.waitingDays} day${c.waitingDays === 1 ? "" : "s"}`}
                </span>
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="date"
                  min={todayKey()}
                  value={dates[c.id] ?? ""}
                  onChange={(e) => setDates((d) => ({ ...d, [c.id]: e.target.value }))}
                  aria-label={`Service date for ${c.fullName}`}
                  className="min-w-0 flex-1 rounded-lg border border-brand-200 px-2 py-2 text-sm text-brand-900"
                />
                <button
                  onClick={() => assign(c)}
                  disabled={!dates[c.id] || busyId === c.id}
                  className="shrink-0 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busyId === c.id ? "Assigning..." : "Assign and tell them"}
                </button>
              </div>
              {errors[c.id] && <p className="mt-1 text-xs text-red-700">{errors[c.id]}</p>}
              {unsent[c.id] && (
                <a href={unsent[c.id]} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold text-brand-600 underline">
                  Date saved - tap to send the WhatsApp message
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Customers who chose to pay after their first service and have now had a visit recorded. The link issued is the
 * subscription-activation checkout (monthly billing), and the flag clears by itself when they pay.
 */
export function PaymentLinkPanel({ items, onChanged, onView }: { items: PaymentLinkItem[]; onChanged: () => void; onView: (id: string) => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(c: PaymentLinkItem) {
    setBusyId(c.id);
    setError(null);
    const waTab = window.open("", "_blank");
    const res = await fetch("/api/owner/send-payment-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId: c.id }),
    });
    setBusyId(null);
    if (!res.ok) {
      waTab?.close();
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Couldn't create that link.");
      return;
    }
    const data = await res.json();
    if (waTab) waTab.location.href = data.whatsappLink;
    recordContact(c.id);
    onChanged();
  }

  return (
    <section className="flex flex-col gap-3">
      <CountCard
        count={items.length}
        title="Send payment link"
        waiting="Serviced customers who chose to pay after the work. The flag clears when they activate."
        clear="No one is waiting for a payment link."
      />
      {items.length > 0 && (
        <ul className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
          {items.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 border-t border-brand-50 pt-3 first:border-0 first:pt-0">
              <button onClick={() => onView(c.id)} className="min-w-0 text-left">
                <p className="font-semibold text-brand-900 underline">{c.fullName}</p>
                <p className="text-sm text-brand-700">House {c.houseNumber}</p>
                <p className="text-xs text-brand-500">
                  Serviced {shortDate(c.lastVisitDate)}
                  {c.paymentLinkSentAt
                    ? c.paymentLinkExpired
                      ? " · link expired"
                      : ` · link sent ${shortDate(c.paymentLinkSentAt.slice(0, 10))}`
                    : " · link not sent yet"}
                </p>
              </button>
              <button
                onClick={() => send(c)}
                disabled={busyId === c.id}
                className="shrink-0 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busyId === c.id ? "Creating..." : c.paymentLinkSentAt ? "Send a new link" : "Send payment link"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </section>
  );
}
