"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlanId } from "@/lib/plans";

interface AppSettings {
  dailyVisitLimit: number;
  workingDays: number[];
}

interface BlockedDate {
  date: string;
  label: string | null;
}

interface CalendarDay {
  date: string;
  count: number;
  blocked: boolean;
  blockedLabel: string | null;
  customers: { id: string; fullName: string; houseNumber: string; plan: PlanId; block: number | null }[];
}

interface RebalanceMove {
  signupId: string;
  fullName: string;
  houseNumber: string;
  fromSlot: number;
  toSlot: number;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PLAN_LABELS: Record<PlanId, string> = { monthly: "Monthly", annual: "Annual", "once-off": "Once-off" };

function monthLabel(year: number, month1: number): string {
  return new Date(year, month1 - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function monthParam(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, "0")}`;
}

function formatDayHeading(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export default function ScheduleTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [blockedDates, setBlockedDates] = useState<BlockedDate[] | null>(null);
  const [limitInput, setLimitInput] = useState("7");
  const [workingDaysInput, setWorkingDaysInput] = useState<number[]>([1, 2, 3, 4, 5]);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [blockDateValue, setBlockDateValue] = useState("");
  const [blockLabel, setBlockLabel] = useState("");
  const [blockSubmitting, setBlockSubmitting] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const [rebalanceMoves, setRebalanceMoves] = useState<RebalanceMove[] | null>(null);
  const [rebalanceLoading, setRebalanceLoading] = useState(false);
  const [rebalanceApplying, setRebalanceApplying] = useState(false);

  const now = useMemo(() => new Date(), []);
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[] | null>(null);
  const [calendarLimit, setCalendarLimit] = useState(7);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveDate, setMoveDate] = useState("");
  const [moveSubmitting, setMoveSubmitting] = useState(false);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/owner/settings", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    setSettings(json.settings);
    setBlockedDates(json.blockedDates);
    setLimitInput(String(json.settings.dailyVisitLimit));
    setWorkingDaysInput(json.settings.workingDays);
  }, []);

  const loadCalendar = useCallback(async (year: number, month1: number) => {
    setCalendarDays(null);
    const res = await fetch(`/api/owner/calendar?month=${monthParam(year, month1)}`, { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    setCalendarDays(json.days);
    setCalendarLimit(json.dailyVisitLimit);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    loadCalendar(calYear, calMonth);
  }, [calYear, calMonth, loadCalendar]);

  function toggleWorkingDay(day: number) {
    setWorkingDaysInput((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  async function handleSaveSettings() {
    setSettingsSaving(true);
    setSettingsSaved(false);
    await fetch("/api/owner/settings/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dailyVisitLimit: Number(limitInput), workingDays: workingDaysInput }),
    });
    setSettingsSaving(false);
    setSettingsSaved(true);
    await loadCalendar(calYear, calMonth);
  }

  async function handleBlockDate() {
    if (!blockDateValue) return;
    setBlockSubmitting(true);
    setBlockError(null);
    const res = await fetch("/api/owner/settings/block-date", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: blockDateValue, label: blockLabel.trim() === "" ? null : blockLabel.trim() }),
    });
    setBlockSubmitting(false);
    if (!res.ok) {
      setBlockError("Couldn't block that date.");
      return;
    }
    setBlockDateValue("");
    setBlockLabel("");
    await loadSettings();
    await loadCalendar(calYear, calMonth);
  }

  async function handleUnblock(date: string) {
    await fetch("/api/owner/settings/unblock-date", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date }),
    });
    await loadSettings();
    await loadCalendar(calYear, calMonth);
  }

  async function handlePreviewRebalance() {
    setRebalanceLoading(true);
    const res = await fetch("/api/owner/rebalance/preview", { cache: "no-store" });
    setRebalanceLoading(false);
    if (!res.ok) return;
    const json = await res.json();
    setRebalanceMoves(json.moves);
  }

  async function handleAcceptRebalance() {
    if (!rebalanceMoves || rebalanceMoves.length === 0) return;
    setRebalanceApplying(true);
    await fetch("/api/owner/rebalance/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ moves: rebalanceMoves.map((m) => ({ signupId: m.signupId, toSlot: m.toSlot })) }),
    });
    setRebalanceApplying(false);
    setRebalanceMoves(null);
    await loadCalendar(calYear, calMonth);
  }

  function goToMonth(delta: number) {
    let year = calYear;
    let month = calMonth + delta;
    if (month < 1) {
      month = 12;
      year -= 1;
    } else if (month > 12) {
      month = 1;
      year += 1;
    }
    setCalYear(year);
    setCalMonth(month);
    setExpandedDate(null);
  }

  async function handleMoveVisit(signupId: string, originalDate: string) {
    if (!moveDate) return;
    setMoveSubmitting(true);
    const res = await fetch("/api/owner/calendar/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signupId, originalDate, targetDate: moveDate }),
    });
    setMoveSubmitting(false);
    setMovingId(null);
    setMoveDate("");
    if (res.ok) await loadCalendar(calYear, calMonth);
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Working days &amp; workload limit</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((label, day) => (
            <button
              key={day}
              onClick={() => toggleWorkingDay(day)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                workingDaysInput.includes(day) ? "bg-brand-600 text-white" : "border-2 border-brand-200 text-brand-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mt-3 block text-xs text-brand-500">
          Daily visit limit (warns above this)
          <input
            type="number"
            min={1}
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            className="mt-1 w-24 rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900"
          />
        </label>
        <button
          onClick={handleSaveSettings}
          disabled={settingsSaving || !settings}
          className="mt-3 w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {settingsSaving ? "Saving..." : settingsSaved ? "Saved" : "Save"}
        </button>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Blocked dates</h2>
        {blockedDates === null ? (
          <p className="mt-2 text-sm text-brand-500">Loading...</p>
        ) : blockedDates.length === 0 ? (
          <p className="mt-2 text-sm text-brand-500">No dates blocked.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {blockedDates.map((b) => (
              <li key={b.date} className="flex items-center justify-between border-t border-brand-50 pt-2 first:border-0 first:pt-0">
                <span className="text-sm text-brand-800">
                  {formatDayHeading(b.date)} {b.label && <span className="text-brand-400">· {b.label}</span>}
                </span>
                <button onClick={() => handleUnblock(b.date)} className="text-xs font-medium text-brand-500 underline">
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="date"
              value={blockDateValue}
              onChange={(e) => setBlockDateValue(e.target.value)}
              className="flex-1 rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900"
            />
            <input
              value={blockLabel}
              onChange={(e) => setBlockLabel(e.target.value)}
              placeholder="Reason (optional)"
              className="flex-1 rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-900"
            />
          </div>
          {blockError && <p className="text-xs text-red-600">{blockError}</p>}
          <button
            onClick={handleBlockDate}
            disabled={blockSubmitting || !blockDateValue}
            className="rounded-lg border-2 border-brand-300 px-4 py-2 text-sm font-semibold text-brand-700 disabled:opacity-60"
          >
            {blockSubmitting ? "Blocking..." : "Block this date"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Rebalance</h2>
        <p className="mt-1 text-xs text-brand-500">
          Suggests moving customers off overloaded slots onto lighter ones, keeping each customer's two visits ~14 days apart.
        </p>
        {rebalanceMoves === null ? (
          <button
            onClick={handlePreviewRebalance}
            disabled={rebalanceLoading}
            className="mt-3 w-full rounded-xl border-2 border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-700 disabled:opacity-60"
          >
            {rebalanceLoading ? "Checking..." : "Preview rebalance"}
          </button>
        ) : rebalanceMoves.length === 0 ? (
          <p className="mt-3 text-sm text-brand-500">Everything's already balanced under the current limit.</p>
        ) : (
          <div className="mt-3">
            <ul className="flex flex-col gap-2">
              {rebalanceMoves.map((m) => (
                <li key={m.signupId} className="flex items-center justify-between border-t border-brand-50 pt-2 first:border-0 first:pt-0 text-sm">
                  <span className="text-brand-800">
                    {m.fullName} <span className="text-brand-400">· House {m.houseNumber}</span>
                  </span>
                  <span className="font-semibold text-brand-700">
                    Slot {m.fromSlot} → {m.toSlot}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleAcceptRebalance}
                disabled={rebalanceApplying}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {rebalanceApplying ? "Applying..." : "Accept"}
              </button>
              <button
                onClick={() => setRebalanceMoves(null)}
                className="flex-1 rounded-lg border-2 border-brand-300 px-4 py-2.5 text-sm font-semibold text-brand-700"
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
        <div className="flex items-center justify-between">
          <button onClick={() => goToMonth(-1)} className="px-2 py-1 text-lg font-bold text-brand-600">
            ‹
          </button>
          <h2 className="text-sm font-semibold text-brand-900">{monthLabel(calYear, calMonth)}</h2>
          <button onClick={() => goToMonth(1)} className="px-2 py-1 text-lg font-bold text-brand-600">
            ›
          </button>
        </div>

        {calendarDays === null ? (
          <p className="mt-4 text-center text-sm text-brand-500">Loading...</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {calendarDays.map((day) => (
              <li key={day.date} className="rounded-xl border border-brand-50">
                <button
                  onClick={() => setExpandedDate(expandedDate === day.date ? null : day.date)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left"
                >
                  <span className="text-sm text-brand-800">{formatDayHeading(day.date)}</span>
                  <span className="flex items-center gap-2">
                    {day.blocked && (
                      <span className="rounded bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-600">Blocked</span>
                    )}
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        day.count > calendarLimit ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"
                      }`}
                    >
                      {day.count}
                    </span>
                  </span>
                </button>
                {expandedDate === day.date && (
                  <div className="border-t border-brand-50 px-3 py-2">
                    {day.customers.length === 0 ? (
                      <p className="text-xs text-brand-400">Nobody scheduled.</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {day.customers.map((c) => (
                          <li key={c.id} className="flex items-center justify-between text-xs">
                            <span className="text-brand-800">
                              {c.fullName} <span className="text-brand-400">· House {c.houseNumber} · {PLAN_LABELS[c.plan]}</span>
                            </span>
                            <button
                              onClick={() => setMovingId(movingId === c.id ? null : c.id)}
                              className="font-medium text-brand-500 underline"
                            >
                              Move
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {movingId && day.customers.some((c) => c.id === movingId) && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="date"
                          value={moveDate}
                          onChange={(e) => setMoveDate(e.target.value)}
                          className="flex-1 rounded-lg border border-brand-200 px-2 py-1.5 text-xs text-brand-900"
                        />
                        <button
                          onClick={() => handleMoveVisit(movingId, day.date)}
                          disabled={!moveDate || moveSubmitting}
                          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          Confirm
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
