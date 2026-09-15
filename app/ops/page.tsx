"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { buildReminderLink, buildFollowUpLink } from "@/lib/site";
import type { PlanId } from "@/lib/plans";
import { SKIP_REASONS, type SkipReason } from "@/lib/schedule";

type ViewMode = "today" | "tomorrow" | "week";
type AuthState = "checking" | "unauthenticated" | "authenticated";

interface BlockGroup<T> {
  block: number | null;
  customers: T[];
}

interface TodayCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  block: number | null;
  plan: PlanId;
  done: boolean;
  completedAt: string | null;
  skippedReason: SkipReason | null;
  skippedRescheduledDate: string | null;
}

interface TodayData {
  date: string;
  total: number;
  doneCount: number;
  skippedCount: number;
  groups: BlockGroup<TodayCustomer>[];
}

interface TomorrowCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  block: number | null;
  plan: PlanId;
}

interface TomorrowData {
  date: string;
  total: number;
  groups: BlockGroup<TomorrowCustomer>[];
}

interface WeekDay {
  date: string;
  customers: { id: string; fullName: string; houseNumber: string; plan: PlanId; done: boolean }[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDayHeading(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

function blockHeading(block: number | null): string {
  return block === null ? "No block set" : `Block ${block}`;
}

function planLabel(plan: PlanId): string {
  if (plan === "monthly") return "Monthly";
  if (plan === "annual") return "Annual";
  return "Once-off";
}

const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  rain: "Rain",
  gate_locked: "Gate locked",
  dogs_loose: "Dogs loose",
  customer_requested: "Customer requested",
  other: "Other",
};

function formatShortDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export default function OpsPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [view, setView] = useState<ViewMode>("today");
  const [today, setToday] = useState<TodayData | null>(null);
  const [tomorrow, setTomorrow] = useState<TomorrowData | null>(null);
  const [week, setWeek] = useState<WeekDay[] | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [pickingReasonId, setPickingReasonId] = useState<string | null>(null);
  const [skippingId, setSkippingId] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    const res = await fetch("/api/ops/today", { cache: "no-store" });
    if (res.status === 401) {
      setAuthState("unauthenticated");
      return;
    }
    setToday(await res.json());
    setAuthState("authenticated");
  }, []);

  const loadTomorrow = useCallback(async () => {
    const res = await fetch("/api/ops/tomorrow", { cache: "no-store" });
    if (res.status === 401) {
      setAuthState("unauthenticated");
      return;
    }
    setTomorrow(await res.json());
  }, []);

  const loadWeek = useCallback(async () => {
    const res = await fetch("/api/ops/week", { cache: "no-store" });
    if (res.status === 401) {
      setAuthState("unauthenticated");
      return;
    }
    const data = await res.json();
    setWeek(data.days);
  }, []);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    if (view === "tomorrow" && !tomorrow) loadTomorrow();
    if (view === "week" && !week) loadWeek();
  }, [authState, view, tomorrow, week, loadTomorrow, loadWeek]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    const res = await fetch("/api/ops/login", {
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
    await loadToday();
  }

  async function handleDone(signupId: string) {
    setCompletingId(signupId);
    const res = await fetch("/api/ops/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId }),
    });
    if (res.ok) {
      const data = await res.json();
      setToday((prev) => {
        if (!prev) return prev;
        const alreadyDone = prev.groups.some((g) => g.customers.some((c) => c.id === signupId && c.done));
        return {
          ...prev,
          doneCount: alreadyDone ? prev.doneCount : prev.doneCount + 1,
          groups: prev.groups.map((g) => ({
            ...g,
            customers: g.customers.map((c) =>
              c.id === signupId ? { ...c, done: true, completedAt: data.completedAt } : c
            ),
          })),
        };
      });
    }
    setCompletingId(null);
  }

  async function handleSkip(signupId: string, reason: SkipReason) {
    setSkippingId(signupId);
    const res = await fetch("/api/ops/skip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId, reason }),
    });
    if (res.ok) {
      const data = await res.json();
      setToday((prev) => {
        if (!prev) return prev;
        const alreadySkipped = prev.groups.some((g) =>
          g.customers.some((c) => c.id === signupId && c.skippedReason !== null)
        );
        return {
          ...prev,
          skippedCount: alreadySkipped ? prev.skippedCount : prev.skippedCount + 1,
          groups: prev.groups.map((g) => ({
            ...g,
            customers: g.customers.map((c) =>
              c.id === signupId
                ? { ...c, skippedReason: reason, skippedRescheduledDate: data.rescheduledDate }
                : c
            ),
          })),
        };
      });
    }
    setSkippingId(null);
    setPickingReasonId(null);
  }

  async function handleLogout() {
    await fetch("/api/ops/logout", { method: "POST" });
    setAuthState("unauthenticated");
    setToday(null);
    setTomorrow(null);
    setWeek(null);
  }

  if (authState === "checking") {
    return <main className="flex min-h-dvh items-center justify-center bg-brand-50" />;
  }

  if (authState === "unauthenticated") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-brand-50 px-6">
        <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100">
          <h1 className="text-center text-lg font-bold text-brand-900">OGP Operations</h1>
          <p className="mt-1 text-center text-sm text-brand-600">Enter the operator password</p>
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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-brand-900">OGP Operations</h1>
          <p className="text-xs text-brand-600">
            {today && new Date(`${today.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <button onClick={handleLogout} className="text-xs font-medium text-brand-500 underline">
          Log out
        </button>
      </header>

      <div className="mb-4 flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-brand-100">
        <button
          onClick={() => setView("today")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${view === "today" ? "bg-brand-600 text-white" : "text-brand-700"}`}
        >
          Today
        </button>
        <button
          onClick={() => setView("tomorrow")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${view === "tomorrow" ? "bg-brand-600 text-white" : "text-brand-700"}`}
        >
          Tomorrow
        </button>
        <button
          onClick={() => setView("week")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${view === "week" ? "bg-brand-600 text-white" : "text-brand-700"}`}
        >
          This Week
        </button>
      </div>

      {view === "today" && today && (
        <>
          <div className="mb-4 rounded-xl bg-brand-500 px-4 py-3 text-center text-white shadow-sm">
            <span className="text-lg font-bold">{today.doneCount}</span>
            <span className="text-sm"> done · </span>
            <span className="text-lg font-bold">{today.total - today.doneCount - today.skippedCount}</span>
            <span className="text-sm"> remaining</span>
          </div>

          {today.total === 0 ? (
            <p className="mt-8 text-center text-sm text-brand-500">No visits scheduled for today.</p>
          ) : (
            <div className="flex flex-col gap-6">
              {today.groups.map((group) => (
                <div key={group.block ?? "none"}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-500">
                    {blockHeading(group.block)}
                  </h2>
                  <ul className="flex flex-col gap-3">
                    {group.customers.map((c) => (
                      <li
                        key={c.id}
                        className={`rounded-2xl p-4 shadow-sm ring-1 ${
                          c.done || c.skippedReason ? "bg-brand-50 ring-brand-100" : "bg-white ring-brand-100"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="font-semibold text-brand-900">{c.fullName}</p>
                            <p className="text-sm text-brand-700">
                              House {c.houseNumber} <span className="text-brand-400">· {planLabel(c.plan)}</span>
                            </p>
                            <a href={`tel:${c.whatsappNumber}`} className="text-sm text-brand-500 underline">
                              {c.whatsappNumber}
                            </a>
                          </div>
                          {c.done ? (
                            <span className="ml-3 shrink-0 rounded-lg bg-brand-100 px-3 py-2 text-sm font-semibold text-brand-700">
                              ✓ {c.completedAt ? formatTime(c.completedAt) : "Done"}
                            </span>
                          ) : c.skippedReason ? (
                            <span className="ml-3 shrink-0 rounded-lg bg-brand-100 px-3 py-2 text-right text-xs font-semibold text-brand-700">
                              Skipped: {SKIP_REASON_LABELS[c.skippedReason]}
                              {c.skippedRescheduledDate && (
                                <>
                                  <br />→ {formatShortDate(c.skippedRescheduledDate)}
                                </>
                              )}
                            </span>
                          ) : (
                            <div className="ml-3 flex shrink-0 gap-2">
                              <button
                                onClick={() => setPickingReasonId(c.id)}
                                disabled={completingId === c.id}
                                className="rounded-lg border-2 border-brand-300 px-3 py-3 text-sm font-semibold text-brand-700 disabled:opacity-60"
                              >
                                Can&apos;t do
                              </button>
                              <button
                                onClick={() => handleDone(c.id)}
                                disabled={completingId === c.id}
                                className="rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                              >
                                Done
                              </button>
                            </div>
                          )}
                        </div>
                        {pickingReasonId === c.id && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {SKIP_REASONS.map((reason) => (
                              <button
                                key={reason}
                                onClick={() => handleSkip(c.id, reason)}
                                disabled={skippingId === c.id}
                                className="rounded-lg border-2 border-brand-300 px-3 py-2 text-xs font-semibold text-brand-700 disabled:opacity-60"
                              >
                                {SKIP_REASON_LABELS[reason]}
                              </button>
                            ))}
                            <button
                              onClick={() => setPickingReasonId(null)}
                              className="rounded-lg px-3 py-2 text-xs font-semibold text-brand-500 underline"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                        {c.done && c.plan === "once-off" && (
                          <a
                            href={buildFollowUpLink(c.fullName, c.whatsappNumber)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 block rounded-lg border-2 border-brand-500 px-4 py-3 text-center text-sm font-semibold text-brand-700"
                          >
                            Follow up: offer monthly plan
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view === "tomorrow" && (
        <>
          {!tomorrow ? (
            <p className="mt-8 text-center text-sm text-brand-500">Loading...</p>
          ) : tomorrow.total === 0 ? (
            <p className="mt-8 text-center text-sm text-brand-500">No visits scheduled for tomorrow.</p>
          ) : (
            <div className="flex flex-col gap-6">
              <p className="text-sm text-brand-600">
                {tomorrow.total} customer{tomorrow.total === 1 ? "" : "s"} tomorrow. Send reminders now.
              </p>
              {tomorrow.groups.map((group) => (
                <div key={group.block ?? "none"}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-500">
                    {blockHeading(group.block)}
                  </h2>
                  <ul className="flex flex-col gap-3">
                    {group.customers.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-brand-900">{c.fullName}</p>
                          <p className="text-sm text-brand-700">
                            House {c.houseNumber} <span className="text-brand-400">· {planLabel(c.plan)}</span>
                          </p>
                        </div>
                        <a
                          href={buildReminderLink(c.fullName, c.whatsappNumber)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-3 shrink-0 rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white"
                        >
                          Remind
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view === "week" && (
        <div className="flex flex-col gap-4">
          {!week ? (
            <p className="mt-8 text-center text-sm text-brand-500">Loading...</p>
          ) : (
            week.map((day) => (
              <div key={day.date} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
                <h2 className="mb-2 text-sm font-semibold text-brand-900">{formatDayHeading(day.date)}</h2>
                {day.customers.length === 0 ? (
                  <p className="text-sm text-brand-400">No visits scheduled.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {day.customers.map((c) => (
                      <li key={c.id} className="flex items-center justify-between text-sm">
                        <span className="text-brand-800">
                          {c.fullName}{" "}
                          <span className="text-brand-500">
                            · House {c.houseNumber} · {planLabel(c.plan)}
                          </span>
                        </span>
                        {c.done && <span className="text-xs font-semibold text-brand-500">✓</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}
