"use client";

import { useEffect, useState } from "react";
import type { PlanId } from "@/lib/plans";

interface Subscription {
  id: string;
  fullName: string;
  houseNumber: string;
  plan: PlanId;
  method: "payfast" | "eft" | "cash";
  status: "booked" | "pending" | "active" | "failed" | "cancelled" | "archived";
  paused: boolean;
  subscribedOn: string | null;
  nextDebit: string | null;
  lastPaymentFailed: boolean;
}

const METHOD_LABELS = { payfast: "PayFast", eft: "EFT", cash: "Cash" } as const;
const PLAN_LABELS: Record<PlanId, string> = { monthly: "Monthly", annual: "Annual", "once-off": "Once-off" };

function fmt(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function daysUntil(dateKey: string): number {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  return Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

export default function SubscriptionsTab() {
  const [rows, setRows] = useState<Subscription[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/owner/subscriptions", { cache: "no-store" });
      if (res.ok) setRows((await res.json()).subscriptions);
    })();
  }, []);

  const q = search.trim().toLowerCase();
  const shown = (rows ?? []).filter(
    (r) => !q || r.fullName.toLowerCase().includes(q) || r.houseNumber.toLowerCase().includes(q)
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Subscriptions</h2>
        <p className="mt-1 text-xs text-brand-500">
          PayFast customers are debited on the day they subscribed, every month (every year for annual). EFT and cash
          customers are rolled forward from their subscription date one month at a time.
        </p>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or house number"
          className="mt-3 w-full rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-500"
        />
      </section>

      {rows === null ? (
        <p className="text-center text-sm text-brand-500">Loading...</p>
      ) : shown.length === 0 ? (
        <p className="text-center text-sm text-brand-500">No subscribers found.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((r) => {
            const ended = r.status === "cancelled" || r.status === "archived";
            const days = r.nextDebit ? daysUntil(r.nextDebit) : null;
            return (
              <li key={r.id} className={`rounded-2xl p-4 shadow-sm ring-1 ring-brand-100 ${ended ? "bg-brand-50" : "bg-white"}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-brand-900">
                    {r.fullName}
                    <span className="text-sm font-normal text-brand-500"> · House {r.houseNumber}</span>
                  </p>
                  <span className="shrink-0 rounded-md bg-brand-100 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">
                    {PLAN_LABELS[r.plan]} · {METHOD_LABELS[r.method]}
                  </span>
                </div>
                {(r.paused || r.lastPaymentFailed || ended || r.status === "booked") && (
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {r.status === "booked" && (
                      <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                        Booked - awaiting payment
                      </span>
                    )}
                    {r.status === "cancelled" && (
                      <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">Cancelled</span>
                    )}
                    {r.status === "archived" && (
                      <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[11px] font-semibold text-brand-600">Archived</span>
                    )}
                    {r.paused && (
                      <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">Service paused</span>
                    )}
                    {r.lastPaymentFailed && r.status === "active" && (
                      <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">Last payment failed</span>
                    )}
                  </p>
                )}
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm text-brand-800">
                  <dt className="text-brand-400">Subscribed</dt>
                  <dd>{r.subscribedOn ? fmt(r.subscribedOn) : "not yet"}</dd>
                  <dt className="text-brand-400">Next debit</dt>
                  <dd className="font-semibold">
                    {r.nextDebit ? (
                      <>
                        {fmt(r.nextDebit)}
                        <span className="font-normal text-brand-500">
                          {" "}
                          · {days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}
                        </span>
                      </>
                    ) : (
                      <span className="font-normal text-brand-500">{ended ? "none - subscription ended" : "none yet"}</span>
                    )}
                  </dd>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
