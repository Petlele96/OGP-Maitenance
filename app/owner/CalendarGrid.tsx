"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlanId } from "@/lib/plans";

interface Person {
  id: string;
  fullName: string;
  houseNumber: string;
  block: number | null;
  plan: PlanId;
}

interface Serviced extends Person {
  worker: string | null;
  note: string | null;
}

interface Due extends Person {
  overdue: boolean;
  projected: boolean;
}

interface Day {
  date: string;
  blocked: boolean;
  blockedLabel: string | null;
  serviced: Serviced[];
  due: Due[];
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthKey(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, "0")}`;
}

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

function longDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * Month calendar for every client. A day shows two things that cannot be mistaken for each other: a filled
 * green "serviced" mark (a visit record exists) and outlined "due" marks - amber for due, red for overdue,
 * dashed for projected. Tap a day for the full list.
 */
export default function CalendarGrid({ refreshToken, dailyLimit }: { refreshToken: number; dailyLimit: number }) {
  const today = todayKey();
  const start = useMemo(() => new Date(`${today}T00:00:00`), [today]);
  const [year, setYear] = useState(start.getFullYear());
  const [month, setMonth] = useState(start.getMonth() + 1);
  const [days, setDays] = useState<Day[] | null>(null);
  const [selected, setSelected] = useState<string | null>(today);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveDate, setMoveDate] = useState("");
  const [moveBusy, setMoveBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/owner/calendar?month=${monthKey(year, month)}`, { cache: "no-store" });
    if (!res.ok) return;
    setDays((await res.json()).days);
  }, [year, month]);

  useEffect(() => {
    setDays(null);
    load();
  }, [load, refreshToken]);

  function goTo(delta: number) {
    let y = year;
    let m = month + delta;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setYear(y);
    setMonth(m);
    setSelected(null);
    setMovingId(null);
  }

  function goToday() {
    setYear(start.getFullYear());
    setMonth(start.getMonth() + 1);
    setSelected(today);
  }

  async function moveVisit(signupId: string, originalDate: string) {
    if (!moveDate) return;
    setMoveBusy(true);
    const res = await fetch("/api/owner/calendar/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId, originalDate, targetDate: moveDate }),
    });
    setMoveBusy(false);
    setMovingId(null);
    setMoveDate("");
    if (res.ok) await load();
  }

  const firstOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Monday first
  const selectedDay = days?.find((d) => d.date === selected) ?? null;

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
      <div className="flex items-center justify-between">
        <button onClick={() => goTo(-1)} aria-label="Previous month" className="px-3 py-1 text-xl font-bold text-brand-600">
          ‹
        </button>
        <div className="text-center">
          <h2 className="text-sm font-semibold text-brand-900">
            {new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </h2>
          <button onClick={goToday} className="text-xs font-medium text-brand-500 underline">
            Today
          </button>
        </div>
        <button onClick={() => goTo(1)} aria-label="Next month" className="px-3 py-1 text-xl font-bold text-brand-600">
          ›
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-brand-400">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      {days === null ? (
        <p className="mt-6 text-center text-sm text-brand-500">Loading...</p>
      ) : (
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: firstOffset }, (_, i) => (
            <span key={`pad${i}`} />
          ))}
          {days.map((d) => {
            const overdue = d.due.filter((x) => x.overdue).length;
            const projected = d.due.filter((x) => x.projected).length;
            const dueNow = d.due.length - overdue - projected;
            const isSelected = selected === d.date;
            return (
              <button
                key={d.date}
                onClick={() => {
                  setSelected(isSelected ? null : d.date);
                  setMovingId(null);
                }}
                aria-label={`${longDate(d.date)}: ${d.serviced.length} serviced, ${d.due.length} due`}
                className={`flex min-h-[3.9rem] flex-col items-stretch gap-0.5 rounded-lg p-1 text-left ${
                  d.blocked ? "bg-brand-100" : "bg-brand-50/60"
                } ${isSelected ? "ring-2 ring-brand-600" : d.date === today ? "ring-2 ring-brand-300" : "ring-1 ring-brand-100"}`}
              >
                <span className={`text-[11px] font-semibold ${d.date === today ? "text-brand-700" : "text-brand-800"}`}>
                  {Number(d.date.slice(8))}
                </span>
                {d.serviced.length > 0 && (
                  <span className="rounded bg-brand-600 px-1 text-center text-[10px] font-bold leading-4 text-white">
                    ✓ {d.serviced.length}
                  </span>
                )}
                {overdue > 0 && (
                  <span className="rounded border border-red-500 bg-white px-1 text-center text-[10px] font-bold leading-[14px] text-red-700">
                    {overdue} late
                  </span>
                )}
                {dueNow > 0 && (
                  <span className="rounded border border-amber-500 bg-white px-1 text-center text-[10px] font-bold leading-[14px] text-amber-800">
                    {dueNow} due
                  </span>
                )}
                {projected > 0 && (
                  <span className="rounded border border-dashed border-brand-400 bg-white px-1 text-center text-[10px] font-semibold leading-[14px] text-brand-500">
                    ~{projected}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-brand-600">
        <span>
          <span className="rounded bg-brand-600 px-1 font-bold text-white">✓ 2</span> serviced
        </span>
        <span>
          <span className="rounded border border-amber-500 px-1 font-bold text-amber-800">2 due</span> due
        </span>
        <span>
          <span className="rounded border border-red-500 px-1 font-bold text-red-700">2 late</span> overdue
        </span>
        <span>
          <span className="rounded border border-dashed border-brand-400 px-1 font-semibold text-brand-500">~2</span>{" "}
          projected
        </span>
      </div>

      {selectedDay && (
        <div className="mt-4 border-t border-brand-100 pt-3">
          <h3 className="text-sm font-bold text-brand-900">
            {longDate(selectedDay.date)}
            {selectedDay.blocked && (
              <span className="ml-2 rounded bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-600">
                Blocked{selectedDay.blockedLabel ? `: ${selectedDay.blockedLabel}` : ""}
              </span>
            )}
          </h3>

          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-brand-600">
            Serviced ({selectedDay.serviced.length})
          </p>
          {selectedDay.serviced.length === 0 ? (
            <p className="mt-1 text-xs text-brand-400">No visits recorded this day.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1.5">
              {selectedDay.serviced.map((c) => (
                <li key={c.id} className="rounded-lg bg-brand-50 px-3 py-2 text-sm">
                  <span className="font-semibold text-brand-900">✓ {c.fullName}</span>
                  <span className="text-brand-500"> · House {c.houseNumber}</span>
                  <span className="block text-xs text-brand-600">
                    {c.worker ? `By ${c.worker}` : "Worker not recorded"}
                    {c.note ? ` · ${c.note}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-amber-800">
            Due ({selectedDay.due.length})
            {selectedDay.due.filter((c) => !c.projected).length > dailyLimit && (
              <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-red-700">
                over the daily limit of {dailyLimit}
              </span>
            )}
          </p>
          {selectedDay.due.length === 0 ? (
            <p className="mt-1 text-xs text-brand-400">Nobody due this day.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1.5">
              {selectedDay.due.map((c) => (
                <li
                  key={`${c.id}-${c.projected}`}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    c.overdue ? "border-red-300" : c.projected ? "border-dashed border-brand-300" : "border-amber-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span>
                      <span className="font-semibold text-brand-900">{c.fullName}</span>
                      <span className="text-brand-500"> · House {c.houseNumber}</span>
                      {c.overdue && (
                        <span className="ml-2 rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
                          Overdue
                        </span>
                      )}
                      {c.projected && (
                        <span className="ml-2 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-600">
                          Projected
                        </span>
                      )}
                    </span>
                    {!c.projected && (
                      <button
                        onClick={() => setMovingId(movingId === c.id ? null : c.id)}
                        className="shrink-0 text-xs font-medium text-brand-500 underline"
                      >
                        Move
                      </button>
                    )}
                  </div>
                  {movingId === c.id && !c.projected && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="date"
                        value={moveDate}
                        onChange={(e) => setMoveDate(e.target.value)}
                        className="flex-1 rounded-lg border border-brand-200 px-2 py-1.5 text-xs text-brand-900"
                      />
                      <button
                        onClick={() => moveVisit(c.id, selectedDay.date)}
                        disabled={!moveDate || moveBusy}
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        Confirm
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
