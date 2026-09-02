"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type AuthState = "checking" | "unauthenticated" | "authenticated";

interface FailedOrOverdue {
  id: string;
  fullName: string;
  houseNumber: string;
  whatsappNumber: string;
  daysLate: number;
  status: "failed" | "overdue";
}

interface DashboardData {
  activeCustomers: { total: number; monthly: number; annual: number };
  revenueThisMonth: number;
  failedOrOverdue: FailedOrOverdue[];
  cancellationsThisMonth: number;
  completion: { done: number; scheduled: number };
}

function formatRand(amount: number): string {
  return `R${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function OwnerPage() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);

  const loadDashboard = useCallback(async () => {
    const res = await fetch("/api/owner/dashboard", { cache: "no-store" });
    if (res.status === 401) {
      setAuthState("unauthenticated");
      return;
    }
    setData(await res.json());
    setAuthState("authenticated");
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

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
  }

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

  if (!data) {
    return <main className="flex min-h-dvh items-center justify-center bg-brand-50" />;
  }

  const completionPct =
    data.completion.scheduled === 0 ? null : Math.round((data.completion.done / data.completion.scheduled) * 100);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-10 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-brand-900">OGP Owner Dashboard</h1>
        <button onClick={handleLogout} className="text-xs font-medium text-brand-500 underline">
          Log out
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
          <p className="text-xs font-medium text-brand-500">Active customers</p>
          <p className="mt-1 text-2xl font-bold text-brand-900">{data.activeCustomers.total}</p>
          <p className="mt-0.5 text-xs text-brand-600">
            {data.activeCustomers.monthly} monthly · {data.activeCustomers.annual} annual
          </p>
        </div>
        <div className="rounded-2xl bg-brand-600 p-4 shadow-sm">
          <p className="text-xs font-medium text-brand-100">Money in this month</p>
          <p className="mt-1 text-2xl font-bold text-white">{formatRand(data.revenueThisMonth)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
          <p className="text-xs font-medium text-brand-500">Completion rate</p>
          <p className="mt-1 text-2xl font-bold text-brand-900">{completionPct === null ? "-" : `${completionPct}%`}</p>
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
        <h2 className="text-sm font-semibold text-brand-900">Failed or overdue payments</h2>
        {data.failedOrOverdue.length === 0 ? (
          <p className="mt-3 text-sm text-brand-500">None right now.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {data.failedOrOverdue.map((c) => (
              <li key={c.id} className="flex items-center justify-between border-t border-brand-50 pt-3 first:border-0 first:pt-0">
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
