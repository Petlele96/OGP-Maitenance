"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { buildReminderLink, buildWhatsAppChatLink, buildDateChangedLink } from "@/lib/site";
import type { PlanId } from "@/lib/plans";
import DayRoute, { type MovedInfo } from "./DayRoute";

type ViewMode = "today" | "tomorrow" | "week" | "booked" | "outstanding";
type AuthState = "checking" | "unauthenticated" | "authenticated";

interface BlockGroup<T> {
  block: number | null;
  customers: T[];
}

interface OutstandingDay {
  date: string;
  yardCount: number;
  notDoneCount: number;
  reopened: boolean;
}

interface TomorrowCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  block: number | null;
  plan: PlanId;
  notes: string | null;
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

interface BookedCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  plan: PlanId;
  block: number | null;
  serviceDayLabel: string;
  paymentLinkSentAt: string | null;
  paymentLinkExpired: boolean;
  notes: string | null;
}

interface BookedData {
  total: number;
  groups: BlockGroup<BookedCustomer>[];
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

function formatShortDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function recordContact(signupId: string) {
  fetch("/api/ops/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signupId }),
  }).catch(() => {});
}

export default function OpsPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [view, setView] = useState<ViewMode>("today");
  const [tomorrow, setTomorrow] = useState<TomorrowData | null>(null);
  const [week, setWeek] = useState<WeekDay[] | null>(null);
  const [booked, setBooked] = useState<BookedData | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingDay[] | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [pickDate, setPickDate] = useState("");
  const [sendingLinkId, setSendingLinkId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveDate, setMoveDate] = useState("");
  const [movingBusyId, setMovingBusyId] = useState<string | null>(null);
  const [movedCustomer, setMovedCustomer] = useState<MovedInfo | null>(null);

  // Also serves as the auth probe for the whole page - 401 here shows the login screen.
  const loadOutstanding = useCallback(async () => {
    const res = await fetch("/api/ops/outstanding", { cache: "no-store" });
    if (res.status === 401) {
      setAuthState("unauthenticated");
      return;
    }
    const json = await res.json();
    setOutstanding(json.days);
    setAuthState("authenticated");
  }, []);

  const handleUnauthorized = useCallback(() => setAuthState("unauthenticated"), []);

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

  const loadBooked = useCallback(async () => {
    const res = await fetch("/api/ops/booked", { cache: "no-store" });
    if (res.status === 401) {
      setAuthState("unauthenticated");
      return;
    }
    setBooked(await res.json());
  }, []);

  useEffect(() => {
    loadOutstanding();
  }, [loadOutstanding]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    if (view === "tomorrow" && !tomorrow) loadTomorrow();
    if (view === "week" && !week) loadWeek();
    if (view === "booked" && !booked) loadBooked();
  }, [authState, view, tomorrow, week, booked, loadTomorrow, loadWeek, loadBooked]);

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
    await loadOutstanding();
  }

  async function handleSendPaymentLink(signupId: string) {
    setSendingLinkId(signupId);
    // Opened synchronously, before the fetch, so mobile browsers don't treat it as an
    // unrequested popup - we redirect this same tab to WhatsApp once the link is ready.
    const waTab = window.open("", "_blank");
    const res = await fetch("/api/ops/send-payment-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (waTab) waTab.location.href = data.whatsappLink;
      recordContact(signupId);
      setBooked((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          groups: prev.groups.map((g) => ({
            ...g,
            customers: g.customers.map((c) =>
              c.id === signupId ? { ...c, paymentLinkSentAt: new Date().toISOString(), paymentLinkExpired: false } : c
            ),
          })),
        };
      });
    } else if (waTab) {
      waTab.close();
    }
    setSendingLinkId(null);
  }

  async function handleMove(
    c: { id: string; fullName: string; whatsappNumber: string },
    originalDate: string
  ) {
    if (!moveDate) return;
    setMovingBusyId(c.id);
    const res = await fetch("/api/ops/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId: c.id, originalDate, targetDate: moveDate }),
    });
    setMovingBusyId(null);
    setMovingId(null);
    if (res.ok) {
      setMovedCustomer({
        id: c.id,
        fullName: c.fullName,
        whatsappNumber: c.whatsappNumber,
        dateLabel: formatShortDate(moveDate),
      });
      await loadTomorrow();
    }
    setMoveDate("");
  }

  async function handleLogout() {
    await fetch("/api/ops/logout", { method: "POST" });
    setAuthState("unauthenticated");
    setTomorrow(null);
    setWeek(null);
    setBooked(null);
    setOutstanding(null);
    setOpenDate(null);
  }

  function openAnyDay() {
    if (pickDate) setOpenDate(pickDate);
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
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <button onClick={handleLogout} className="text-xs font-medium text-brand-500 underline">
          Log out
        </button>
      </header>

      <div className="mb-4 flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-brand-100">
        {(
          [
            ["today", "Today"],
            ["tomorrow", "Tomorrow"],
            ["week", "Week"],
            ["booked", "Booked"],
            ["outstanding", outstanding && outstanding.length > 0 ? `Outstanding (${outstanding.length})` : "Outstanding"],
          ] as [ViewMode, string][]
        ).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => {
              setView(mode);
              if (mode !== "outstanding") setOpenDate(null);
            }}
            className={`flex-1 rounded-lg px-1 py-2 text-xs font-semibold ${view === mode ? "bg-brand-600 text-white" : "text-brand-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

{movedCustomer && (
        <div className="mb-4 rounded-xl bg-brand-50 p-3 ring-1 ring-brand-100">
          <p className="text-xs font-semibold text-brand-700">
            Moved {movedCustomer.fullName} to {movedCustomer.dateLabel}
          </p>
          <a
            href={buildDateChangedLink(movedCustomer.fullName, movedCustomer.whatsappNumber, movedCustomer.dateLabel)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              recordContact(movedCustomer.id);
              setMovedCustomer(null);
            }}
            className="mt-2 block rounded-lg bg-brand-600 px-4 py-2 text-center text-sm font-semibold text-white"
          >
            Tell them on WhatsApp
          </a>
          <button onClick={() => setMovedCustomer(null)} className="mt-1 text-xs font-medium text-brand-500 underline">
            Dismiss
          </button>
        </div>
      )}

      {view === "today" && (
        <DayRoute
          date="today"
          onMoved={setMovedCustomer}
          onChanged={loadOutstanding}
          onUnauthorized={handleUnauthorized}
        />
      )}

      {view === "outstanding" &&
        (openDate ? (
          <DayRoute
            date={openDate}
            onBack={() => setOpenDate(null)}
            onMoved={setMovedCustomer}
            onChanged={loadOutstanding}
            onUnauthorized={handleUnauthorized}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
              <p className="text-xs font-semibold text-brand-700">Open any day</p>
              <div className="mt-2 flex gap-2">
                <input
                  type="date"
                  value={pickDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setPickDate(e.target.value)}
                  className="flex-1 rounded-lg border border-brand-200 px-2 py-2 text-sm text-brand-900"
                />
                <button
                  onClick={openAnyDay}
                  disabled={!pickDate}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Open
                </button>
              </div>
              <p className="mt-2 text-xs text-brand-500">
                Any day can be opened, confirmed or corrected - nothing is ever locked.
              </p>
            </div>

            {outstanding === null ? (
              <p className="mt-4 text-center text-sm text-brand-500">Loading...</p>
            ) : outstanding.length === 0 ? (
              <p className="mt-4 text-center text-sm text-brand-500">All caught up - no unconfirmed days.</p>
            ) : (
              <>
                <p className="text-sm text-brand-600">
                  {outstanding.length} unconfirmed day{outstanding.length === 1 ? "" : "s"}, oldest first.
                </p>
                <ul className="flex flex-col gap-3">
                  {outstanding.map((d) => (
                    <li key={d.date}>
                      <button
                        onClick={() => setOpenDate(d.date)}
                        className="flex w-full items-center justify-between rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-brand-100"
                      >
                        <span>
                          <span className="block font-semibold text-brand-900">{formatDayHeading(d.date)}</span>
                          <span className="block text-sm text-brand-600">
                            {d.yardCount} yard{d.yardCount === 1 ? "" : "s"}
                            {d.notDoneCount > 0 && <> · {d.notDoneCount} flagged not done</>}
                            {d.reopened && <> · reopened</>}
                          </span>
                        </span>
                        <span className="ml-3 shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
                          Open
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}

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
                      <li key={c.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="font-semibold text-brand-900">{c.fullName}</p>
                            <p className="text-sm text-brand-700">
                              House {c.houseNumber} <span className="text-brand-400">· {planLabel(c.plan)}</span>
                            </p>
                            {c.notes && <p className="mt-1 text-xs text-brand-500">{c.notes}</p>}
                          </div>
                          <div className="ml-3 flex shrink-0 flex-col items-end gap-2">
                            <a
                              href={buildReminderLink(c.fullName, c.whatsappNumber)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => recordContact(c.id)}
                              className="rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white"
                            >
                              Remind
                            </a>
                            <button
                              onClick={() => setMovingId(c.id)}
                              className="text-xs font-medium text-brand-500 underline"
                            >
                              Move to a date
                            </button>
                          </div>
                        </div>
                        {movingId === c.id && (
                          <div className="mt-3 flex items-center gap-2">
                            <input
                              type="date"
                              value={moveDate}
                              onChange={(e) => setMoveDate(e.target.value)}
                              className="flex-1 rounded-lg border border-brand-200 px-2 py-2 text-sm text-brand-900"
                            />
                            <button
                              onClick={() => tomorrow && handleMove(c, tomorrow.date)}
                              disabled={!moveDate || movingBusyId === c.id}
                              className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => {
                                setMovingId(null);
                                setMoveDate("");
                              }}
                              className="text-xs font-semibold text-brand-500 underline"
                            >
                              Cancel
                            </button>
                          </div>
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

      {view === "booked" && (
        <>
          {!booked ? (
            <p className="mt-8 text-center text-sm text-brand-500">Loading...</p>
          ) : booked.total === 0 ? (
            <p className="mt-8 text-center text-sm text-brand-500">No one's booked and waiting to pay.</p>
          ) : (
            <div className="flex flex-col gap-6">
              <p className="text-sm text-brand-600">
                {booked.total} customer{booked.total === 1 ? "" : "s"} booked, waiting on payment.
              </p>
              {booked.groups.map((group) => (
                <div key={group.block ?? "none"}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-500">
                    {blockHeading(group.block)}
                  </h2>
                  <ul className="flex flex-col gap-3">
                    {group.customers.map((c) => (
                      <li key={c.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
                        <div className="min-w-0">
                          <p className="font-semibold text-brand-900">{c.fullName}</p>
                          <p className="text-sm text-brand-700">
                            House {c.houseNumber} <span className="text-brand-400">· {planLabel(c.plan)}</span>
                          </p>
                          <a
                            href={buildWhatsAppChatLink(c.whatsappNumber)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => recordContact(c.id)}
                            className="text-sm text-brand-500 underline"
                          >
                            {c.whatsappNumber}
                          </a>
                          <p className="mt-1 text-xs text-brand-500">Service day: {c.serviceDayLabel}</p>
                          <p className="mt-1 text-xs text-brand-500">
                            {c.paymentLinkExpired
                              ? "Payment link expired"
                              : c.paymentLinkSentAt
                                ? `Link sent ${formatShortDate(c.paymentLinkSentAt.slice(0, 10))}`
                                : "No payment link sent yet"}
                          </p>
                          {c.notes && <p className="mt-1 text-xs text-brand-500">{c.notes}</p>}
                        </div>
                        <button
                          onClick={() => handleSendPaymentLink(c.id)}
                          disabled={sendingLinkId === c.id}
                          className="mt-3 w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {sendingLinkId === c.id
                            ? "Sending..."
                            : c.paymentLinkSentAt
                              ? "Resend payment link"
                              : "Send payment link"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
