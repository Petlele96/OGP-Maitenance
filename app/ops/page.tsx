"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type ViewMode = "today" | "week";
type AuthState = "checking" | "unauthenticated" | "authenticated";

interface TodayCustomer {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  done: boolean;
  completedAt: string | null;
}

interface TodayData {
  date: string;
  total: number;
  doneCount: number;
  customers: TodayCustomer[];
}

interface WeekDay {
  date: string;
  customers: { id: string; fullName: string; houseNumber: string; done: boolean }[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDayHeading(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

export default function OpsPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [view, setView] = useState<ViewMode>("today");
  const [today, setToday] = useState<TodayData | null>(null);
  const [week, setWeek] = useState<WeekDay[] | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    const res = await fetch("/api/ops/today", { cache: "no-store" });
    if (res.status === 401) {
      setAuthState("unauthenticated");
      return;
    }
    setToday(await res.json());
    setAuthState("authenticated");
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
    if (authState === "authenticated" && view === "week" && !week) {
      loadWeek();
    }
  }, [authState, view, week, loadWeek]);

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
        const alreadyDone = prev.customers.find((c) => c.id === signupId)?.done;
        return {
          ...prev,
          doneCount: alreadyDone ? prev.doneCount : prev.doneCount + 1,
          customers: prev.customers.map((c) =>
            c.id === signupId ? { ...c, done: true, completedAt: data.completedAt } : c
          ),
        };
      });
    }
    setCompletingId(null);
  }

  async function handleLogout() {
    await fetch("/api/ops/logout", { method: "POST" });
    setAuthState("unauthenticated");
    setToday(null);
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
            <span className="text-lg font-bold">{today.total - today.doneCount}</span>
            <span className="text-sm"> remaining</span>
          </div>

          {today.customers.length === 0 ? (
            <p className="mt-8 text-center text-sm text-brand-500">No visits scheduled for today.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {today.customers.map((c) => (
                <li
                  key={c.id}
                  className={`flex items-center justify-between rounded-2xl p-4 shadow-sm ring-1 ${
                    c.done ? "bg-brand-50 ring-brand-100" : "bg-white ring-brand-100"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-brand-900">{c.fullName}</p>
                    <p className="text-sm text-brand-700">House {c.houseNumber}</p>
                    <a href={`tel:${c.whatsappNumber}`} className="text-sm text-brand-500 underline">
                      {c.whatsappNumber}
                    </a>
                  </div>
                  {c.done ? (
                    <span className="ml-3 shrink-0 rounded-lg bg-brand-100 px-3 py-2 text-sm font-semibold text-brand-700">
                      ✓ {c.completedAt ? formatTime(c.completedAt) : "Done"}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleDone(c.id)}
                      disabled={completingId === c.id}
                      className="ml-3 shrink-0 rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      Done
                    </button>
                  )}
                </li>
              ))}
            </ul>
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
                          {c.fullName} <span className="text-brand-500">· House {c.houseNumber}</span>
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
