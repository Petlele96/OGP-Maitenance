"use client";

import { useEffect, useState, type FormEvent } from "react";
import { buildWhatsAppChatLink, buildDateChangedLink } from "@/lib/site";
import type { SkipOrMoveReason } from "@/lib/schedule";
import {
  CustomerFields,
  EMPTY_FORM,
  PLAN_LABELS,
  PAYMENT_METHOD_LABELS,
  STATUS_LABELS,
  SKIP_REASON_LABELS,
  formatRand,
  formatShortDate,
  formToPayload,
  customerToForm,
  type CustomerRow,
  type CustomerFormState,
} from "./CustomerShared";

interface HistoryEntry {
  date: string;
  status: "completed" | SkipOrMoveReason;
  rescheduledDate: string | null;
}

interface PaymentEntry {
  amount: number;
  method: "payfast" | "eft" | "cash";
  receivedAt: string;
}

interface ProfileData {
  customer: CustomerRow;
  history: HistoryEntry[];
  payments: PaymentEntry[];
}

function recordContact(signupId: string) {
  fetch("/api/owner/customers/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signupId }),
  }).catch(() => {});
}

export default function CustomerProfile({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<CustomerFormState>(EMPTY_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const [moveDate, setMoveDate] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveSubmitting, setMoveSubmitting] = useState(false);
  const [movedToLabel, setMovedToLabel] = useState<string | null>(null);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  async function load() {
    const res = await fetch(`/api/owner/customers/profile?id=${id}`, { cache: "no-store" });
    if (!res.ok) {
      setNotFound(true);
      return;
    }
    const json: ProfileData = await res.json();
    setData(json);
    setEditForm(customerToForm(json.customer));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setEditSubmitting(true);
    setEditError(null);
    const res = await fetch("/api/owner/customers/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId: id, ...formToPayload(editForm) }),
    });
    setEditSubmitting(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setEditError(json.error ?? "Couldn't save changes.");
      return;
    }
    setEditing(false);
    await load();
    onChanged();
  }

  async function handlePauseResume() {
    if (!data) return;
    setActionBusy(true);
    await fetch(`/api/owner/customers/${data.customer.pausedAt ? "resume" : "pause"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId: id }),
    });
    setActionBusy(false);
    await load();
    onChanged();
  }

  async function handleCancel() {
    if (!data) return;
    if (!window.confirm(`Cancel ${data.customer.fullName}? This stops their schedule and billing.`)) return;
    setActionBusy(true);
    await fetch("/api/owner/customers/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId: id }),
    });
    setActionBusy(false);
    await load();
    onChanged();
  }

  async function handleMoveNext() {
    if (!moveDate || !data) return;
    setMoveSubmitting(true);
    setMoveError(null);
    const res = await fetch("/api/owner/customers/move-next-visit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId: id, targetDate: moveDate }),
    });
    setMoveSubmitting(false);
    if (!res.ok) {
      setMoveError("Couldn't move that visit.");
      return;
    }
    setMovedToLabel(formatShortDate(moveDate));
    setMoveDate("");
    await load();
    onChanged();
  }

  async function handleRecordPayment(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
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
        signupId: id,
        amount,
        method: data.customer.paymentMethod === "cash" ? "cash" : "eft",
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
    await load();
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-brand-50">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-10 pt-6">
        <button onClick={onClose} className="self-start text-sm font-medium text-brand-500 underline">
          ← Back
        </button>

        {notFound && <p className="mt-8 text-center text-sm text-brand-500">Customer not found.</p>}

        {!data && !notFound && <p className="mt-8 text-center text-sm text-brand-500">Loading...</p>}

        {data && (
          <>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-brand-900">{data.customer.fullName}</h1>
                  <p className="text-sm text-brand-700">
                    House {data.customer.houseNumber} <span className="text-brand-400">· {PLAN_LABELS[data.customer.plan]}</span>
                  </p>
                </div>
                <span className="ml-3 shrink-0 rounded-lg bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700">
                  {data.customer.pausedAt ? "Paused" : STATUS_LABELS[data.customer.paymentStatus]}
                </span>
              </div>
              <a
                href={buildWhatsAppChatLink(data.customer.whatsappNumber)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => recordContact(id)}
                className="mt-2 inline-block text-sm text-brand-500 underline"
              >
                {data.customer.whatsappNumber}
              </a>
              <p className="mt-1 text-xs text-brand-400">{PAYMENT_METHOD_LABELS[data.customer.paymentMethod]}</p>
              {data.customer.notes && (
                <p className="mt-3 rounded-lg bg-brand-50 p-2 text-sm text-brand-700">{data.customer.notes}</p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => setEditing((v) => !v)}
                  className="rounded-lg border-2 border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-700"
                >
                  {editing ? "Cancel edit" : "Edit"}
                </button>
                {data.customer.paymentStatus !== "cancelled" && (
                  <button
                    onClick={handlePauseResume}
                    disabled={actionBusy}
                    className="rounded-lg border-2 border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-700 disabled:opacity-60"
                  >
                    {data.customer.pausedAt ? "Resume" : "Pause"}
                  </button>
                )}
                {data.customer.paymentStatus !== "cancelled" && (
                  <button
                    onClick={handleCancel}
                    disabled={actionBusy}
                    className="rounded-lg border-2 border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-60"
                  >
                    Cancel customer
                  </button>
                )}
              </div>

              {editing && (
                <form onSubmit={handleSave} className="mt-4 border-t border-brand-50 pt-4">
                  <CustomerFields form={editForm} onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))} />
                  {editError && <p className="mt-2 text-sm text-red-600">{editError}</p>}
                  <button
                    type="submit"
                    disabled={editSubmitting}
                    className="mt-3 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {editSubmitting ? "Saving..." : "Save changes"}
                  </button>
                </form>
              )}

              {(data.customer.paymentStatus === "active" || data.customer.paymentStatus === "booked") &&
                !data.customer.pausedAt && (
                <div className="mt-4 rounded-xl bg-brand-50 p-3">
                  <p className="text-xs font-semibold text-brand-700">Move next visit</p>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="date"
                      value={moveDate}
                      onChange={(e) => setMoveDate(e.target.value)}
                      className="flex-1 rounded-lg border border-brand-200 px-2 py-2 text-sm text-brand-900"
                    />
                    <button
                      onClick={handleMoveNext}
                      disabled={!moveDate || moveSubmitting}
                      className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {moveSubmitting ? "Moving..." : "Move"}
                    </button>
                  </div>
                  {moveError && <p className="mt-1 text-xs text-red-600">{moveError}</p>}
                  {movedToLabel && (
                    <a
                      href={buildDateChangedLink(data.customer.fullName, data.customer.whatsappNumber, movedToLabel)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => recordContact(id)}
                      className="mt-2 block rounded-lg bg-brand-600 px-4 py-2 text-center text-sm font-semibold text-white"
                    >
                      Tell them on WhatsApp: now booked for {movedToLabel}
                    </a>
                  )}
                </div>
              )}

              {data.customer.paymentMethod !== "payfast" &&
                (data.customer.paymentStatus === "active" || data.customer.paymentStatus === "booked") && (
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
                      onClick={handleRecordPayment}
                      disabled={paymentSubmitting}
                      className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {paymentSubmitting ? "Saving..." : "Record"}
                    </button>
                  </div>
                  {paymentError && <p className="mt-1 text-xs text-red-600">{paymentError}</p>}
                </div>
              )}
            </div>

            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
              <h2 className="text-sm font-semibold text-brand-900">Visit history</h2>
              {data.history.length === 0 ? (
                <p className="mt-2 text-sm text-brand-500">No visits yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {data.history.map((h, i) => (
                    <li key={i} className="flex items-center justify-between border-t border-brand-50 pt-2 first:border-0 first:pt-0 text-sm">
                      <span className="text-brand-800">{formatShortDate(h.date)}</span>
                      <span className="text-xs font-semibold text-brand-600">
                        {h.status === "completed" ? "Completed" : SKIP_REASON_LABELS[h.status]}
                        {h.rescheduledDate && <> → {formatShortDate(h.rescheduledDate)}</>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
              <h2 className="text-sm font-semibold text-brand-900">Payment history</h2>
              {data.payments.length === 0 ? (
                <p className="mt-2 text-sm text-brand-500">No payments recorded yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {data.payments.map((p, i) => (
                    <li key={i} className="flex items-center justify-between border-t border-brand-50 pt-2 first:border-0 first:pt-0 text-sm">
                      <span className="text-brand-800">{new Date(p.receivedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                      <span className="text-brand-600">
                        {formatRand(p.amount)} <span className="text-brand-400">· {PAYMENT_METHOD_LABELS[p.method]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
