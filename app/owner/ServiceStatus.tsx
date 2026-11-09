"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlanId } from "@/lib/plans";

interface Client {
  id: string;
  fullName: string;
  houseNumber: string;
  block: number | null;
  plan: PlanId;
  paused: boolean;
  lastVisitDate: string | null;
  lastVisitWorker: string | null;
  nextServiceDate: string | null;
  overdueSince: string | null;
}

const REFRESH_MS = 10_000;

function fmt(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Last service, who did it, next service date and the overdue flag for every client - the same data the
 * operations page shows, read from the same records. It refreshes every few seconds while the page is in view
 * (and the moment you come back to it), so a visit recorded on /ops shows up here without a reload.
 */
export default function ServiceStatus({ onOverdueCount }: { onOverdueCount: (n: number) => void }) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [overdueCount, setOverdueCount] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/owner/service-status", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setClients(json.clients);
      setOverdueCount(json.overdueCount);
      setUpdatedAt(new Date());
      onOverdueCount(json.overdueCount);
    } catch {
      /* offline for a moment - the next tick tries again */
    }
  }, [onOverdueCount]);

  useEffect(() => {
    load();
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load]);

  const q = search.trim().toLowerCase();
  const shown = (clients ?? []).filter(
    (c) => !q || c.fullName.toLowerCase().includes(q) || c.houseNumber.toLowerCase().includes(q)
  );

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-900">Service status</h2>
          <p className="text-xs text-brand-500">
            {updatedAt ? `Live - updated ${updatedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Loading..."}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold ${
            overdueCount > 0 ? "bg-red-100 text-red-800" : "bg-brand-50 text-brand-700"
          }`}
        >
          {overdueCount} overdue
        </span>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or house number"
        className="mt-3 w-full rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-500"
      />

      {clients === null ? null : shown.length === 0 ? (
        <p className="mt-3 text-center text-sm text-brand-500">No clients found.</p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {shown.map((c) => (
            <li
              key={c.id}
              className={`border-t border-brand-50 py-2.5 first:border-0 ${c.overdueSince ? "bg-red-50/60 px-2 -mx-2 rounded-lg" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-brand-900">
                  {c.fullName}
                  <span className="font-normal text-brand-500">
                    {" "}
                    · House {c.houseNumber}
                    {c.block !== null && <> · Block {c.block}</>}
                  </span>
                </p>
                {c.overdueSince && (
                  <span className="shrink-0 rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
                    Overdue since {fmt(c.overdueSince)}
                  </span>
                )}
                {c.paused && (
                  <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                    Paused
                  </span>
                )}
              </div>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-brand-700">
                <dt className="text-brand-400">Last service</dt>
                <dd>{c.lastVisitDate ? fmt(c.lastVisitDate) : "none recorded"}</dd>
                <dt className="text-brand-400">Done by</dt>
                <dd>{c.lastVisitDate ? (c.lastVisitWorker ?? "not recorded") : "-"}</dd>
                <dt className="text-brand-400">Next service</dt>
                <dd>{c.nextServiceDate ? fmt(c.nextServiceDate) : "not set"}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
